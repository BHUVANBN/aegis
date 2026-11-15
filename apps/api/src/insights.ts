import type { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { ROLES } from '@aegis/shared';
import type { Config } from './config.js';
import { withTx, type Db } from './db/db.js';
import { audit, verifyAuditChain } from './audit.js';
import { requireEnvRole, requireTokenRole } from './auth.js';
import { AppError } from './util.js';

/**
 * Read-only business metrics, platform status, and the admin endpoints behind the "Setup" screens.
 * Registered from app.ts with registerInsights(api, deps). Uses only GET and POST so the existing CORS policy applies.
 */
export interface InsightsDeps {
  db: Db;
  cfg: Config;
  arg: unknown;
  llm: { name: string };
}

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };
const who = (req: Request) => req.principal!;
const uuid = z.string().uuid();
const envIdParam = (req: Request): string => {
  const r = uuid.safeParse(req.params.id);
  if (!r.success) throw new AppError(400, 'invalid_id', 'Path id must be a UUID');
  return r.data;
};
const isUniqueViolation = (e: unknown): boolean => (e as { code?: string } | null)?.code === '23505';

// Every metrics query is limited to environments the caller has access to, to the chosen window, and (unless asked) excludes UI sample data.
const SCOPE = `a.environment_id IN (SELECT ea.environment_id FROM environment_access ea WHERE ea.principal_oid = $1)
  AND a.created_at >= now() - ($2::int * interval '1 day')
  AND ($3::boolean OR a.pipeline_run_id NOT LIKE 'ui-sample-%')`;
const LEVELS = ['low', 'medium', 'high', 'critical'] as const;

export function registerInsights(api: Router, deps: InsightsDeps): void {
  const { db } = deps;

  api.get(
    '/metrics/summary',
    wrap(async (req, res) => {
      const q = z
        .object({
          days: z.coerce.number().int().min(1).max(365).default(30),
          includeSamples: z.enum(['true', 'false']).default('false'),
        })
        .parse(req.query);
      const include = q.includeSamples === 'true';
      const p = [who(req).oid, q.days, include];

      const totals = await db.query<{
        assessments: number;
        completed: number;
        failed: number;
        allow: number;
        require_approval: number;
        block: number;
      }>(
        `SELECT count(*)::int AS assessments,
                count(*) FILTER (WHERE a.status IN ('complete','partial'))::int AS completed,
                count(*) FILTER (WHERE a.status = 'failed')::int AS failed,
                count(*) FILTER (WHERE a.gate_decision = 'allow')::int AS allow,
                count(*) FILTER (WHERE a.gate_decision = 'require_approval')::int AS require_approval,
                count(*) FILTER (WHERE a.gate_decision = 'block')::int AS block
           FROM assessments a WHERE ${SCOPE}`,
        p,
      );
      const matrix = await db.query<{ level: string; decision: string; count: number }>(
        `SELECT a.risk_level AS level, a.gate_decision AS decision, count(*)::int AS count
           FROM assessments a WHERE ${SCOPE} AND a.risk_level IS NOT NULL AND a.gate_decision IS NOT NULL
          GROUP BY 1, 2`,
        p,
      );
      const daily = await db.query<{ day: string; allow: number; require_approval: number; block: number }>(
        `SELECT to_char((a.created_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day,
                count(*) FILTER (WHERE a.gate_decision = 'allow')::int AS allow,
                count(*) FILTER (WHERE a.gate_decision = 'require_approval')::int AS require_approval,
                count(*) FILTER (WHERE a.gate_decision = 'block')::int AS block
           FROM assessments a WHERE ${SCOPE} GROUP BY 1 ORDER BY 1`,
        p,
      );
      const aDur = await db.query<{ med: number | null; p90: number | null }>(
        `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (a.completed_at - a.created_at))::float8) AS med,
                percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM (a.completed_at - a.created_at))::float8) AS p90
           FROM assessments a WHERE ${SCOPE} AND a.completed_at IS NOT NULL`,
        p,
      );
      const AR = `ar.environment_id IN (SELECT ea.environment_id FROM environment_access ea WHERE ea.principal_oid = $1)
        AND ar.created_at >= now() - ($2::int * interval '1 day')
        AND ($3::boolean OR a.pipeline_run_id NOT LIKE 'ui-sample-%')`;
      const appr = await db.query<{
        total: number;
        pending: number;
        approved: number;
        rejected: number;
        expired: number;
        revoked: number;
        consumed: number;
        oldest_pending: number | null;
      }>(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE ar.status = 'pending')::int AS pending,
                count(*) FILTER (WHERE ar.status = 'approved')::int AS approved,
                count(*) FILTER (WHERE ar.status = 'rejected')::int AS rejected,
                count(*) FILTER (WHERE ar.status = 'expired')::int AS expired,
                count(*) FILTER (WHERE ar.status = 'revoked')::int AS revoked,
                count(*) FILTER (WHERE ar.status = 'consumed')::int AS consumed,
                extract(epoch FROM (now() - min(ar.created_at) FILTER (WHERE ar.status = 'pending')))::float8 AS oldest_pending
           FROM approval_requests ar JOIN assessments a ON a.id = ar.assessment_id WHERE ${AR}`,
        p,
      );
      const apprDur = await db.query<{ med: number | null; p90: number | null }>(
        `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (ar.decided_at - ar.created_at))::float8) AS med,
                percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM (ar.decided_at - ar.created_at))::float8) AS p90
           FROM approval_requests ar JOIN assessments a ON a.id = ar.assessment_id
          WHERE ${AR} AND ar.decided_at IS NOT NULL`,
        p,
      );
      const DP = `d.environment_id IN (SELECT ea.environment_id FROM environment_access ea WHERE ea.principal_oid = $1)
        AND d.authorized_at >= now() - ($2::int * interval '1 day')
        AND ($3::boolean OR a.pipeline_run_id NOT LIKE 'ui-sample-%')`;
      const dep = await db.query<{
        total: number;
        succeeded: number;
        failed: number;
        authorized: number;
        expired: number;
        lead_med: number | null;
      }>(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE d.status = 'succeeded')::int AS succeeded,
                count(*) FILTER (WHERE d.status = 'failed')::int AS failed,
                count(*) FILTER (WHERE d.status = 'authorized')::int AS authorized,
                count(*) FILTER (WHERE d.status = 'expired')::int AS expired,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (d.completed_at - a.created_at))::float8)
                  FILTER (WHERE d.status = 'succeeded' AND d.completed_at IS NOT NULL) AS lead_med
           FROM deployments d JOIN assessments a ON a.id = d.assessment_id WHERE ${DP}`,
        p,
      );
      const ver = await db.query<{
        total: number;
        passed: number;
        failed: number;
        inconclusive: number;
        partial: number;
      }>(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE v.status = 'passed')::int AS passed,
                count(*) FILTER (WHERE v.status = 'failed')::int AS failed,
                count(*) FILTER (WHERE v.status = 'inconclusive')::int AS inconclusive,
                count(*) FILTER (WHERE v.status = 'partially_verified')::int AS partial
           FROM verifications v JOIN deployments d ON d.id = v.deployment_id JOIN assessments a ON a.id = d.assessment_id
          WHERE ${DP.replace('d.authorized_at', 'v.created_at')}`,
        p,
      );
      const rules = await db.query<{
        rule_id: string;
        title: string;
        severity: string;
        count: number;
        prohibited: boolean;
      }>(
        `SELECT pf.rule_id, split_part(max(pf.title), ' (', 1) AS title,
                mode() WITHIN GROUP (ORDER BY pf.severity) AS severity,
                count(*)::int AS count, bool_or(pf.prohibited) AS prohibited
           FROM policy_findings pf JOIN assessments a ON a.id = pf.assessment_id
          WHERE ${SCOPE} GROUP BY pf.rule_id ORDER BY count(*) DESC, pf.rule_id LIMIT 8`,
        p,
      );
      const byEnv = await db.query<{
        project: string;
        environment: string;
        kind: string;
        assessments: number;
        blocked: number;
        needs_approval: number;
      }>(
        `SELECT pr.key AS project, e.name AS environment, e.kind, count(*)::int AS assessments,
                count(*) FILTER (WHERE a.gate_decision = 'block')::int AS blocked,
                count(*) FILTER (WHERE a.gate_decision = 'require_approval')::int AS needs_approval
           FROM assessments a JOIN environments e ON e.id = a.environment_id JOIN projects pr ON pr.id = e.project_id
          WHERE ${SCOPE} GROUP BY pr.key, e.name, e.kind ORDER BY count(*) DESC, pr.key, e.name`,
        p,
      );
      const depByEnv = await db.query<{ project: string; environment: string; deployments: number; succeeded: number }>(
        `SELECT pr.key AS project, e.name AS environment, count(*)::int AS deployments,
                count(*) FILTER (WHERE d.status = 'succeeded')::int AS succeeded
           FROM deployments d JOIN assessments a ON a.id = d.assessment_id
           JOIN environments e ON e.id = d.environment_id JOIN projects pr ON pr.id = e.project_id
          WHERE ${DP} GROUP BY pr.key, e.name`,
        p,
      );
      const rec = await db.query<{ runs: number; findings: number; last_run: string | null }>(
        `SELECT count(*)::int AS runs,
                COALESCE(sum(CASE WHEN ae.details->>'findings' ~ '^[0-9]+$' THEN (ae.details->>'findings')::int ELSE 0 END), 0)::int AS findings,
                max(ae.at) AS last_run
           FROM audit_events ae
          WHERE ae.action = 'reconciliation.run'
            AND ae.at >= now() - ($2::int * interval '1 day')
            AND ae.environment IN (SELECT e.name FROM environments e JOIN environment_access ea ON ea.environment_id = e.id WHERE ea.principal_oid = $1)`,
        [p[0], p[1]],
      );
      const samples = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM assessments a
          WHERE a.environment_id IN (SELECT ea.environment_id FROM environment_access ea WHERE ea.principal_oid = $1)
            AND a.created_at >= now() - ($2::int * interval '1 day') AND a.pipeline_run_id LIKE 'ui-sample-%'`,
        [p[0], p[1]],
      );

      // fill days without activity so the chart shows a continuous time axis
      const dayMap = new Map(daily.rows.map((r) => [r.day, r]));
      const series: { day: string; allow: number; requireApproval: number; block: number }[] = [];
      for (let i = q.days - 1; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
        const r = dayMap.get(d);
        series.push({ day: d, allow: r?.allow ?? 0, requireApproval: r?.require_approval ?? 0, block: r?.block ?? 0 });
      }
      const depMap = new Map(depByEnv.rows.map((r) => [`${r.project}/${r.environment}`, r]));
      const t = totals.rows[0]!;
      const a = appr.rows[0]!;
      const d = dep.rows[0]!;
      const v = ver.rows[0]!;
      const rc = rec.rows[0]!;
      res.json({
        generatedAt: new Date().toISOString(),
        days: q.days,
        includeSamples: include,
        sampleCount: samples.rows[0]!.n,
        totals: {
          assessments: t.assessments,
          completed: t.completed,
          failed: t.failed,
          allow: t.allow,
          requireApproval: t.require_approval,
          block: t.block,
        },
        byRisk: LEVELS.map((level) => ({
          level,
          count: matrix.rows.filter((r) => r.level === level).reduce((s, r) => s + r.count, 0),
        })),
        byLevelDecision: matrix.rows,
        daily: series,
        durations: {
          assessmentMedianSec: aDur.rows[0]?.med ?? null,
          assessmentP90Sec: aDur.rows[0]?.p90 ?? null,
          approvalMedianSec: apprDur.rows[0]?.med ?? null,
          approvalP90Sec: apprDur.rows[0]?.p90 ?? null,
          leadTimeMedianSec: d.lead_med,
        },
        approvals: {
          total: a.total,
          pending: a.pending,
          approved: a.approved,
          rejected: a.rejected,
          expired: a.expired,
          revoked: a.revoked,
          consumed: a.consumed,
          oldestPendingSec: a.oldest_pending,
        },
        deployments: {
          total: d.total,
          succeeded: d.succeeded,
          failed: d.failed,
          authorized: d.authorized,
          expired: d.expired,
        },
        verifications: {
          total: v.total,
          passed: v.passed,
          failed: v.failed,
          inconclusive: v.inconclusive,
          partial: v.partial,
        },
        topRules: rules.rows.map((r) => ({
          ruleId: r.rule_id,
          title: r.title,
          severity: r.severity,
          count: r.count,
          prohibited: r.prohibited,
        })),
        byEnvironment: byEnv.rows.map((r) => ({
          project: r.project,
          environment: r.environment,
          kind: r.kind,
          assessments: r.assessments,
          blocked: r.blocked,
          needsApproval: r.needs_approval,
          deployments: depMap.get(`${r.project}/${r.environment}`)?.deployments ?? 0,
          deploymentsSucceeded: depMap.get(`${r.project}/${r.environment}`)?.succeeded ?? 0,
        })),
        reconciliation: { runs: rc.runs, findings: rc.findings, lastRunAt: rc.last_run },
      });
    }),
  );

  api.get(
    '/system/status',
    requireTokenRole('admin', 'approver'),
    wrap(async (req, res) => {
      const t0 = Date.now();
      await db.query('SELECT 1');
      const latencyMs = Date.now() - t0;
      const isAdmin = who(req).roles.includes('admin');
      const chain = await verifyAuditChain(db);
      const stuck = await db.query<{ id: string; environment: string; status: string; age: number }>(
        `SELECT a.id, e.name AS environment, a.status, extract(epoch FROM (now() - a.created_at))::float8 AS age
           FROM assessments a JOIN environments e ON e.id = a.environment_id
          WHERE a.status IN ('pending','running') AND a.created_at < now() - interval '10 minutes'
          ORDER BY a.created_at LIMIT 20`,
      );
      const failed = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM assessments WHERE status = 'failed' AND created_at >= now() - interval '24 hours'`,
      );
      const agents = await db.query<{ agent: string; runs: number; failures: number; median_ms: number | null }>(
        `SELECT agent, count(*)::int AS runs,
                count(*) FILTER (WHERE status NOT IN ('succeeded','skipped'))::int AS failures,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY (extract(epoch FROM (finished_at - started_at)) * 1000)::float8) AS median_ms
           FROM agent_runs WHERE started_at >= now() - interval '7 days' GROUP BY agent ORDER BY agent`,
      );
      const pend = await db.query<{ n: number; oldest: number | null }>(
        `SELECT count(*)::int AS n, extract(epoch FROM (now() - min(created_at)))::float8 AS oldest
           FROM approval_requests WHERE status = 'pending'`,
      );
      const expiredLocks = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM deployments WHERE status = 'authorized' AND lock_expires_at < now()`,
      );
      const rv = await db.query<{ rules_version: string }>(
        `SELECT rules_version FROM assessments WHERE rules_version IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
      );
      const lastRec = await db.query<{ at: string; environment: string | null; status: string | null; findings: string | null }>(
        `SELECT at, environment, details->>'status' AS status, details->>'findings' AS findings
           FROM audit_events WHERE action = 'reconciliation.run' ORDER BY id DESC LIMIT 1`,
      );
      const recent = isAdmin
        ? await db.query<{ id: string; at: string; actor: string; action: string; environment: string | null }>(
            `SELECT id, at, actor, action, environment FROM audit_events ORDER BY id DESC LIMIT 15`,
          )
        : null;
      const lr = lastRec.rows[0];
      res.json({
        time: new Date().toISOString(),
        db: { ok: true, latencyMs },
        authMode: deps.cfg.AUTH_MODE,
        llm: deps.llm.name,
        resourceGraph: deps.arg !== null && deps.arg !== undefined,
        rulesVersion: rv.rows[0]?.rules_version ?? null,
        uptimeSec: Math.round(process.uptime()),
        audit: chain,
        stuckAssessments: stuck.rows.map((r) => ({
          id: r.id,
          environment: r.environment,
          status: r.status,
          ageSec: r.age,
        })),
        failedAssessments24h: failed.rows[0]!.n,
        agentStats: agents.rows.map((r) => ({
          agent: r.agent,
          runs: r.runs,
          failures: r.failures,
          medianMs: r.median_ms,
        })),
        pendingApprovals: { count: pend.rows[0]!.n, oldestSec: pend.rows[0]!.oldest },
        expiredDeployments: expiredLocks.rows[0]!.n,
        recentActivity: recent
          ? recent.rows.map((r) => ({
              id: Number(r.id),
              at: r.at,
              actor: r.actor,
              action: r.action,
              environment: r.environment,
            }))
          : null,
        lastReconcile: lr
          ? { at: lr.at, environment: lr.environment, status: lr.status, findings: Number(lr.findings ?? 0) }
          : null,
      });
    }),
  );

  // ---------------- admin: onboarding without a command line ----------------
  api.get(
    '/admin/projects',
    requireTokenRole('admin'),
    wrap(async (_req, res) => {
      const r = await db.query<{
        id: string;
        key: string;
        name: string;
        repo_url: string | null;
        created_at: string;
        env_id: string | null;
        env_name: string | null;
        kind: string | null;
        subscription_id: string | null;
        resource_group: string | null;
        grants: number | null;
      }>(
        `SELECT p.id, p.key, p.name, p.repo_url, p.created_at,
                e.id AS env_id, e.name AS env_name, e.kind, e.subscription_id, e.resource_group,
                (SELECT count(*)::int FROM environment_access ea WHERE ea.environment_id = e.id) AS grants
           FROM projects p LEFT JOIN environments e ON e.project_id = p.id ORDER BY p.key, e.name`,
      );
      const out = new Map<
        string,
        {
          id: string;
          key: string;
          name: string;
          repo_url: string | null;
          created_at: string;
          environments: {
            id: string;
            name: string;
            kind: string;
            subscription_id: string | null;
            resource_group: string | null;
            grants: number;
          }[];
        }
      >();
      for (const row of r.rows) {
        let p = out.get(row.id);
        if (!p) {
          p = { id: row.id, key: row.key, name: row.name, repo_url: row.repo_url, created_at: row.created_at, environments: [] };
          out.set(row.id, p);
        }
        if (row.env_id)
          p.environments.push({
            id: row.env_id,
            name: row.env_name!,
            kind: row.kind!,
            subscription_id: row.subscription_id,
            resource_group: row.resource_group,
            grants: row.grants ?? 0,
          });
      }
      res.json({ items: [...out.values()] });
    }),
  );

  api.post(
    '/admin/projects',
    requireTokenRole('admin'),
    wrap(async (req, res) => {
      const b = z
        .object({
          key: z.string().min(1).max(60).regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes'),
          name: z.string().trim().min(1).max(200),
          repoUrl: z.string().trim().max(300).optional(),
        })
        .parse(req.body);
      try {
        const id = await withTx(db, async (tx) => {
          const r = await tx.query<{ id: string }>(
            `INSERT INTO projects(key, name, repo_url) VALUES ($1,$2,$3) RETURNING id`,
            [b.key, b.name, b.repoUrl ? b.repoUrl : null],
          );
          await audit(tx, { actor: who(req).oid, action: 'project.created', details: { key: b.key, name: b.name } });
          return r.rows[0]!.id;
        });
        res.status(201).json({ id });
      } catch (e) {
        if (isUniqueViolation(e)) throw new AppError(409, 'already_exists', 'A project with this key already exists');
        throw e;
      }
    }),
  );

  api.post(
    '/admin/environments',
    requireTokenRole('admin'),
    wrap(async (req, res) => {
      const b = z
        .object({
          projectKey: z.string().min(1).max(60),
          name: z.string().min(1).max(60).regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes'),
          kind: z.enum(['dev', 'staging', 'prod']),
          subscriptionId: z
            .string()
            .trim()
            .regex(/^$|^[0-9a-fA-F-]{36}$/, 'a subscription GUID')
            .optional(),
          resourceGroup: z.string().trim().max(90).optional(),
        })
        .parse(req.body);
      const proj = await db.query<{ id: string }>('SELECT id FROM projects WHERE key = $1', [b.projectKey]);
      if (!proj.rows[0]) throw new AppError(404, 'not_found', 'Unknown project');
      try {
        const id = await withTx(db, async (tx) => {
          const r = await tx.query<{ id: string }>(
            `INSERT INTO environments(project_id, name, kind, subscription_id, resource_group) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
            [proj.rows[0]!.id, b.name, b.kind, b.subscriptionId ? b.subscriptionId : null, b.resourceGroup ? b.resourceGroup : null],
          );
          // the creator can see and administer what they just created (the same grants the bootstrap script gives)
          for (const role of ['admin', 'viewer']) {
            await tx.query(
              `INSERT INTO environment_access(environment_id, principal_oid, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
              [r.rows[0]!.id, who(req).oid, role],
            );
          }
          await audit(tx, {
            actor: who(req).oid,
            action: 'environment.created',
            environment: b.name,
            details: { project: b.projectKey, kind: b.kind, resourceGroup: b.resourceGroup ?? null },
          });
          return r.rows[0]!.id;
        });
        res.status(201).json({ id });
      } catch (e) {
        if (isUniqueViolation(e))
          throw new AppError(409, 'already_exists', 'This project already has an environment with that name');
        throw e;
      }
    }),
  );

  api.get(
    '/admin/principals',
    requireTokenRole('admin'),
    wrap(async (_req, res) => {
      const r = await db.query(
        `SELECT oid, display_name, email, last_seen_at FROM principals ORDER BY last_seen_at DESC LIMIT 200`,
      );
      res.json({ items: r.rows });
    }),
  );

  api.get(
    '/admin/environments/:id/access',
    requireTokenRole('admin'),
    wrap(async (req, res) => {
      const id = envIdParam(req);
      await requireEnvRole(db, who(req), id, ['admin']);
      const r = await db.query(
        `SELECT ea.principal_oid, p.display_name, p.email, ea.role, ea.created_at
           FROM environment_access ea LEFT JOIN principals p ON p.oid = ea.principal_oid
          WHERE ea.environment_id = $1 ORDER BY p.display_name NULLS LAST, ea.principal_oid, ea.role`,
        [id],
      );
      res.json({ items: r.rows });
    }),
  );

  const GrantBody = z.object({ principalId: z.string().trim().min(1).max(200), role: z.enum(ROLES) });
  api.post(
    '/admin/environments/:id/access',
    requireTokenRole('admin'),
    wrap(async (req, res) => {
      const id = envIdParam(req);
      const b = GrantBody.parse(req.body);
      await requireEnvRole(db, who(req), id, ['admin']);
      const env = await db.query<{ name: string }>('SELECT name FROM environments WHERE id = $1', [id]);
      await withTx(db, async (tx) => {
        await tx.query(
          `INSERT INTO environment_access(environment_id, principal_oid, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [id, b.principalId, b.role],
        );
        await audit(tx, {
          actor: who(req).oid,
          action: 'access.granted',
          environment: env.rows[0]?.name ?? null,
          details: { principalId: b.principalId, role: b.role },
        });
      });
      res.status(204).end();
    }),
  );

  api.post(
    '/admin/environments/:id/access/revoke',
    requireTokenRole('admin'),
    wrap(async (req, res) => {
      const id = envIdParam(req);
      const b = GrantBody.parse(req.body);
      await requireEnvRole(db, who(req), id, ['admin']);
      if (b.role === 'admin') {
        const others = await db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM environment_access WHERE environment_id = $1 AND role = 'admin' AND principal_oid <> $2`,
          [id, b.principalId],
        );
        if (others.rows[0]!.n === 0)
          throw new AppError(409, 'last_admin', 'This is the only admin of the environment; add another admin first');
      }
      const env = await db.query<{ name: string }>('SELECT name FROM environments WHERE id = $1', [id]);
      await withTx(db, async (tx) => {
        await tx.query(`DELETE FROM environment_access WHERE environment_id = $1 AND principal_oid = $2 AND role = $3`, [
          id,
          b.principalId,
          b.role,
        ]);
        await audit(tx, {
          actor: who(req).oid,
          action: 'access.revoked',
          environment: env.rows[0]?.name ?? null,
          details: { principalId: b.principalId, role: b.role },
        });
      });
      res.status(204).end();
    }),
  );
}
