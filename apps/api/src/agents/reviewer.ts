import type { Finding, GateDecision, Recommendation, ReviewBrief } from '@aegis/shared';
import type { GateResult } from '../gate.js';

/**
 * The "Gatekeeper" of your slides: prepares the decision for human/pipeline approval. Deterministic. It does NOT decide:
 * its recommendedAction is copied from the gate. It produces the checklist an approver should work through and lists open
 * questions caused by missing evidence, so an approval is informed rather than a click-through.
 */
export function runReviewerAgent(args: {
  gate: GateResult;
  findings: Finding[];
  recommendations: Recommendation[];
  missingEvidence: string[];
  blastRadius: { confirmedDependents: number; inferredRelated: number; destructiveOperations: number };
  envKind: string;
}): ReviewBrief {
  const { gate, findings, recommendations, missingEvidence, blastRadius, envKind } = args;
  const decision: GateDecision = gate.decision;
  const checklist: ReviewBrief['checklist'] = [];
  const top = [...findings].sort((a, b) => rank(b.severity) - rank(a.severity)).slice(0, 5);
  for (const f of top)
    checklist.push({ item: `Confirm the intent behind: ${f.title}`, evidenceRef: `policy-findings/${f.id}` });
  if (blastRadius.destructiveOperations > 0)
    checklist.push({
      item: `Confirm ${blastRadius.destructiveOperations} deletion(s) are intended and backed up`,
      evidenceRef: 'resources',
    });
  if (blastRadius.confirmedDependents > 0)
    checklist.push({
      item: `Notify owners of ${blastRadius.confirmedDependents} confirmed dependent resource(s)`,
      evidenceRef: 'dependencies',
    });
  const preventive = recommendations.filter((r) => r.kind === 'preventive').slice(0, 3);
  for (const r of preventive)
    checklist.push({ item: `Check the mitigation was applied: ${r.title}`, evidenceRef: 'recommendations' });
  if (envKind === 'prod')
    checklist.push({
      item: 'Confirm an approved change window and a rollback owner',
      evidenceRef: 'process',
    });
  checklist.push({
    item: 'Approve only if you are not the person who requested it (the system enforces this)',
    evidenceRef: 'approvals',
  });
  return {
    recommendedAction: decision,
    requiredApproverRole:
      decision === 'require_approval' ? 'approver' : decision === 'block' ? 'not-approvable' : 'none',
    headline:
      decision === 'block'
        ? 'Blocked: this change cannot be approved. Modify the change and resubmit.'
        : decision === 'require_approval'
          ? 'Approval required from an authorized approver other than the requester.'
          : 'Allowed by policy; no approval needed.',
    checklist,
    openQuestions: missingEvidence.map((m) => `Evidence gap: ${m}`),
    generatedBy: 'deterministic-reviewer-1.0.0',
  };
}

const rank = (s: string): number => ['info', 'low', 'medium', 'high', 'critical'].indexOf(s);
