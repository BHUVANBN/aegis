import type { Db } from './db/db.js';
import { withTx } from './db/db.js';
import { audit } from './audit.js';
import type { ResourceGraphClient } from './azure/resourceGraph.js';
import { canonicalJson, getByPath, SAFE_RESOURCE_ID_RE } from './util.js';
import type { PropertyChange } from '@aegis/shared';

export type VerificationStatus = 'passed' | 'failed' | 'inconclusive' | 'partially_verified';
export interface Check {
  name: string;
  resourceId?: string;
  result: 'pass' | 'fail' | 'skipped';
  expected?: unknown;
  observed?: unknown;
  note?: string;
}
export interface VerificationResult {
  status: VerificationStatus;
  checks: Check[];
  discrepancies: Check[];
  limitations: string[];
}

interface ExpectedResource {
  resource_id: string;
  type: string;
  name: string;
  change_type: string;
  property_changes: PropertyChange[];
  resource_group: string | null;
}

const eq = (a: unknown, b: unknown): boolean =>
  typeof a === 'string' && typeof b === 'string'
    ? a.toLowerCase() === b.toLowerCase()
    : canonicalJson(a) === canonicalJson(b);

export async function compareState(
  expected: ExpectedResource[],
  arg: ResourceGraphClient | null,
  subscriptions: string[],
  envResourceGroup: string | null,
  deploymentStartedAt: Date,
  deploymentStatus: string,
): Promise<VerificationResult> {
  const checks: Check[] = [];
  const limitations = [
    'Absence of fired alerts is not proof of health: AEGIS cannot know whether alert rules exist for this workload.',
    'Resource Graph reflects Azure state with a short delay; run verification a few minutes after deployment.',
  ];
  if (deploymentStatus === 'failed')
    return {
      status: 'failed',
      checks: [{ name: 'deployment-result', result: 'fail', note: 'Pipeline reported deployment failure' }],
      discrepancies: [
        { name: 'deployment-result', result: 'fail', note: 'Pipeline reported deployment failure' },
      ],
      limitations,
    };
  if (deploymentStatus !== 'succeeded')
    return {
      status: 'inconclusive',
      checks: [],
      discrepancies: [],
      limitations: [...limitations, 'Deployment completion has not been reported by the pipeline.'],
    };
  checks.push({
    name: 'deployment-result',
    result: 'pass',
    note: 'Pipeline reported success (not by itself proof of correct state)',
  });
  if (!arg)
    return {
      status: 'inconclusive',
      checks,
      discrepancies: [],
      limitations: [...limitations, 'Resource Graph is not configured; observed state was not queried.'],
    };

  const topLevel = expected.filter(
    (e) => e.type.split('/').length <= 2 && SAFE_RESOURCE_ID_RE.test(e.resource_id),
  );
  const children = expected.filter((e) => e.type.split('/').length > 2);
  if (children.length)
    limitations.push(
      `${children.length} child resource(s) are not rows in Resource Graph and were not verified directly.`,
    );

  const observed = new Map<string, Record<string, unknown>>();
  try {
    for (let i = 0; i < topLevel.length; i += 50) {
      const ids = topLevel
        .slice(i, i + 50)
        .map((e) => `'${e.resource_id.toLowerCase()}'`)
        .join(',');
      const rows = await arg.query(
        `resources | where tolower(id) in (${ids}) | project id, type, properties, tags, sku, provisioningState=tostring(properties.provisioningState)`,
        subscriptions,
      );
      rows.forEach((r) => observed.set(String(r.id).toLowerCase(), r));
    }
  } catch (e) {
    return {
      status: 'inconclusive',
      checks,
      discrepancies: [],
      limitations: [...limitations, `Resource Graph query failed: ${(e as Error).message.slice(0, 200)}`],
    };
  }

  let skippedPaths = 0;
  for (const e of topLevel) {
    const row = observed.get(e.resource_id.toLowerCase());
    if (e.change_type === 'Delete') {
      checks.push({
        name: 'resource-deleted',
        resourceId: e.resource_id,
        result: row ? 'fail' : 'pass',
        note: row ? 'Resource still exists' : undefined,
      });
      continue;
    }
    if (e.change_type !== 'Create' && e.change_type !== 'Modify' && e.change_type !== 'Deploy') continue;
    if (!row) {
      checks.push({
        name: 'resource-exists',
        resourceId: e.resource_id,
        result: 'fail',
        note: 'Resource not found in Resource Graph',
      });
      continue;
    }
    checks.push({ name: 'resource-exists', resourceId: e.resource_id, result: 'pass' });
    const prov = String(row.provisioningState ?? '');
    if (prov && prov.toLowerCase() !== 'succeeded')
      checks.push({
        name: 'provisioning-state',
        resourceId: e.resource_id,
        result: 'fail',
        expected: 'Succeeded',
        observed: prov,
      });
    else if (prov) checks.push({ name: 'provisioning-state', resourceId: e.resource_id, result: 'pass' });
    const state = { properties: row.properties, tags: row.tags, sku: row.sku };
    for (const pc of e.property_changes.slice(0, 100)) {
      const idx = /^(.*)\[(\d+)\]$/.exec(pc.path);
      if (
        pc.changeType === 'Delete' &&
        idx &&
        pc.before &&
        typeof pc.before === 'object' &&
        typeof (pc.before as { name?: unknown }).name === 'string'
      ) {
        const arr = getByPath(state, idx[1]!);
        const nm = String((pc.before as { name: string }).name).toLowerCase();
        const still =
          Array.isArray(arr) &&
          arr.some(
            (x) =>
              x && typeof x === 'object' && String((x as { name?: unknown }).name ?? '').toLowerCase() === nm,
          );
        checks.push({
          name: 'array-element-removed',
          resourceId: e.resource_id,
          result: still ? 'fail' : 'pass',
          expected: `no element named ${nm}`,
          note: pc.path,
        });
        continue;
      }
      if (/\[\d+\]/.test(pc.path)) {
        skippedPaths++;
        continue;
      }
      if (pc.changeType === 'Delete') {
        const o = getByPath(state, pc.path);
        checks.push({
          name: 'property-removed',
          resourceId: e.resource_id,
          result: o === undefined ? 'pass' : 'fail',
          expected: '(absent)',
          observed: o,
          note: pc.path,
        });
        continue;
      }
      if (pc.after === undefined || (pc.after !== null && typeof pc.after === 'object')) {
        skippedPaths++;
        continue;
      }
      const o = getByPath(state, pc.path);
      checks.push({
        name: 'property-value',
        resourceId: e.resource_id,
        result: eq(o, pc.after) ? 'pass' : 'fail',
        expected: pc.after,
        observed: o,
        note: pc.path,
      });
    }
  }
  if (skippedPaths)
    limitations.push(
      `${skippedPaths} array-indexed or structured property change(s) could not be compared positionally.`,
    );

  let healthKnown = false;
  if (envResourceGroup && /^[A-Za-z0-9._()-]+$/.test(envResourceGroup)) {
    try {
      const rows = await arg.query(
        `alertsmanagementresources | where type == 'microsoft.alertsmanagement/alerts' | where tostring(properties.essentials.monitorCondition) == 'Fired' | where tolower(tostring(properties.essentials.targetResourceGroup)) == '${envResourceGroup.toLowerCase()}' | where todatetime(properties.essentials.startDateTime) >= datetime(${deploymentStartedAt.toISOString()}) | project id, name, sev=tostring(properties.essentials.severity)`,
        subscriptions,
      );
      healthKnown = true;
      checks.push({
        name: 'fired-alerts-since-deployment',
        result: rows.length === 0 ? 'pass' : 'fail',
        observed: rows.length,
        note: rows.length
          ? rows
              .slice(0, 5)
              .map((r) => `${String(r.name)} (${String(r.sev)})`)
              .join(', ')
          : undefined,
      });
    } catch (e) {
      limitations.push(`Alert query failed: ${(e as Error).message.slice(0, 160)}`);
    }
  } else limitations.push('Environment has no resource group configured; health signals were not queried.');

  const discrepancies = checks.filter((c) => c.result === 'fail');
  let status: VerificationStatus;
  if (discrepancies.length) status = 'failed';
  else if (!healthKnown || skippedPaths > 0 || children.length > 0 || checks.length < 2)
    status = 'partially_verified';
  else status = 'passed';
  return { status, checks, discrepancies, limitations };
}

export async function verifyDeployment(
  db: Db,
  arg: ResourceGraphClient | null,
  deploymentId: string,
  actor: string,
): Promise<{ id: string } & VerificationResult> {
  const d = await db.query<{
    id: string;
    assessment_id: string;
    status: string;
    authorized_at: Date;
    env_name: string;
    subscription_id: string | null;
    resource_group: string | null;
  }>(
    `SELECT d.id, d.assessment_id, d.status, d.authorized_at, e.name AS env_name, e.subscription_id, e.resource_group FROM deployments d JOIN environments e ON e.id=d.environment_id WHERE d.id=$1`,
    [deploymentId],
  );
  const dep = d.rows[0];
  if (!dep) throw Object.assign(new Error('Deployment not found'), { status: 404 });
  const exp = await db.query<ExpectedResource>(
    `SELECT resource_id, type, name, change_type, property_changes, resource_group FROM changed_resources WHERE assessment_id=$1`,
    [dep.assessment_id],
  );
  const subs = [
    ...new Set(
      [
        dep.subscription_id,
        ...exp.rows.map((r) => /\/subscriptions\/([^/]+)/i.exec(r.resource_id)?.[1]),
      ].filter((s): s is string => !!s),
    ),
  ];
  const result = await compareState(exp.rows, arg, subs, dep.resource_group, dep.authorized_at, dep.status);
  return withTx(db, async (tx) => {
    const ins = await tx.query<{ id: string }>(
      `INSERT INTO verifications(deployment_id,status,checks,discrepancies,limitations,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        dep.id,
        result.status,
        JSON.stringify(result.checks),
        JSON.stringify(result.discrepancies),
        JSON.stringify(result.limitations),
        actor,
      ],
    );
    await audit(tx, {
      actor,
      action: 'verification.recorded',
      assessmentId: dep.assessment_id,
      environment: dep.env_name,
      details: { deploymentId: dep.id, status: result.status, discrepancies: result.discrepancies.length },
    });
    return { id: ins.rows[0]!.id, ...result };
  });
}
