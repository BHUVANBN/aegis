import type { Finding, RiskResult, ScoreContribution } from '@aegis/shared';
import type { DependencyOutput } from './dependency.js';
import type { PolicyOutput, EnvKind } from './policy.js';
import type { SimulationOutput } from './simulation.js';
import {
  BLAST_POINTS_CAP,
  BLAST_POINTS_PER_CONFIRMED_DEPENDENT,
  CONFIDENCE_PENALTIES,
  ENV_MULTIPLIER,
  RULES_VERSION,
  SEVERITY_FLOOR,
  SEVERITY_POINTS,
  THRESHOLDS,
  maxLevel,
} from '../rules/riskRules.js';

export interface RiskInput {
  findings: Finding[];
  envKind: EnvKind;
  dependency: DependencyOutput;
  policy: PolicyOutput;
  simulation: SimulationOutput;
  perceptionWarnings: number;
  truncated: boolean;
}

export function levelForScore(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score < THRESHOLDS.low) return 'low';
  if (score < THRESHOLDS.medium) return 'medium';
  if (score < THRESHOLDS.high) return 'high';
  return 'critical';
}

export function runRiskAgent(i: RiskInput): RiskResult {
  const mult = ENV_MULTIPLIER[i.envKind];
  const contributions: ScoreContribution[] = [];
  for (const f of i.findings) {
    const base = SEVERITY_POINTS[f.severity];
    const points = Math.round(base * f.likelihood * mult * 100) / 100;
    if (points > 0)
      contributions.push({
        findingId: f.id,
        factor: f.category,
        points,
        explanation: `${f.severity} (${base}) x likelihood ${f.likelihood} x ${i.envKind} multiplier ${mult} = ${points}`,
      });
  }
  const blast = Math.min(
    BLAST_POINTS_CAP,
    i.simulation.blastRadius.confirmedDependents * BLAST_POINTS_PER_CONFIRMED_DEPENDENT,
  );
  if (blast > 0)
    contributions.push({
      findingId: null,
      factor: 'blast-radius',
      points: blast,
      explanation: `${i.simulation.blastRadius.confirmedDependents} confirmed dependent(s) x ${BLAST_POINTS_PER_CONFIRMED_DEPENDENT}, capped at ${BLAST_POINTS_CAP}`,
    });

  const score = Math.min(100, Math.round(contributions.reduce((s, c) => s + c.points, 0)));
  let level = levelForScore(score);
  for (const f of i.findings) {
    const floor = SEVERITY_FLOOR[f.severity];
    if (floor) level = maxLevel(level, floor);
  }
  const overriddenByProhibited = i.findings.some((f) => f.prohibited);
  if (overriddenByProhibited) level = 'critical';

  let confidence = 1;
  const missing: string[] = [];
  if (i.dependency.status === 'unavailable') {
    confidence -= CONFIDENCE_PENALTIES.dependencyUnavailable;
    missing.push(`Dependency evidence unavailable: ${i.dependency.reason ?? 'unknown'}`);
  } else if (i.dependency.status === 'partial') {
    confidence -= CONFIDENCE_PENALTIES.dependencyPartial;
    missing.push(`Dependency evidence partial: ${i.dependency.reason ?? 'unknown'}`);
  }
  if (i.policy.azurePolicy.status === 'unavailable') {
    confidence -= CONFIDENCE_PENALTIES.policyUnavailable;
    missing.push(`Azure Policy evidence unavailable: ${i.policy.azurePolicy.reason ?? 'unknown'}`);
  } else if (i.policy.azurePolicy.status === 'partial') {
    confidence -= CONFIDENCE_PENALTIES.policyPartial;
    missing.push('Azure Policy evidence partial');
  }
  if (i.truncated) {
    confidence -= CONFIDENCE_PENALTIES.truncated;
    missing.push('What-If output was truncated; some changes were not analysed');
  }
  if (i.perceptionWarnings > 0) {
    confidence -= Math.min(
      CONFIDENCE_PENALTIES.maxWarningPenalty,
      i.perceptionWarnings * CONFIDENCE_PENALTIES.perWarning,
    );
    missing.push(`${i.perceptionWarnings} What-If parser warning(s)`);
  }
  confidence = Math.max(0, Math.round(confidence * 1000) / 1000);
  return {
    score,
    level,
    confidence,
    rulesVersion: RULES_VERSION,
    contributions,
    missingEvidence: missing,
    overriddenByProhibited,
  };
}
