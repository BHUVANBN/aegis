import type { ChangedResource, Finding, Severity } from '@aegis/shared';
import { classifyResource, isTagOnly } from './classify.js';
import {
  BROAD_SOURCES,
  DATABASE_TYPES,
  ROLE_DEFINITIONS,
  SENSITIVE_DATA_TYPES,
  SENSITIVE_PORTS,
} from '../rules/riskRules.js';
import { getByPath, SAFE_RESOURCE_ID_RE, sha256Hex } from '../util.js';
import type { ResourceGraphClient } from '../azure/resourceGraph.js';

export type EnvKind = 'dev' | 'staging' | 'prod';

export interface PolicyOutput {
  findings: Finding[];
  azurePolicy: {
    status: 'ok' | 'partial' | 'unavailable';
    reason?: string;
    queriedAt: string;
    nonCompliant: number;
  };
  limitations: string[];
}

function fid(ruleId: string, resourceId: string, extra = ''): string {
  return `${ruleId}:${sha256Hex(`${resourceId.toLowerCase()}|${extra}`).slice(0, 10)}`;
}

function mk(
  ruleId: string,
  title: string,
  severity: Severity,
  category: string,
  r: ChangedResource,
  evidence: Finding['evidence'],
  opts: { prohibited?: boolean; likelihood?: number; extra?: string } = {},
): Finding {
  return {
    id: fid(ruleId, r.resourceId, opts.extra),
    ruleId,
    title,
    severity,
    category,
    likelihood: opts.likelihood ?? 1,
    prohibited: opts.prohibited ?? false,
    resourceId: r.resourceId,
    evidence,
    source: 'local-rule',
  };
}

const lower = (v: unknown): string => String(v ?? '').toLowerCase();
const portsOf = (props: Record<string, unknown>): string[] => {
  const single = props.destinationPortRange;
  const multi = props.destinationPortRanges;
  const all = [
    ...(typeof single === 'string' ? [single] : []),
    ...(Array.isArray(multi) ? multi.map(String) : []),
  ];
  return all;
};
const portMatches = (ranges: string[], port: number): boolean =>
  ranges.some((x) => {
    if (x === '*') return true;
    const [a, b] = x.split('-').map(Number);
    return b === undefined ? a === port : a !== undefined && a <= port && port <= b;
  });

/** Extracts NSG rule objects that were removed/added/changed in a change, from delta paths and full states. */
function nsgRules(
  r: ChangedResource,
  side: 'before' | 'after',
): { path: string; name?: string; props: Record<string, unknown>; diffed?: boolean }[] {
  const out: { path: string; name?: string; props: Record<string, unknown>; diffed?: boolean }[] = [];
  for (const pc of r.propertyChanges) {
    // Real What-If form (captured from the Azure CLI): rules are nested in an object reported at "properties",
    // e.g. before = { securityRules: [...] }, after = null. Compare rule names on both sides.
    if (/(^|\.)properties$/i.test(pc.path) && !Array.isArray(pc.before)) {
      const rulesOf = (v: unknown): unknown[] | null => {
        const sr = (v as { securityRules?: unknown } | null | undefined)?.securityRules;
        return Array.isArray(sr) ? sr : null;
      };
      const b = rulesOf(pc.before);
      const a = rulesOf(pc.after);
      if (b || a) {
        const nm = (arr: unknown[] | null) =>
          new Set((arr ?? []).map((x) => String((x as { name?: unknown })?.name ?? '').toLowerCase()));
        const other = nm(side === 'before' ? a : b);
        (side === 'before' ? (b ?? []) : (a ?? [])).forEach((el, i) => {
          const o = el as { name?: unknown; properties?: Record<string, unknown> };
          if (!other.has(String(o?.name ?? '').toLowerCase()))
            out.push({
              path: `${pc.path}.securityRules[${i}]`,
              name: String(o?.name ?? ''),
              props: o?.properties ?? {},
              diffed: true,
            });
        });
        continue;
      }
    }
    // Whole-array form: What-If may report securityRules as a single Modify with before/after arrays and no children.
    if (/securityRules$/i.test(pc.path) && Array.isArray(pc.before) && Array.isArray(pc.after)) {
      const names = (arr: unknown[]) =>
        new Set(arr.map((x) => String((x as { name?: unknown })?.name ?? '').toLowerCase()));
      const other = names(side === 'before' ? pc.after : pc.before);
      (side === 'before' ? pc.before : pc.after).forEach((el, i) => {
        const o = el as { name?: unknown; properties?: Record<string, unknown> };
        if (!other.has(String(o?.name ?? '').toLowerCase()))
          out.push({ path: `${pc.path}[${i}]`, name: String(o?.name ?? ''), props: o?.properties ?? {} });
      });
      continue;
    }
    const v = side === 'before' ? pc.before : pc.after;
    const isRuleElement = /securityRules\[\d+\]$/i.test(pc.path);
    if (isRuleElement && v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      out.push({
        path: pc.path,
        name: String(o.name ?? ''),
        props: (o.properties ?? {}) as Record<string, unknown>,
      });
    }
  }
  if (r.type.toLowerCase() === 'microsoft.network/networksecuritygroups/securityrules') {
    const st = (side === 'before' ? r.before : r.after) as Record<string, unknown> | undefined;
    if (st?.properties)
      out.push({ path: 'properties', name: r.name, props: st.properties as Record<string, unknown> });
  }
  return out;
}

export function evaluateLocalRules(resources: ChangedResource[], envKind: EnvKind): Finding[] {
  const f: Finding[] = [];
  const prod = envKind === 'prod';
  for (const r of resources) {
    if (r.changeType === 'NoChange' || r.changeType === 'Ignore') continue;
    const t = r.type.toLowerCase();
    const cls = classifyResource(r);
    const after = (p: string) =>
      r.propertyChanges.find((x) => x.path.toLowerCase() === p.toLowerCase()) ?? null;
    const afterVal = (p: string): unknown => {
      const pc = after(p);
      if (pc) return pc.changeType === 'Delete' ? undefined : pc.after;
      return getByPath(r.after, p);
    };
    const beforeVal = (p: string): unknown => after(p)?.before ?? getByPath(r.before, p);

    // LR-DEL-001 / LR-DEL-002: destructive operations
    if (r.changeType === 'Delete') {
      if (SENSITIVE_DATA_TYPES.includes(t)) {
        f.push(
          mk(
            'LR-DEL-001',
            `Deletion of sensitive data resource (${r.type})`,
            'critical',
            'destructive-change',
            r,
            [{ note: 'What-If changeType is Delete', before: r.name }],
            { prohibited: prod },
          ),
        );
      } else {
        f.push(
          mk(
            'LR-DEL-002',
            `Resource deletion (${r.type})`,
            'medium',
            'destructive-change',
            r,
            [{ note: 'What-If changeType is Delete', before: r.name }],
            { likelihood: 0.8 },
          ),
        );
      }
    }

    // LR-NET-*: network security
    if (cls === 'network-security') {
      for (const rule of nsgRules(r, 'before')) {
        const removed =
          rule.diffed === true ||
          r.changeType === 'Delete' ||
          r.propertyChanges.some((p) => p.path === rule.path && p.changeType === 'Delete') ||
          r.propertyChanges.some((p) => /securityRules$/i.test(p.path) && rule.path.startsWith(p.path + '['));
        if (!removed) continue;
        const wasInboundAllow =
          lower(rule.props.access) === 'allow' && lower(rule.props.direction) === 'inbound';
        const src = [
          rule.props.sourceAddressPrefix,
          ...(Array.isArray(rule.props.sourceAddressPrefixes) ? rule.props.sourceAddressPrefixes : []),
        ].map(lower);
        const fromPublic = src.some((s) => BROAD_SOURCES.includes(s));
        if (wasInboundAllow && fromPublic && portMatches(portsOf(rule.props), 443)) {
          f.push(
            mk(
              'LR-NET-001',
              'Removal of public inbound HTTPS (443) allow rule',
              'critical',
              'network-security',
              r,
              [
                {
                  path: rule.path,
                  before: { name: rule.name, ...rule.props },
                  note: 'Rule allowed inbound 443 from a public/any source',
                },
              ],
              { prohibited: prod, extra: rule.path },
            ),
          );
        } else if (wasInboundAllow && fromPublic && portMatches(portsOf(rule.props), 80)) {
          f.push(
            mk(
              'LR-NET-001',
              'Removal of public inbound HTTP (80) allow rule',
              'high',
              'network-security',
              r,
              [{ path: rule.path, before: { name: rule.name, ...rule.props } }],
              { extra: rule.path },
            ),
          );
        }
      }
      for (const rule of nsgRules(r, 'after')) {
        const added =
          rule.diffed === true ||
          r.changeType === 'Create' ||
          r.propertyChanges.some(
            (p) => p.path === rule.path && (p.changeType === 'Create' || p.changeType === 'Modify'),
          ) ||
          r.propertyChanges.some((p) => /securityRules$/i.test(p.path) && rule.path.startsWith(p.path + '['));
        const inboundAllow =
          lower(rule.props.access) === 'allow' && lower(rule.props.direction) === 'inbound';
        const src = [
          rule.props.sourceAddressPrefix,
          ...(Array.isArray(rule.props.sourceAddressPrefixes) ? rule.props.sourceAddressPrefixes : []),
        ].map(lower);
        const ports = portsOf(rule.props);
        const sensitiveHit = SENSITIVE_PORTS.some((p) =>
          p === '*' ? ports.includes('*') : portMatches(ports, Number(p)),
        );
        if (added && inboundAllow && src.some((s) => BROAD_SOURCES.includes(s)) && sensitiveHit) {
          f.push(
            mk(
              'LR-NET-002',
              'Inbound allow from any/Internet to a sensitive or wildcard port',
              'critical',
              'public-exposure',
              r,
              [{ path: rule.path, after: { name: rule.name, ...rule.props } }],
              { prohibited: true, extra: rule.path },
            ),
          );
        }
      }
      if (!isTagOnly(r) && !f.some((x) => x.resourceId === r.resourceId && x.ruleId.startsWith('LR-NET'))) {
        f.push(
          mk(
            'LR-NET-003',
            `Network security configuration change (${r.type})`,
            prod ? 'high' : 'medium',
            'network-security',
            r,
            r.propertyChanges.slice(0, 5).map((p) => ({ path: p.path, before: p.before, after: p.after })),
            { likelihood: 0.8 },
          ),
        );
      }
    }

    // LR-EXP-*: public exposure
    const pna = afterVal('properties.publicNetworkAccess');
    if (lower(pna) === 'enabled' && lower(beforeVal('properties.publicNetworkAccess')) !== 'enabled') {
      f.push(
        mk('LR-EXP-001', 'Public network access enabled', 'high', 'public-exposure', r, [
          {
            path: 'properties.publicNetworkAccess',
            before: beforeVal('properties.publicNetworkAccess'),
            after: pna,
          },
        ]),
      );
    }
    if (
      lower(afterVal('properties.networkAcls.defaultAction')) === 'allow' &&
      lower(beforeVal('properties.networkAcls.defaultAction')) !== 'allow'
    ) {
      f.push(
        mk('LR-EXP-002', 'Network ACL default action set to Allow', 'high', 'public-exposure', r, [
          { path: 'properties.networkAcls.defaultAction', after: 'Allow' },
        ]),
      );
    }
    if (t === 'microsoft.storage/storageaccounts' && afterVal('properties.allowBlobPublicAccess') === true) {
      f.push(
        mk(
          'LR-STG-001',
          'Storage account allows anonymous blob public access',
          'critical',
          'public-exposure',
          r,
          [
            {
              path: 'properties.allowBlobPublicAccess',
              before: beforeVal('properties.allowBlobPublicAccess'),
              after: true,
            },
          ],
          { prohibited: true },
        ),
      );
    }

    // LR-ENC-001: encryption weakening
    const weak: { path: string; before?: unknown; after?: unknown }[] = [];
    if (afterVal('properties.supportsHttpsTrafficOnly') === false)
      weak.push({
        path: 'properties.supportsHttpsTrafficOnly',
        before: beforeVal('properties.supportsHttpsTrafficOnly'),
        after: false,
      });
    const tlsAfter = lower(afterVal('properties.minimumTlsVersion'));
    if (['tls1_0', 'tls1_1', '1.0', '1.1'].includes(tlsAfter))
      weak.push({
        path: 'properties.minimumTlsVersion',
        before: beforeVal('properties.minimumTlsVersion'),
        after: tlsAfter,
      });
    if (
      beforeVal('properties.enablePurgeProtection') === true &&
      afterVal('properties.enablePurgeProtection') !== true &&
      after('properties.enablePurgeProtection')
    )
      weak.push({
        path: 'properties.enablePurgeProtection',
        before: true,
        after: afterVal('properties.enablePurgeProtection'),
      });
    if (afterVal('properties.enableSoftDelete') === false)
      weak.push({
        path: 'properties.enableSoftDelete',
        before: beforeVal('properties.enableSoftDelete'),
        after: false,
      });
    if (lower(afterVal('properties.sslEnforcement')) === 'disabled')
      weak.push({ path: 'properties.sslEnforcement', after: 'Disabled' });
    for (const pc of r.propertyChanges) {
      if (/(^|\.)encryption(\.|$)/i.test(pc.path) && pc.changeType === 'Delete')
        weak.push({ path: pc.path, before: pc.before, after: undefined });
    }
    if (weak.length)
      f.push(
        mk('LR-ENC-001', 'Encryption or transport-security setting weakened', 'high', 'encryption', r, weak, {
          prohibited: false,
        }),
      );

    // LR-IAM-001: privilege escalation
    if (
      t === 'microsoft.authorization/roleassignments' &&
      (r.changeType === 'Create' || r.changeType === 'Modify')
    ) {
      const rd = lower(afterVal('properties.roleDefinitionId') ?? '');
      const priv = [
        ROLE_DEFINITIONS.owner,
        ROLE_DEFINITIONS.userAccessAdministrator,
        ROLE_DEFINITIONS.contributor,
      ].find((g) => rd.endsWith(g));
      const subscriptionScope = !/\/resourcegroups\//i.test(r.resourceId);
      if (priv) {
        const veryPriv = priv !== ROLE_DEFINITIONS.contributor;
        f.push(
          mk(
            'LR-IAM-001',
            `Privileged role assignment (${veryPriv ? 'Owner/User Access Administrator' : 'Contributor'})`,
            veryPriv && subscriptionScope ? 'critical' : 'high',
            'privilege-escalation',
            r,
            [
              {
                path: 'properties.roleDefinitionId',
                after: afterVal('properties.roleDefinitionId'),
                note: `scope=${subscriptionScope ? 'subscription' : 'resource group or narrower'}`,
              },
            ],
            { prohibited: veryPriv && subscriptionScope },
          ),
        );
      } else {
        f.push(
          mk(
            'LR-IAM-002',
            'Role assignment created or modified',
            'medium',
            'privilege-escalation',
            r,
            [{ path: 'properties.roleDefinitionId', after: afterVal('properties.roleDefinitionId') }],
            { likelihood: 0.7 },
          ),
        );
      }
    }

    // LR-DB-001: database changes
    if (DATABASE_TYPES.includes(t) && r.changeType === 'Modify' && !isTagOnly(r)) {
      f.push(
        mk(
          'LR-DB-001',
          `Database resource modified (${r.type})`,
          prod ? 'high' : 'medium',
          'database-change',
          r,
          r.propertyChanges.slice(0, 5).map((p) => ({ path: p.path, before: p.before, after: p.after })),
          { likelihood: 0.8 },
        ),
      );
    }

    // LR-PROD-001: other production modifications
    if (prod && r.changeType === 'Modify' && !isTagOnly(r) && !f.some((x) => x.resourceId === r.resourceId)) {
      f.push(
        mk(
          'LR-PROD-001',
          `Modification of production resource (${r.type})`,
          'medium',
          'production-change',
          r,
          r.propertyChanges.slice(0, 5).map((p) => ({ path: p.path, before: p.before, after: p.after })),
          { likelihood: 0.6 },
        ),
      );
    }
    if (r.changeType === 'Create' && !f.some((x) => x.resourceId === r.resourceId)) {
      f.push(
        mk(
          'LR-CREATE-001',
          `New resource (${r.type})`,
          'low',
          'creation',
          r,
          [{ note: 'What-If changeType is Create' }],
          { likelihood: 0.5 },
        ),
      );
    }
  }
  return f;
}

export async function runPolicyAgent(
  resources: ChangedResource[],
  envKind: EnvKind,
  arg: ResourceGraphClient | null,
  subscriptions: string[],
): Promise<PolicyOutput> {
  const findings = evaluateLocalRules(resources, envKind);
  const queriedAt = new Date().toISOString();
  const limitations = [
    'Azure Policy compliance below reflects the CURRENT state of existing resources (policyresources table), not a prediction for the proposed change.',
    'Azure Policy deny/audit effects are evaluated by ARM at deployment time and are not simulated by What-If.',
  ];
  if (!arg) {
    return {
      findings,
      azurePolicy: {
        status: 'unavailable',
        reason: 'Resource Graph client not configured',
        queriedAt,
        nonCompliant: 0,
      },
      limitations,
    };
  }
  const targets = resources
    .filter((r) => r.changeType !== 'Create' && SAFE_RESOURCE_ID_RE.test(r.resourceId))
    .slice(0, 50);
  if (targets.length === 0)
    return { findings, azurePolicy: { status: 'ok', queriedAt, nonCompliant: 0 }, limitations };
  try {
    const ids = targets.map((r) => `'${r.resourceId.toLowerCase()}'`).join(',');
    const rows = await arg.query(
      `policyresources | where type == 'microsoft.policyinsights/policystates' | where tolower(tostring(properties.resourceId)) in (${ids}) | where tostring(properties.complianceState) == 'NonCompliant' | project resourceId=tostring(properties.resourceId), policy=tostring(properties.policyDefinitionName), assignment=tostring(properties.policyAssignmentName)`,
      subscriptions,
    );
    let n = 0;
    for (const row of rows) {
      n++;
      const res = targets.find((t) => t.resourceId.toLowerCase() === String(row.resourceId).toLowerCase());
      if (!res) continue;
      findings.push({
        id: fid('AP-NONCOMPLIANT', res.resourceId, String(row.policy)),
        ruleId: 'AP-NONCOMPLIANT',
        title: `Resource is already non-compliant with policy ${String(row.policy)}`,
        severity: 'medium',
        likelihood: 0.7,
        prohibited: false,
        category: 'policy-violation',
        resourceId: res.resourceId,
        evidence: [{ note: `assignment=${String(row.assignment)}` }],
        source: 'azure-policy',
      });
    }
    if (targets.length < resources.filter((r) => r.changeType !== 'Create').length)
      limitations.push('Only the first 50 existing resources were checked against Azure Policy state.');
    return {
      findings,
      azurePolicy: {
        status: targets.length < resources.filter((r) => r.changeType !== 'Create').length ? 'partial' : 'ok',
        queriedAt,
        nonCompliant: n,
      },
      limitations,
    };
  } catch (e) {
    return {
      findings,
      azurePolicy: {
        status: 'unavailable',
        reason: (e as Error).message.slice(0, 300),
        queriedAt,
        nonCompliant: 0,
      },
      limitations,
    };
  }
}
