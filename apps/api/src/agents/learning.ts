import type { Db } from '../db/db.js';

export interface RuleOutcome {
  ruleId: string;
  severity: string;
  assessments: number;
  deployed: number;
  verifiedPassed: number;
  verifiedFailed: number;
  verifiedOther: number;
  suggestion: string | null;
}

const MIN_SAMPLE = 5;

/**
 * The "Improver" of your slides, implemented as ADVISORY analytics. It reads recorded outcomes (deployments + latest verification
 * per deployment) and suggests rules for HUMAN review. It never edits a rule, a weight or a threshold: changing the risk model
 * stays a reviewed code change with a new RULES_VERSION (see manual 12.7). Suggestions need at least MIN_SAMPLE deployed changes.
 */
export async function learningSummary(
  db: Db,
): Promise<{ minSample: number; rules: RuleOutcome[]; note: string }> {
  const r = await db.query<{
    rule_id: string;
    severity: string;
    assessments: string;
    deployed: string;
    passed: string;
    failed: string;
    other: string;
  }>(`
    WITH latest AS (
      SELECT DISTINCT ON (v.deployment_id) v.deployment_id, v.status FROM verifications v ORDER BY v.deployment_id, v.created_at DESC
    ),
    per AS (
      SELECT pf.rule_id, pf.severity, a.id AS assessment_id, d.id AS deployment_id, l.status AS vstatus
      FROM policy_findings pf
      JOIN assessments a ON a.id = pf.assessment_id
      LEFT JOIN deployments d ON d.assessment_id = a.id AND d.status = 'succeeded'
      LEFT JOIN latest l ON l.deployment_id = d.id
    )
    SELECT rule_id, severity, count(DISTINCT assessment_id) AS assessments, count(DISTINCT deployment_id) AS deployed,
           count(DISTINCT deployment_id) FILTER (WHERE vstatus = 'passed') AS passed,
           count(DISTINCT deployment_id) FILTER (WHERE vstatus = 'failed') AS failed,
           count(DISTINCT deployment_id) FILTER (WHERE vstatus IN ('inconclusive','partially_verified')) AS other
    FROM per GROUP BY rule_id, severity ORDER BY rule_id, severity`);
  const rules: RuleOutcome[] = r.rows.map((x) => {
    const deployed = Number(x.deployed),
      passed = Number(x.passed),
      failed = Number(x.failed);
    let suggestion: string | null = null;
    if (deployed >= MIN_SAMPLE) {
      if (['medium', 'high'].includes(x.severity) && failed / deployed >= 0.3)
        suggestion = `${failed}/${deployed} approved deployments of changes flagged by ${x.rule_id} later FAILED verification: review whether its severity or likelihood is too low.`;
      else if (['high', 'critical'].includes(x.severity) && passed === deployed)
        suggestion = `All ${deployed} approved deployments flagged by ${x.rule_id} passed verification: review whether the rule is too strict. Passing verification is weak evidence (see manual 14.2); do not relax a rule on this alone.`;
    }
    return {
      ruleId: x.rule_id,
      severity: x.severity,
      assessments: Number(x.assessments),
      deployed,
      verifiedPassed: passed,
      verifiedFailed: failed,
      verifiedOther: Number(x.other),
      suggestion,
    };
  });
  return {
    minSample: MIN_SAMPLE,
    rules,
    note: 'Advisory only. AEGIS never changes rules or weights automatically; propose a new RULES_VERSION through code review.',
  };
}
