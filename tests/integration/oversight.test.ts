import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type pg from 'pg';
import { ALICE, BOB, CAROL, PIPE, digestOf, fixture, makeApp, MockArg, tok } from '../helpers';
import type { AegisApp } from '../../apps/api/src/app';
import { bootstrap } from '../../apps/api/src/db/bootstrap';
import { learningSummary } from '../../apps/api/src/agents/learning';

let ctx: { app: AegisApp; db: pg.Pool } | null = null;
afterEach(async () => {
  if (ctx) {
    await ctx.app.drain();
    await ctx.db.end();
    ctx = null;
  }
});
let n = 100;
const SUB = '00000000-0000-0000-0000-000000000000';

async function envId(c: NonNullable<typeof ctx>, name: string) {
  return (await c.db.query('SELECT id FROM environments WHERE name=$1', [name])).rows[0].id as string;
}
async function submit(c: NonNullable<typeof ctx>, file: string, environment: string) {
  n++;
  const body = {
    projectKey: 'demo',
    environment,
    commitSha: 'abcdef1',
    pipelineRunId: `o-${n}`,
    artifactDigest: digestOf(`o-${n}`),
    templatePath: 'm.bicep',
    whatIf: fixture(file),
  };
  const res = await request(c.app).post('/api/assessments').set('Authorization', ALICE).send(body);
  await c.app.drain();
  return { id: res.body.id as string, digest: body.artifactDigest };
}

describe('hypotheses and review brief endpoints', () => {
  it('return advisory data produced by the Reasoning and Reviewer agents', async () => {
    ctx = await makeApp(new MockArg());
    const { id } = await submit(ctx, 'whatif-nsg-https-removed.json', 'prod');
    const h = await request(ctx.app).get(`/api/assessments/${id}/hypotheses`).set('Authorization', ALICE);
    expect(h.status).toBe(200);
    expect(h.body.items[0].resourceClass).toBe('network-security');
    expect(h.body.note).toMatch(/not scored/);
    const b = await request(ctx.app).get(`/api/assessments/${id}/review-brief`).set('Authorization', ALICE);
    expect(b.body.brief).toMatchObject({
      recommendedAction: 'block',
      requiredApproverRole: 'not-approvable',
    });
  });
});

describe('reconciliation (detective control for pipeline bypass)', () => {
  const change = (id: string, ts: Date, by = 'someone@example.test') => ({
    target: id,
    type: 'microsoft.network/networksecuritygroups',
    changeType: 'Update',
    ts: ts.toISOString(),
    changedBy: by,
    changedByType: 'User',
    clientType: 'Azure Portal',
    operation: 'Microsoft.Network/networkSecurityGroups/write',
  });
  const nsgId = `/subscriptions/${SUB}/resourceGroups/rg-demo-prod/providers/Microsoft.Network/networkSecurityGroups/nsg-web`;

  it('flags changes outside authorized deployment windows and ignores changes inside them', async () => {
    const inside = new Date(Date.now() - 5 * 60_000);
    const outside = new Date(Date.now() - 6 * 3600_000);
    ctx = await makeApp(
      new MockArg((k) =>
        k.startsWith('resourcechanges') ? [change(nsgId, inside, 'pipeline'), change(nsgId, outside)] : [],
      ),
    );
    // an authorized deployment started 10 minutes ago and completed 2 minutes ago
    const { id } = await submit(ctx, 'whatif-tag-only.json', 'dev');
    const eDev = await envId(ctx, 'dev');
    const prod = await envId(ctx, 'prod');
    const a = (await ctx.db.query('SELECT project_id, artifact_digest FROM assessments WHERE id=$1', [id]))
      .rows[0];
    await ctx.db.query(
      `INSERT INTO deployments(assessment_id, environment_id, artifact_digest, pipeline_run_id, status, authorized_by, authorized_at, completed_at, lock_expires_at, gate_snapshot) VALUES ($1,$2,$3,'r','succeeded','pipeline@example.test', now() - interval '10 minutes', now() - interval '2 minutes', now() + interval '50 minutes','{}')`,
      [id, prod, a.artifact_digest],
    );
    void eDev;
    const r = await request(ctx.app)
      .post(`/api/environments/${prod}/reconcile`)
      .set('Authorization', BOB)
      .send({ sinceHours: 24 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'ok', windowsChecked: 1, changesSeen: 2 });
    expect(r.body.findings).toHaveLength(1);
    expect(r.body.findings[0]).toMatchObject({
      changedBy: 'someone@example.test',
      clientType: 'Azure Portal',
    });
    expect(r.body.limitations.join(' ')).toMatch(/does not block/);
    expect(
      (await ctx.db.query(`SELECT count(*)::int n FROM audit_events WHERE action='reconciliation.run'`))
        .rows[0].n,
    ).toBe(1);
  });
  it('requires approver/admin, validates input, and reports unavailable honestly', async () => {
    ctx = await makeApp(null);
    const prod = await envId(ctx, 'prod');
    expect(
      (
        await request(ctx.app)
          .post(`/api/environments/${prod}/reconcile`)
          .set('Authorization', ALICE)
          .send({})
      ).status,
    ).toBe(403);
    expect(
      (
        await request(ctx.app)
          .post(`/api/environments/${prod}/reconcile`)
          .set('Authorization', BOB)
          .send({ sinceHours: 99999 })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(ctx.app)
          .post('/api/environments/not-a-uuid/reconcile')
          .set('Authorization', BOB)
          .send({})
      ).status,
    ).toBe(400);
    const r = await request(ctx.app)
      .post(`/api/environments/${prod}/reconcile`)
      .set('Authorization', CAROL)
      .send({});
    expect(r.body).toMatchObject({ status: 'unavailable' });
    expect(r.body.findings).toEqual([]);
  });
  it('lets the pipeline identity (and only identities with an environment grant) run reconciliation', async () => {
    ctx = await makeApp(new MockArg(() => []));
    const prod = await envId(ctx, 'prod');
    expect(
      (await request(ctx.app).post(`/api/environments/${prod}/reconcile`).set('Authorization', PIPE).send({}))
        .status,
    ).toBe(200);
    expect(
      (
        await request(ctx.app)
          .post(`/api/environments/${prod}/reconcile`)
          .set('Authorization', tok('stranger@example.test', 'pipeline'))
          .send({})
      ).status,
    ).toBe(403);
  });
  it('treats Resource Graph failures as unavailable, not clean', async () => {
    ctx = await makeApp(new MockArg(() => new Error('Resource Graph HTTP 403')));
    const prod = await envId(ctx, 'prod');
    const r = await request(ctx.app)
      .post(`/api/environments/${prod}/reconcile`)
      .set('Authorization', BOB)
      .send({});
    expect(r.body.status).toBe('unavailable');
    expect(r.body.reason).toMatch(/403/);
  });
});

describe('learning agent (advisory analytics)', () => {
  async function seedOutcomes(c: NonNullable<typeof ctx>, count: number, failed: number) {
    const prod = await envId(c, 'prod');
    const proj = (await c.db.query('SELECT id FROM projects LIMIT 1')).rows[0].id;
    for (let i = 0; i < count; i++) {
      const a = (
        await c.db.query(
          `INSERT INTO assessments(project_id,environment_id,commit_sha,pipeline_run_id,artifact_digest,template_path,requested_by,status) VALUES ($1,$2,'abcdef1',$3,$4,'m','x','complete') RETURNING id`,
          [proj, prod, `l-${i}`, digestOf(`l-${i}`)],
        )
      ).rows[0].id;
      await c.db.query(
        `INSERT INTO policy_findings(assessment_id,finding_key,rule_id,title,severity,category,likelihood,source) VALUES ($1,'k','LR-DB-001','t','high','database-change',0.8,'local-rule')`,
        [a],
      );
      const d = (
        await c.db.query(
          `INSERT INTO deployments(assessment_id,environment_id,artifact_digest,pipeline_run_id,status,authorized_by,lock_expires_at,gate_snapshot) VALUES ($1,$2,$3,'r','succeeded','p', now(),'{}') RETURNING id`,
          [a, prod, digestOf(`l-${i}`)],
        )
      ).rows[0].id;
      await c.db.query(`INSERT INTO verifications(deployment_id,status,created_by) VALUES ($1,$2,'p')`, [
        d,
        i < failed ? 'failed' : 'passed',
      ]);
    }
  }
  it('suggests review only with enough samples, and never changes rules', async () => {
    ctx = await makeApp(null);
    await seedOutcomes(ctx, 4, 3);
    expect((await learningSummary(ctx.db)).rules[0]!.suggestion).toBeNull(); // below the minimum sample
    const fresh = await makeApp(null);
    await ctx.db.end();
    ctx = fresh;
    await seedOutcomes(ctx, 6, 3);
    const s = await learningSummary(ctx.db);
    expect(s.rules[0]).toMatchObject({ ruleId: 'LR-DB-001', deployed: 6, verifiedFailed: 3 });
    expect(s.rules[0]!.suggestion).toMatch(/review whether its severity/);
    expect(s.note).toMatch(/never changes rules/);
  });
  it('is available only to approver/admin tokens', async () => {
    ctx = await makeApp(null);
    expect((await request(ctx.app).get('/api/learning/summary').set('Authorization', ALICE)).status).toBe(
      403,
    );
    expect((await request(ctx.app).get('/api/learning/summary').set('Authorization', BOB)).status).toBe(200);
    expect((await request(ctx.app).get('/api/learning/summary').set('Authorization', PIPE)).status).toBe(403);
    expect(
      (await request(ctx.app).get('/api/learning/summary').set('Authorization', tok('x@y', ''))).status,
    ).toBe(403);
  });
});

describe('bootstrap (onboarding without a public database endpoint)', () => {
  const opts = {
    projectKey: 'acme',
    projectName: 'Acme',
    repoUrl: 'https://example.test/r',
    envName: 'prod',
    envKind: 'prod',
    subscriptionId: SUB,
    resourceGroup: 'rg-acme-prod',
    adminOid: 'admin-1',
  };
  it('is idempotent and grants the first admin', async () => {
    ctx = await makeApp(null);
    const a = await bootstrap(ctx.db, opts);
    const b = await bootstrap(ctx.db, opts);
    expect(a.environmentId).toBe(b.environmentId);
    const g = await ctx.db.query(
      'SELECT role FROM environment_access WHERE environment_id=$1 AND principal_oid=$2 ORDER BY role',
      [a.environmentId, 'admin-1'],
    );
    expect(g.rows.map((r) => r.role)).toEqual(['admin', 'viewer']);
  });
  it('rejects invalid input', async () => {
    ctx = await makeApp(null);
    await expect(bootstrap(ctx.db, { ...opts, subscriptionId: 'nope' })).rejects.toThrow();
    await expect(bootstrap(ctx.db, { ...opts, envKind: 'qa' })).rejects.toThrow();
    await expect(bootstrap(ctx.db, { ...opts, projectKey: 'Bad Key' })).rejects.toThrow();
  });
});
