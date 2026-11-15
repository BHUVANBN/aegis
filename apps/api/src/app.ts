import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import crypto from 'node:crypto';
import { z, ZodError } from 'zod';
import {
  ROLES,
  AccessGrantSchema,
  ApprovalDecisionSchema,
  ApprovalRequestSchema,
  AuthorizeDeploymentSchema,
  CreateAssessmentSchema,
  DeploymentResultSchema,
  PaginationSchema,
} from '@aegis/shared';
import type { Config } from './config.js';
import { withTx, type Db } from './db/db.js';
import { audit, verifyAuditChain } from './audit.js';
import { authenticate, effectiveRoles, requireEnvRole, requireTokenRole } from './auth.js';
import { AppError } from './util.js';
import { runAssessment, type OrchestratorDeps } from './agents/orchestrator.js';
import { authorizeDeployment, evaluateGate } from './gate.js';
import { verifyDeployment } from './verification.js';
import { reconcileEnvironment } from './reconcile.js';
import { learningSummary } from './agents/learning.js';
import { registerInsights } from './insights.js';
import type { ResourceGraphClient } from './azure/resourceGraph.js';
import type { LlmProvider } from './llm/provider.js';

export interface AppDeps {
  db: Db;
  cfg: Config;
  arg: ResourceGraphClient | null;
  llm: LlmProvider;
}
export type AegisApp = express.Express & { drain: () => Promise<void> };

const uuid = z.string().uuid();
const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
const me = (req: Request) => req.principal!;
const idParam = (req: Request): string => {
  const r = uuid.safeParse(req.params.id);
  if (!r.success) throw new AppError(400, 'invalid_id', 'Path id must be a UUID');
  return r.data;
};

export function createApp(deps: AppDeps): AegisApp {
  const { db, cfg } = deps;
  const app = express() as AegisApp;
  const log = pino({
    level: cfg.NODE_ENV === 'test' ? 'silent' : 'info',
    redact: ['req.headers.authorization', 'req.headers.cookie'],
  });
  const inflight = new Set<Promise<void>>();
  app.drain = async () => {
    await Promise.all([...inflight]);
  };

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(
    pinoHttp({
      logger: log,
      genReqId: (req) => (req.headers['x-request-id'] as string) ?? crypto.randomUUID(),
      serializers: { req: (r) => ({ id: r.id, method: r.method, url: String(r.url).split('?')[0] }) },
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  const origins = cfg.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.use(
    cors({
      origin: (o, cb) => cb(null, !o || origins.includes(o)),
      methods: ['GET', 'POST', 'PUT'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
      maxAge: 600,
    }),
  );
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: cfg.RATE_LIMIT_PER_MINUTE,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (r) => r.path === '/healthz',
    }),
  );
  app.use(express.json({ limit: '5mb' }));

  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get(
    '/readyz',
    wrap(async (_req, res) => {
      try {
        await db.query('SELECT 1');
        res.json({
          status: 'ready',
          authMode: cfg.AUTH_MODE,
          llm: deps.llm.name,
          resourceGraph: deps.arg ? 'enabled' : 'disabled',
        });
      } catch {
        res.status(503).json({ status: 'not_ready' });
      }
    }),
  );

  const api = express.Router();
  api.use(authenticate(cfg, db));

  api.get(
    '/me',
    wrap(async (req, res) => {
      const p = me(req);
      const g = await db.query(
        `SELECT e.name AS environment, e.kind, ea.role FROM environment_access ea JOIN environments e ON e.id=ea.environment_id WHERE ea.principal_oid=$1 ORDER BY e.name`,
        [p.oid],
      );
      res.json({ oid: p.oid, name: p.name, email: p.email, tokenRoles: p.roles, grants: g.rows });
    }),
  );

  // every route below requires at least one recognised role in the token (a database grant alone is not enough)
  api.use(requireTokenRole(...ROLES));

  api.get(
    '/environments',
    wrap(async (req, res) => {
      const r = await db.query(
        `SELECT DISTINCT e.id, e.name, e.kind, p.key AS project_key FROM environments e JOIN projects p ON p.id=e.project_id JOIN environment_access ea ON ea.environment_id=e.id WHERE ea.principal_oid=$1 ORDER BY p.key, e.name`,
        [me(req).oid],
      );
      res.json({ items: r.rows });
    }),
  );

  // ---- assessments
  api.post(
    '/assessments',
    wrap(async (req, res) => {
      const p = me(req);
      const body = CreateAssessmentSchema.parse(req.body);
      const env = await db.query<{ id: string; project_id: string; name: string }>(
        `SELECT e.id, e.project_id, e.name FROM environments e JOIN projects p ON p.id=e.project_id WHERE p.key=$1 AND e.name=$2`,
        [body.projectKey, body.environment],
      );
      const e = env.rows[0];
      if (!e) throw new AppError(404, 'not_found', 'Unknown project or environment');
      await requireEnvRole(db, p, e.id, ['assessor', 'pipeline']);
      const ins = await withTx(db, async (tx) => {
        const r = await tx.query<{ id: string }>(
          `INSERT INTO assessments(project_id, environment_id, commit_sha, pipeline_run_id, artifact_digest, template_path, whatif_raw, requested_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (environment_id, pipeline_run_id, artifact_digest) DO NOTHING RETURNING id`,
          [
            e.project_id,
            e.id,
            body.commitSha,
            body.pipelineRunId,
            body.artifactDigest,
            body.templatePath,
            JSON.stringify(body.whatIf ?? null),
            p.oid,
          ],
        );
        if (!r.rows[0]) return null;
        await audit(tx, {
          actor: p.oid,
          action: 'assessment.created',
          assessmentId: r.rows[0].id,
          environment: e.name,
          details: {
            commitSha: body.commitSha,
            pipelineRunId: body.pipelineRunId,
            artifactDigest: body.artifactDigest,
            templatePath: body.templatePath,
          },
        });
        return r.rows[0].id;
      });
      if (!ins) {
        const ex = await db.query<{ id: string; status: string }>(
          `SELECT id, status FROM assessments WHERE environment_id=$1 AND pipeline_run_id=$2 AND artifact_digest=$3`,
          [e.id, body.pipelineRunId, body.artifactDigest],
        );
        res.status(200).json({ id: ex.rows[0]!.id, status: ex.rows[0]!.status, duplicate: true });
        return;
      }
      const orch: OrchestratorDeps = { db, cfg, arg: deps.arg, llm: deps.llm };
      const job = runAssessment(orch, ins)
        .catch((err) => log.error({ err: (err as Error).message, assessmentId: ins }, 'assessment crashed'))
        .then(() => undefined);
      inflight.add(job);
      void job.finally(() => inflight.delete(job));
      res.status(202).json({ id: ins, status: 'pending', duplicate: false });
    }),
  );

  async function loadAssessment(
    req: Request,
    roles: ('viewer' | 'assessor' | 'approver' | 'admin' | 'pipeline')[] = [
      'viewer',
      'assessor',
      'approver',
      'pipeline',
    ],
  ) {
    const id = idParam(req);
    const r = await db.query(
      `SELECT a.*, e.name AS environment, e.kind AS environment_kind, p.key AS project_key FROM assessments a JOIN environments e ON e.id=a.environment_id JOIN projects p ON p.id=a.project_id WHERE a.id=$1`,
      [id],
    );
    const a = r.rows[0];
    if (!a) throw new AppError(404, 'not_found', 'Assessment not found');
    await requireEnvRole(db, me(req), a.environment_id, roles);
    return a as Record<string, unknown> & {
      id: string;
      environment_id: string;
      environment: string;
      environment_kind: 'dev' | 'staging' | 'prod';
      status: string;
      version: number;
      artifact_digest: string;
      requested_by: string;
      gate_decision: string | null;
    };
  }
  const publicAssessment = (a: Record<string, unknown>) => {
    const { whatif_raw: _w, ...rest } = a;
    return rest;
  };

  api.get(
    '/assessments',
    wrap(async (req, res) => {
      const pg = PaginationSchema.parse(req.query);
      const envName = typeof req.query.environment === 'string' ? req.query.environment : null;
      const where = `ea.principal_oid=$1 AND ($2::text IS NULL OR e.name=$2)`;
      const total = await db.query<{ n: string }>(
        `SELECT count(DISTINCT a.id) AS n FROM assessments a JOIN environments e ON e.id=a.environment_id JOIN environment_access ea ON ea.environment_id=e.id WHERE ${where}`,
        [me(req).oid, envName],
      );
      const rows = await db.query(
        `SELECT DISTINCT a.id, a.status, a.risk_level, a.risk_score, a.confidence, a.gate_decision, a.artifact_digest, a.commit_sha, a.pipeline_run_id, a.created_at, e.name AS environment, e.kind AS environment_kind FROM assessments a JOIN environments e ON e.id=a.environment_id JOIN environment_access ea ON ea.environment_id=e.id WHERE ${where} ORDER BY a.created_at DESC LIMIT $3 OFFSET $4`,
        [me(req).oid, envName, pg.limit, pg.offset],
      );
      res.json({ items: rows.rows, total: Number(total.rows[0]!.n), limit: pg.limit, offset: pg.offset });
    }),
  );

  api.get(
    '/assessments/:id',
    wrap(async (req, res) => {
      res.json(publicAssessment(await loadAssessment(req)));
    }),
  );
  const child = (path: string, table: string, order: string) =>
    api.get(
      `/assessments/:id/${path}`,
      wrap(async (req, res) => {
        const a = await loadAssessment(req);
        const r = await db.query(`SELECT * FROM ${table} WHERE assessment_id=$1 ORDER BY ${order}`, [a.id]);
        res.json({ items: r.rows });
      }),
    );
  child('resources', 'changed_resources', 'resource_id');
  child('dependencies', 'dependencies', 'kind, from_resource_id');
  child('policy-findings', 'policy_findings', 'severity, rule_id');
  child('scenarios', 'impact_scenarios', 'basis, title');
  child('recommendations', 'recommendations', 'priority');
  child('agent-runs', 'agent_runs', 'started_at');
  api.get(
    '/assessments/:id/risk',
    wrap(async (req, res) => {
      const a = await loadAssessment(req);
      const c = await db.query(
        `SELECT finding_key, factor, points, explanation FROM risk_contributions WHERE assessment_id=$1 ORDER BY points DESC`,
        [a.id],
      );
      res.json({
        score: a.risk_score,
        level: a.risk_level,
        confidence: a.confidence,
        rulesVersion: a.rules_version,
        detail: a.risk_detail,
        contributions: c.rows,
      });
    }),
  );
  api.get(
    '/assessments/:id/audit',
    wrap(async (req, res) => {
      const a = await loadAssessment(req);
      const r = await db.query(
        `SELECT id, at, actor, action, details, hash FROM audit_events WHERE assessment_id=$1 ORDER BY id`,
        [a.id],
      );
      res.json({ items: r.rows });
    }),
  );
  /** Read-only dry run of the gate: shows what authorization would decide right now. Has no side effects. */
  api.get(
    '/assessments/:id/gate',
    wrap(async (req, res) => {
      const a = await loadAssessment(req);
      const hp = await db.query<{ n: string }>(
        `SELECT count(*) AS n FROM policy_findings WHERE assessment_id=$1 AND prohibited`,
        [a.id],
      );
      const gate = evaluateGate(
        {
          status: a.status as never,
          risk: a.risk_level
            ? {
                level: a.risk_level as never,
                confidence: Number(a.confidence),
                overriddenByProhibited: !!(a.risk_detail as { overriddenByProhibited?: boolean } | null)
                  ?.overriddenByProhibited,
              }
            : null,
          envKind: a.environment_kind,
          hasProhibited: Number(hp.rows[0]!.n) > 0,
        },
        cfg,
      );
      const ap = await db.query(
        `SELECT id, status, requested_by, decided_by, expires_at FROM approval_requests WHERE assessment_id=$1 ORDER BY created_at DESC LIMIT 1`,
        [a.id],
      );
      res.json({ ...gate, approval: ap.rows[0] ?? null });
    }),
  );

  api.get(
    '/assessments/:id/hypotheses',
    wrap(async (req, res) => {
      const a = await loadAssessment(req);
      res.json({
        items: (a as Record<string, unknown>).hypotheses ?? [],
        note: 'Advisory risk hypotheses; they are not scored and cannot change the gate.',
      });
    }),
  );
  api.get(
    '/assessments/:id/review-brief',
    wrap(async (req, res) => {
      const a = await loadAssessment(req);
      res.json({ brief: (a as Record<string, unknown>).review_brief ?? null });
    }),
  );

  // ---- oversight: learning analytics (advisory) and reconciliation (detective control)
  api.get(
    '/learning/summary',
    requireTokenRole('admin', 'approver'),
    wrap(async (_req, res) => {
      res.json(await learningSummary(db));
    }),
  );
  api.post(
    '/environments/:id/reconcile',
    requireTokenRole('admin', 'approver', 'pipeline'),
    wrap(async (req, res) => {
      const id = idParam(req);
      const body = z
        .object({ sinceHours: z.coerce.number().int().min(1).max(336).default(24) })
        .parse(req.body ?? {});
      await requireEnvRole(db, me(req), id, ['approver', 'admin', 'pipeline']);
      res.json(await reconcileEnvironment(db, deps.arg, id, body.sinceHours, me(req).oid));
    }),
  );

  // ---- approvals
  api.post(
    '/assessments/:id/approval-requests',
    wrap(async (req, res) => {
      const a = await loadAssessment(req, ['assessor', 'approver', 'admin']);
      const body = ApprovalRequestSchema.parse(req.body);
      if (a.gate_decision !== 'require_approval')
        throw new AppError(
          409,
          'approval_not_applicable',
          `Gate decision is "${a.gate_decision}"; approval requests only apply to require_approval`,
        );
      const out = await withTx(db, async (tx) => {
        const r = await tx.query<{ id: string }>(
          `INSERT INTO approval_requests(assessment_id, assessment_version, environment_id, artifact_digest, requested_by, justification) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id`,
          [a.id, a.version, a.environment_id, a.artifact_digest, me(req).oid, body.justification],
        );
        if (!r.rows[0]) return null;
        await audit(tx, {
          actor: me(req).oid,
          action: 'approval.requested',
          assessmentId: a.id,
          environment: a.environment,
          details: { approvalId: r.rows[0].id, justification: body.justification },
        });
        return r.rows[0].id;
      });
      if (!out)
        throw new AppError(
          409,
          'approval_exists',
          'An open approval request already exists for this assessment',
        );
      res.status(201).json({ id: out, status: 'pending' });
    }),
  );

  api.get(
    '/approval-requests',
    wrap(async (req, res) => {
      const pg = PaginationSchema.parse(req.query);
      const status = typeof req.query.status === 'string' ? req.query.status : null;
      const r = await db.query(
        `SELECT DISTINCT ar.id, ar.assessment_id, ar.status, ar.requested_by, ar.justification, ar.created_at, ar.expires_at, e.name AS environment, a.risk_level FROM approval_requests ar JOIN assessments a ON a.id=ar.assessment_id JOIN environments e ON e.id=ar.environment_id JOIN environment_access ea ON ea.environment_id=e.id WHERE ea.principal_oid=$1 AND ($2::text IS NULL OR ar.status=$2) ORDER BY ar.created_at DESC LIMIT $3 OFFSET $4`,
        [me(req).oid, status, pg.limit, pg.offset],
      );
      res.json({ items: r.rows, limit: pg.limit, offset: pg.offset });
    }),
  );

  api.post(
    '/approval-requests/:id/decision',
    wrap(async (req, res) => {
      const id = idParam(req);
      const body = ApprovalDecisionSchema.parse(req.body);
      const p = me(req);
      const out = await withTx(db, async (tx) => {
        const r = await tx.query<{
          id: string;
          assessment_id: string;
          environment_id: string;
          requested_by: string;
          status: string;
          env_name: string;
          gate_decision: string;
        }>(
          `SELECT ar.id, ar.assessment_id, ar.environment_id, ar.requested_by, ar.status, e.name AS env_name, a.gate_decision FROM approval_requests ar JOIN environments e ON e.id=ar.environment_id JOIN assessments a ON a.id=ar.assessment_id WHERE ar.id=$1 FOR UPDATE OF ar`,
          [id],
        );
        const ar = r.rows[0];
        if (!ar) throw new AppError(404, 'not_found', 'Approval request not found');
        const eff = await effectiveRoles(db, p, ar.environment_id);
        if (!eff.includes('approver') && !eff.includes('admin'))
          throw new AppError(403, 'forbidden', 'Approver role required for this environment');
        if (ar.requested_by === p.oid)
          throw new AppError(403, 'separation_of_duties', 'You cannot decide an approval you requested');
        if (ar.status !== 'pending')
          throw new AppError(409, 'not_pending', `Approval request is ${ar.status}`);
        if (ar.gate_decision === 'block')
          throw new AppError(409, 'blocked', 'Blocked assessments cannot be approved');
        const approve = body.decision === 'approve';
        await tx.query(
          `UPDATE approval_requests SET status=$2, decided_by=$3, decided_at=now(), decision_comment=$4, expires_at=CASE WHEN $2='approved' THEN now() + ($5 || ' hours')::interval ELSE NULL END WHERE id=$1`,
          [id, approve ? 'approved' : 'rejected', p.oid, body.comment, String(cfg.APPROVAL_TTL_HOURS)],
        );
        await audit(tx, {
          actor: p.oid,
          action: approve ? 'approval.approved' : 'approval.rejected',
          assessmentId: ar.assessment_id,
          environment: ar.env_name,
          details: { approvalId: id, comment: body.comment },
        });
        return approve ? 'approved' : 'rejected';
      });
      res.json({ id, status: out });
    }),
  );

  api.post(
    '/approval-requests/:id/revoke',
    wrap(async (req, res) => {
      const id = idParam(req);
      const p = me(req);
      await withTx(db, async (tx) => {
        const r = await tx.query<{
          assessment_id: string;
          environment_id: string;
          status: string;
          env_name: string;
        }>(
          `SELECT ar.assessment_id, ar.environment_id, ar.status, e.name AS env_name FROM approval_requests ar JOIN environments e ON e.id=ar.environment_id WHERE ar.id=$1 FOR UPDATE OF ar`,
          [id],
        );
        const ar = r.rows[0];
        if (!ar) throw new AppError(404, 'not_found', 'Approval request not found');
        const eff = await effectiveRoles(db, p, ar.environment_id);
        if (!eff.includes('approver') && !eff.includes('admin'))
          throw new AppError(403, 'forbidden', 'Approver role required');
        if (!['pending', 'approved'].includes(ar.status))
          throw new AppError(409, 'not_revocable', `Approval request is ${ar.status}`);
        await tx.query(
          `UPDATE approval_requests SET status='revoked', revoked_by=$2, revoked_at=now() WHERE id=$1`,
          [id, p.oid],
        );
        await audit(tx, {
          actor: p.oid,
          action: 'approval.revoked',
          assessmentId: ar.assessment_id,
          environment: ar.env_name,
          details: { approvalId: id },
        });
      });
      res.json({ id, status: 'revoked' });
    }),
  );

  // ---- deployments (pipeline identity only)
  api.post(
    '/deployments/authorize',
    requireTokenRole('pipeline'),
    wrap(async (req, res) => {
      const body = AuthorizeDeploymentSchema.parse(req.body);
      const env = await db.query<{ id: string }>(
        `SELECT e.id FROM assessments a JOIN environments e ON e.id=a.environment_id WHERE a.id=$1`,
        [body.assessmentId],
      );
      if (env.rows[0]) await requireEnvRole(db, me(req), env.rows[0].id, ['pipeline']);
      else throw new AppError(404, 'not_found', 'Assessment not found');
      const r = await authorizeDeployment(db, cfg, { ...body, actor: me(req).oid });
      res.status(r.authorized ? 200 : 403).json(r);
    }),
  );

  async function loadDeployment(
    req: Request,
    roles: ('viewer' | 'assessor' | 'approver' | 'admin' | 'pipeline')[],
  ) {
    const id = idParam(req);
    const r = await db.query(
      `SELECT d.*, e.name AS environment FROM deployments d JOIN environments e ON e.id=d.environment_id WHERE d.id=$1`,
      [id],
    );
    const d = r.rows[0];
    if (!d) throw new AppError(404, 'not_found', 'Deployment not found');
    await requireEnvRole(db, me(req), d.environment_id, roles);
    return d as {
      id: string;
      environment_id: string;
      environment: string;
      assessment_id: string;
      status: string;
    };
  }

  api.post(
    '/deployments/:id/result',
    requireTokenRole('pipeline'),
    wrap(async (req, res) => {
      const d = await loadDeployment(req, ['pipeline']);
      const body = DeploymentResultSchema.parse(req.body);
      await withTx(db, async (tx) => {
        const u = await tx.query(
          `UPDATE deployments SET status=$2, completed_at=now(), azure_deployment_name=$3, correlation_id=$4, message=$5 WHERE id=$1 AND status='authorized'`,
          [
            d.id,
            body.status,
            body.azureDeploymentName ?? null,
            body.correlationId ?? null,
            body.message ?? null,
          ],
        );
        if (!u.rowCount)
          throw new AppError(409, 'not_in_flight', `Deployment is ${d.status}, not authorized`);
        await audit(tx, {
          actor: me(req).oid,
          action: `deployment.${body.status}`,
          assessmentId: d.assessment_id,
          environment: d.environment,
          details: {
            deploymentId: d.id,
            azureDeploymentName: body.azureDeploymentName,
            correlationId: body.correlationId,
            message: body.message,
          },
        });
      });
      res.json({ id: d.id, status: body.status });
    }),
  );

  api.post(
    '/deployments/:id/verification',
    wrap(async (req, res) => {
      const d = await loadDeployment(req, ['pipeline', 'assessor', 'approver']);
      const v = await verifyDeployment(db, deps.arg, d.id, me(req).oid);
      res.status(201).json(v);
    }),
  );

  api.get(
    '/deployments/:id',
    wrap(async (req, res) => {
      const d = await loadDeployment(req, ['viewer', 'assessor', 'approver', 'pipeline']);
      const full = await db.query(`SELECT * FROM deployments WHERE id=$1`, [d.id]);
      const v = await db.query(
        `SELECT id, status, checks, discrepancies, limitations, created_by, created_at FROM verifications WHERE deployment_id=$1 ORDER BY created_at DESC`,
        [d.id],
      );
      res.json({ ...full.rows[0], verifications: v.rows });
    }),
  );

  api.get(
    '/assessments/:id/deployments',
    wrap(async (req, res) => {
      const a = await loadAssessment(req);
      const r = await db.query(
        `SELECT d.id, d.status, d.authorized_at, d.completed_at, d.pipeline_run_id, (SELECT status FROM verifications v WHERE v.deployment_id=d.id ORDER BY created_at DESC LIMIT 1) AS verification_status FROM deployments d WHERE d.assessment_id=$1 ORDER BY d.authorized_at DESC`,
        [a.id],
      );
      res.json({ items: r.rows });
    }),
  );

  // ---- admin
  api.get(
    '/audit',
    requireTokenRole('admin'),
    wrap(async (req, res) => {
      const pg = PaginationSchema.parse(req.query);
      const t = await db.query<{ n: string }>('SELECT count(*) AS n FROM audit_events');
      const r = await db.query(
        `SELECT id, at, actor, action, assessment_id, environment, details, hash FROM audit_events ORDER BY id DESC LIMIT $1 OFFSET $2`,
        [pg.limit, pg.offset],
      );
      res.json({ items: r.rows, total: Number(t.rows[0]!.n), limit: pg.limit, offset: pg.offset });
    }),
  );
  api.get(
    '/audit/verify',
    requireTokenRole('admin'),
    wrap(async (_req, res) => {
      res.json(await verifyAuditChain(db));
    }),
  );
  api.put(
    '/admin/access',
    requireTokenRole('admin'),
    wrap(async (req, res) => {
      const g = AccessGrantSchema.parse(req.body);
      const e = await db.query<{ id: string }>(`SELECT id FROM environments WHERE name=$1`, [g.environment]);
      if (!e.rows[0]) throw new AppError(404, 'not_found', 'Unknown environment');
      await requireEnvRole(db, me(req), e.rows[0].id, ['admin']);
      await withTx(db, async (tx) => {
        await tx.query(
          `INSERT INTO environment_access(environment_id, principal_oid, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [e.rows[0]!.id, g.principalId, g.role],
        );
        await audit(tx, {
          actor: me(req).oid,
          action: 'access.granted',
          environment: g.environment,
          details: { principalId: g.principalId, role: g.role },
        });
      });
      res.status(204).end();
    }),
  );

  registerInsights(api, { db, cfg, arg: deps.arg, llm: deps.llm });

  app.use('/api', api);
  app.use((_req, _res, next) => next(new AppError(404, 'not_found', 'Route not found')));
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({
        error: {
          code: 'validation_failed',
          message: 'Request validation failed',
          requestId: String(req.id),
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
      return;
    }
    if (err instanceof AppError) {
      res
        .status(err.status)
        .json({ error: { code: err.code, message: err.message, requestId: String(req.id) } });
      return;
    }
    const e = err as { type?: string; status?: number };
    if (e.type === 'entity.too.large') {
      res.status(413).json({
        error: { code: 'payload_too_large', message: 'Request body too large', requestId: String(req.id) },
      });
      return;
    }
    if (e.type === 'entity.parse.failed') {
      res
        .status(400)
        .json({ error: { code: 'invalid_json', message: 'Malformed JSON', requestId: String(req.id) } });
      return;
    }
    req.log.error({ err: err instanceof Error ? err.message : String(err) }, 'unhandled error');
    res.status(500).json({
      error: { code: 'internal_error', message: 'Internal server error', requestId: String(req.id) },
    });
  });
  return app;
}
