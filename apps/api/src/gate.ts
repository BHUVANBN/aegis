import type { GateDecision, RiskResult } from '@aegis/shared';
import type { Config } from './config.js';
import type { Db } from './db/db.js';
import { withTx } from './db/db.js';
import { audit } from './audit.js';
import { AppError } from './util.js';

export interface GateInput {
  status: 'pending' | 'running' | 'complete' | 'partial' | 'failed';
  risk: Pick<RiskResult, 'level' | 'confidence' | 'overriddenByProhibited'> | null;
  envKind: 'dev' | 'staging' | 'prod';
  hasProhibited: boolean;
}
export interface GateResult {
  decision: GateDecision;
  reasons: string[];
}

/** Pure, deterministic policy. No I/O, no AI. Fails closed on anything missing. */
export function evaluateGate(
  i: GateInput,
  cfg: Pick<Config, 'MEDIUM_REQUIRES_APPROVAL_IN' | 'MIN_CONFIDENCE_FOR_AUTO_ALLOW'>,
): GateResult {
  const reasons: string[] = [];
  if (i.status === 'pending' || i.status === 'running')
    return { decision: 'block', reasons: ['Assessment has not completed'] };
  if (i.status === 'failed' || !i.risk)
    return { decision: 'block', reasons: ['Assessment failed or produced no risk result (fail closed)'] };
  if (i.risk.level === 'critical' || i.hasProhibited || i.risk.overriddenByProhibited) {
    reasons.push(i.hasProhibited ? 'A prohibited change pattern was detected' : 'Risk level is critical');
    return { decision: 'block', reasons };
  }
  if (i.risk.level === 'high')
    return { decision: 'require_approval', reasons: ['High risk requires authorized human approval'] };
  const lowConfidence = i.risk.confidence < cfg.MIN_CONFIDENCE_FOR_AUTO_ALLOW;
  const incomplete = i.status === 'partial';
  if (i.risk.level === 'medium') {
    const kinds = cfg.MEDIUM_REQUIRES_APPROVAL_IN.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (kinds.includes(i.envKind))
      return {
        decision: 'require_approval',
        reasons: [`Medium risk in ${i.envKind} requires approval (configured)`],
      };
    if (lowConfidence || incomplete)
      return {
        decision: 'require_approval',
        reasons: ['Medium risk with incomplete or low-confidence evidence requires approval'],
      };
    return {
      decision: 'allow',
      reasons: [`Medium risk allowed in ${i.envKind} by configuration; evidence complete`],
    };
  }
  if (lowConfidence)
    reasons.push(
      `Confidence ${i.risk.confidence} is below the auto-allow minimum ${cfg.MIN_CONFIDENCE_FOR_AUTO_ALLOW}`,
    );
  if (incomplete) reasons.push('Assessment is partial: one or more evidence sources were unavailable');
  if (reasons.length)
    return {
      decision: 'require_approval',
      reasons: ['Low risk but not auto-allowed: ' + reasons.join('; ')],
    };
  return { decision: 'allow', reasons: ['Low risk, complete evidence, confidence above minimum'] };
}

export interface AuthorizeInput {
  assessmentId: string;
  artifactDigest: string;
  environment: string;
  pipelineRunId: string;
  actor: string;
}
export interface AuthorizeResult {
  authorized: boolean;
  deploymentId?: string;
  decision: GateDecision | 'deny';
  reasons: string[];
}

const LOCK_MINUTES = 60;

/**
 * Deployment authorization. Re-derives the decision from the database (never from the caller), verifies
 * artifact/environment/version binding, consumes the approval exactly once, and takes a per-environment lock.
 * Every outcome, including denials, is written to the audit trail.
 */
export async function authorizeDeployment(db: Db, cfg: Config, a: AuthorizeInput): Promise<AuthorizeResult> {
  return withTx(db, async (tx) => {
    const deny = async (
      reasons: string[],
      assessmentId: string | null = a.assessmentId,
    ): Promise<AuthorizeResult> => {
      await audit(tx, {
        actor: a.actor,
        action: 'deployment.authorize.denied',
        assessmentId,
        environment: a.environment,
        details: { reasons, artifactDigest: a.artifactDigest, pipelineRunId: a.pipelineRunId },
      });
      return { authorized: false, decision: 'deny', reasons };
    };
    const q = await tx.query<{
      id: string;
      status: string;
      version: number;
      artifact_digest: string;
      env_id: string;
      env_name: string;
      env_kind: 'dev' | 'staging' | 'prod';
      risk_level: 'low' | 'medium' | 'high' | 'critical' | null;
      confidence: string | null;
      risk_detail: { overriddenByProhibited?: boolean } | null;
      has_prohibited: boolean;
    }>(
      `SELECT a.id, a.status, a.version, a.artifact_digest, e.id AS env_id, e.name AS env_name, e.kind AS env_kind, a.risk_level, a.confidence, a.risk_detail,
              EXISTS (SELECT 1 FROM policy_findings pf WHERE pf.assessment_id = a.id AND pf.prohibited) AS has_prohibited
       FROM assessments a JOIN environments e ON e.id = a.environment_id WHERE a.id = $1 FOR UPDATE OF a`,
      [a.assessmentId],
    );
    const row = q.rows[0];
    if (!row) return deny(['Unknown assessment'], null);
    if (row.env_name !== a.environment) return deny(['Environment does not match the assessed environment']);
    if (row.artifact_digest !== a.artifactDigest)
      return deny(['Artifact digest does not match the assessed artifact']);

    // expire stale in-flight locks, then expire stale approvals
    await tx.query(
      `UPDATE deployments SET status='expired', completed_at=now(), message='lock expired' WHERE status='authorized' AND lock_expires_at < now()`,
    );
    await tx.query(
      `UPDATE approval_requests SET status='expired' WHERE status='approved' AND expires_at < now()`,
    );

    const gate = evaluateGate(
      {
        status: row.status as GateInput['status'],
        risk: row.risk_level
          ? {
              level: row.risk_level,
              confidence: Number(row.confidence),
              overriddenByProhibited: !!row.risk_detail?.overriddenByProhibited,
            }
          : null,
        envKind: row.env_kind,
        hasProhibited: row.has_prohibited,
      },
      cfg,
    );
    if (gate.decision === 'block') return deny(gate.reasons);

    let approvalId: string | null = null;
    if (gate.decision === 'require_approval') {
      const ap = await tx.query<{
        id: string;
        status: string;
        assessment_version: number;
        artifact_digest: string;
        environment_id: string;
        expires_at: Date | null;
      }>(
        `SELECT id, status, assessment_version, artifact_digest, environment_id, expires_at FROM approval_requests WHERE assessment_id = $1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [a.assessmentId],
      );
      const r = ap.rows[0];
      if (!r) return deny([...gate.reasons, 'No approval request exists']);
      if (r.status !== 'approved') return deny([...gate.reasons, `Approval is ${r.status}, not approved`]);
      if (!r.expires_at || r.expires_at.getTime() < Date.now())
        return deny([...gate.reasons, 'Approval has expired']);
      if (
        r.artifact_digest !== a.artifactDigest ||
        r.environment_id !== row.env_id ||
        r.assessment_version !== row.version
      )
        return deny([
          ...gate.reasons,
          'Approval is bound to a different artifact, environment or assessment version',
        ]);
      approvalId = r.id;
    }

    const inflight = await tx.query(
      "SELECT 1 FROM deployments WHERE environment_id=$1 AND status='authorized'",
      [row.env_id],
    );
    if (inflight.rowCount) return deny(['Another deployment is already in progress for this environment']);

    const ins = await tx
      .query<{ id: string }>(
        `INSERT INTO deployments(assessment_id, approval_id, environment_id, artifact_digest, pipeline_run_id, authorized_by, lock_expires_at, gate_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6, now() + ($7 || ' minutes')::interval, $8) RETURNING id`,
        [
          a.assessmentId,
          approvalId,
          row.env_id,
          a.artifactDigest,
          a.pipelineRunId,
          a.actor,
          String(LOCK_MINUTES),
          JSON.stringify({
            decision: gate.decision,
            reasons: gate.reasons,
            riskLevel: row.risk_level,
            confidence: row.confidence,
            assessmentVersion: row.version,
          }),
        ],
      )
      .catch((e: { code?: string }) => {
        if (e.code === '23505') return null; // approval already consumed or lock race
        throw e;
      });
    if (!ins)
      return deny([
        'Approval already used for a deployment, or a concurrent deployment holds the environment lock',
      ]);
    if (approvalId)
      await tx.query(`UPDATE approval_requests SET status='consumed' WHERE id=$1`, [approvalId]);
    await audit(tx, {
      actor: a.actor,
      action: 'deployment.authorized',
      assessmentId: a.assessmentId,
      environment: a.environment,
      details: {
        deploymentId: ins.rows[0]!.id,
        decision: gate.decision,
        reasons: gate.reasons,
        approvalId,
        artifactDigest: a.artifactDigest,
      },
    });
    return {
      authorized: true,
      deploymentId: ins.rows[0]!.id,
      decision: gate.decision,
      reasons: gate.reasons,
    };
  }).catch((e) => {
    if (e instanceof AppError) throw e;
    throw e;
  });
}
