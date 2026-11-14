import type { ChangedResource, Hypothesis } from '@aegis/shared';
import { classifyResource, type ResourceClass } from './classify.js';
import { sha256Hex } from '../util.js';

export const REASONING_VERSION = 'deterministic-reasoning-1.0.0';

interface Template {
  statement: (r: ChangedResource, env: string) => string;
  whatWouldConfirm: string;
  rules: string[];
}

/**
 * The "Analyst" of your slides: understands the resource, the environment and the potential impact and states RISK HYPOTHESES.
 * It is deterministic (class + change type -> template). Hypotheses are questions for humans and for later evidence; they are
 * NOT scored and cannot change the risk level or the gate. Free text from the repository is never copied into a statement
 * except the resource type and name, which are length-limited and character-restricted.
 */
const TEMPLATES: Partial<Record<ResourceClass, Template>> = {
  'network-security': {
    statement: (r, env) =>
      `The ${r.changeType.toLowerCase()} of ${r.type} "${r.name}" in ${env} may change which traffic can reach workloads behind it.`,
    whatWouldConfirm:
      'Effective security rules on the affected subnet/NIC (Network Watcher) and the confirmed dependents in the dependency evidence.',
    rules: ['LR-NET-001', 'LR-NET-002', 'LR-NET-003'],
  },
  database: {
    statement: (r, env) =>
      `The ${r.changeType.toLowerCase()} of database resource "${r.name}" in ${env} may interrupt connections or alter data protection.`,
    whatWouldConfirm:
      'Application connection health after the change, backup/PITR coverage for the change window, and consumers listed in the dependency evidence.',
    rules: ['LR-DB-001', 'LR-DEL-001', 'LR-ENC-001'],
  },
  'data-store': {
    statement: (r, env) =>
      `The ${r.changeType.toLowerCase()} of data resource ${r.type} "${r.name}" in ${env} may expose or remove stored data.`,
    whatWouldConfirm:
      'Access configuration after the change (public access, network ACLs, soft delete/purge protection) and who consumes the resource.',
    rules: ['LR-STG-001', 'LR-EXP-001', 'LR-EXP-002', 'LR-ENC-001', 'LR-DEL-001'],
  },
  identity: {
    statement: (r, env) =>
      `The ${r.changeType.toLowerCase()} of identity/authorization resource "${r.name}" in ${env} may grant a principal broader permissions than intended.`,
    whatWouldConfirm:
      'The principal, the role definition and the scope; whether a narrower built-in role at a lower scope would work.',
    rules: ['LR-IAM-001', 'LR-IAM-002'],
  },
  compute: {
    statement: (r, env) =>
      `The ${r.changeType.toLowerCase()} of compute resource ${r.type} "${r.name}" in ${env} may cause a restart or capacity change for the workload it hosts.`,
    whatWouldConfirm:
      'Whether the property change forces a restart/replace, current load, and health signals during the change window.',
    rules: ['LR-PROD-001'],
  },
  other: {
    statement: (r, env) =>
      `The ${r.changeType.toLowerCase()} of ${r.type} "${r.name}" in ${env} may affect resources that reference it.`,
    whatWouldConfirm:
      'The confirmed dependents in the dependency evidence (runtime dependencies are not visible to AEGIS).',
    rules: ['LR-PROD-001', 'LR-CREATE-001'],
  },
};

const safe = (s: string): string => s.replace(/[^A-Za-z0-9._ /()-]/g, '?').slice(0, 80);

export function runReasoningAgent(resources: ChangedResource[], envName: string): Hypothesis[] {
  const out: Hypothesis[] = [];
  for (const r of resources) {
    const cls = classifyResource(r);
    if (cls === 'unchanged' || cls === 'metadata-only') continue;
    const tpl = TEMPLATES[cls] ?? TEMPLATES.other!;
    const clean = { ...r, name: safe(r.name), type: safe(r.type) };
    out.push({
      id: `H-${sha256Hex(`${r.resourceId.toLowerCase()}|${cls}`).slice(0, 8)}`,
      resourceId: r.resourceId,
      resourceClass: cls,
      statement: tpl.statement(clean, safe(envName)),
      whatWouldConfirm: tpl.whatWouldConfirm,
      relatedRuleIds: tpl.rules,
    });
  }
  return out.slice(0, 200);
}
