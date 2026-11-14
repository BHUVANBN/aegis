import type { ChangedResource, Finding, Recommendation } from '@aegis/shared';

const T: Record<string, (r: ChangedResource | undefined) => Recommendation[]> = {
  'LR-NET-001': (r) => [
    {
      findingId: null,
      kind: 'preventive',
      title: 'Keep a public HTTPS allow path, or prove it is intentionally removed',
      priority: 1,
      steps: [
        `Restore the inbound TCP/443 allow rule on ${r?.name ?? 'the NSG'} in the Bicep source, or document the replacement (Application Gateway, Front Door, private endpoint).`,
        'Run `az network nsg rule list -g <rg> --nsg-name <nsg> -o table` against the live NSG and confirm another rule (lower priority number) still allows 443 from the intended sources.',
        'Resubmit the change so AEGIS re-assesses the new artifact digest.',
      ],
    },
    {
      findingId: null,
      kind: 'recovery',
      title: 'Prepare a fast rollback for the NSG rule',
      priority: 3,
      steps: [
        'Record the current rule (name, priority, source, port) from the What-If evidence.',
        'Keep `az network nsg rule create ...` for the removed rule ready in the change record.',
      ],
    },
  ],
  'LR-NET-002': (r) => [
    {
      findingId: null,
      kind: 'preventive',
      title: 'Do not expose sensitive ports to the Internet',
      priority: 1,
      steps: [
        `Replace the Any/Internet source on ${r?.name ?? 'the rule'} with specific CIDR ranges, a service tag for a trusted service, or use Azure Bastion / Just-in-Time access.`,
        'Re-run What-If and confirm the rule no longer allows */Internet on management or database ports.',
      ],
    },
  ],
  'LR-NET-003': () => [
    {
      findingId: null,
      kind: 'preventive',
      title: 'Review the effective security rules after the change',
      priority: 2,
      steps: [
        'After deployment run `az network watcher show-effective-nsg` (or Network Watcher > Effective security rules) for the affected NIC/subnet.',
        'Verify that dependent workloads listed in the dependency tab still have the connectivity they need.',
      ],
    },
  ],
  'LR-DEL-001': (r) => [
    {
      findingId: null,
      kind: 'preventive',
      title: 'Do not delete data resources through an automated deployment',
      priority: 1,
      steps: [
        `Remove ${r?.name ?? 'the resource'} from the deletion set (deployment mode Incremental, or keep it in the template).`,
        'If deletion is intended, schedule it as a separate change with an owner sign-off and a verified backup.',
      ],
    },
    {
      findingId: null,
      kind: 'recovery',
      title: 'Confirm backup and restore capability before any deletion',
      priority: 2,
      steps: [
        'Verify a recent backup/export exists and perform a test restore to a scratch resource group.',
        'Enable soft delete / purge protection where the service supports it.',
      ],
    },
  ],
  'LR-DEL-002': () => [
    {
      findingId: null,
      kind: 'preventive',
      title: 'Confirm the deletion is intended',
      priority: 2,
      steps: [
        'Check whether the deployment uses Complete mode; Incremental mode does not delete unlisted resources.',
        'Review the confirmed dependents in the dependency tab and notify their owners.',
      ],
    },
  ],
  'LR-STG-001': () => [
    {
      findingId: null,
      kind: 'preventive',
      title: 'Disable anonymous blob access',
      priority: 1,
      steps: [
        'Set `allowBlobPublicAccess: false` on the storage account in Bicep.',
        'Use SAS tokens, private endpoints, or Azure Front Door/CDN for public content instead.',
      ],
    },
  ],
  'LR-EXP-001': () => [
    {
      findingId: null,
      kind: 'preventive',
      title: 'Prefer private connectivity',
      priority: 1,
      steps: [
        'Keep `publicNetworkAccess: Disabled` and use a private endpoint, or restrict with firewall rules to known IP ranges.',
      ],
    },
  ],
  'LR-EXP-002': () => [
    {
      findingId: null,
      kind: 'preventive',
      title: 'Use Deny as the default network ACL action',
      priority: 1,
      steps: ['Set `networkAcls.defaultAction: Deny` and add explicit virtual network or IP rules.'],
    },
  ],
  'LR-ENC-001': () => [
    {
      findingId: null,
      kind: 'preventive',
      title: 'Restore the original encryption and transport settings',
      priority: 1,
      steps: [
        'Revert the weakened properties listed in the evidence (HTTPS-only, TLS >= 1.2, soft delete, purge protection).',
        'If a legacy client requires the weaker setting, track an exception with an expiry date rather than changing the default.',
      ],
    },
  ],
  'LR-IAM-001': (r) => [
    {
      findingId: null,
      kind: 'preventive',
      title: 'Apply least privilege to the role assignment',
      priority: 1,
      steps: [
        `Replace the privileged role on ${r?.name ?? 'the assignment'} with a built-in role scoped to the specific resource group or resource.`,
        'Use Privileged Identity Management for time-bound elevation instead of a permanent assignment.',
      ],
    },
  ],
  'LR-IAM-002': () => [
    {
      findingId: null,
      kind: 'preventive',
      title: 'Review the new role assignment',
      priority: 3,
      steps: [
        'Confirm the principal and scope with the resource owner; list with `az role assignment list --scope <scope> -o table` after deployment.',
      ],
    },
  ],
  'LR-DB-001': () => [
    {
      findingId: null,
      kind: 'preventive',
      title: 'Validate the database change in a non-production environment first',
      priority: 2,
      steps: ['Deploy the same template to a dev/staging environment and run application smoke tests.'],
    },
    {
      findingId: null,
      kind: 'recovery',
      title: 'Take a point-in-time restore marker before changing the database',
      priority: 2,
      steps: ['Record the current time and confirm PITR/backup retention covers the change window.'],
    },
  ],
  'LR-PROD-001': () => [
    {
      findingId: null,
      kind: 'preventive',
      title: 'Schedule production changes in an approved window',
      priority: 3,
      steps: ['Run during a low-traffic window and define the health checks that must pass afterwards.'],
    },
  ],
  'AP-NONCOMPLIANT': () => [
    {
      findingId: null,
      kind: 'preventive',
      title: 'Resolve existing policy non-compliance',
      priority: 3,
      steps: [
        'Open Azure Policy > Compliance for the resource, remediate, or file an exemption through the governance process (never bypass the policy).',
      ],
    },
  ],
};

export function runPlanningAgent(
  findings: Finding[],
  resources: ChangedResource[],
  missingEvidence: string[],
): Recommendation[] {
  const out: Recommendation[] = [];
  const seen = new Set<string>();
  for (const f of findings) {
    const tpl = T[f.ruleId];
    const r = resources.find((x) => x.resourceId === f.resourceId);
    for (const rec of tpl ? tpl(r) : []) {
      const key = `${f.ruleId}|${f.resourceId}|${rec.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...rec, findingId: f.id });
    }
  }
  if (missingEvidence.length)
    out.push({
      findingId: null,
      kind: 'preventive',
      priority: 2,
      title: 'Restore missing evidence and re-run the assessment',
      steps: [
        'Grant the AEGIS identity Reader on the target subscription (and Policy Insights Data Reader) and confirm Resource Graph is reachable.',
        ...missingEvidence.map((m) => `Resolve: ${m}`),
      ],
    });
  return out.sort((a, b) => a.priority - b.priority);
}
