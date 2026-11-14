import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type pg from 'pg';
import { ALICE, BOB, CAROL, PIPE, digestOf, fixture, makeApp, MockArg, tok } from '../helpers';
import type { AegisApp } from '../../apps/api/src/app';
import { runAssessment } from '../../apps/api/src/agents/orchestrator';
import { NullProvider } from '../../apps/api/src/llm/provider';

let ctx: { app: AegisApp; db: pg.Pool; cfg: ReturnType<typeof import('../helpers').testConfig> } | null =
  null;
afterEach(async () => {
  if (ctx) {
    await ctx.app.drain();
    await ctx.db.end();
    ctx = null;
  }
});

const goodArg = () => new MockArg();
let n = 0;
async function submit(
  c: NonNullable<typeof ctx>,
  file: string,
  environment: 'dev' | 'prod',
  over: Record<string, unknown> = {},
) {
  n++;
  const body = {
    projectKey: 'demo',
    environment,
    commitSha: 'abcdef1234',
    pipelineRunId: `run-${n}`,
    artifactDigest: digestOf(`${file}-${n}`),
    templatePath: 'infra/main.bicep',
    whatIf: fixture(file),
    ...over,
  };
  const res = await request(c.app).post('/api/assessments').set('Authorization', ALICE).send(body);
  await c.app.drain();
  return { res, body };
}
const get = (c: NonNullable<typeof ctx>, path: string, who = ALICE) =>
  request(c.app).get(path).set('Authorization', who);

describe('platform', () => {
  it('health, readiness, security headers, unknown routes', async () => {
    ctx = await makeApp(goodArg());
    expect((await request(ctx.app).get('/healthz')).body).toEqual({ status: 'ok' });
    const r = await request(ctx.app).get('/readyz');
    expect(r.body.status).toBe('ready');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-powered-by']).toBeUndefined();
    const nf = await request(ctx.app).get('/nope');
    expect(nf.status).toBe(404);
    expect(JSON.stringify(nf.body)).not.toMatch(/stack|at /);
  });
  it('requires authentication and rejects bad tokens', async () => {
    ctx = await makeApp(goodArg());
    expect((await request(ctx.app).get('/api/me')).status).toBe(401);
    expect((await request(ctx.app).get('/api/me').set('Authorization', 'Bearer garbage')).status).toBe(401);
    expect((await get(ctx, '/api/me')).body.grants.length).toBeGreaterThan(0);
  });
  it('validates input and limits body size', async () => {
    ctx = await makeApp(goodArg());
    const bad = await request(ctx.app).post('/api/assessments').set('Authorization', ALICE).send({
      projectKey: 'demo',
      environment: 'dev',
      commitSha: 'zz',
      pipelineRunId: 'r',
      artifactDigest: 'nope',
      templatePath: 'x',
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('validation_failed');
    expect(bad.body.error.details.map((d: { path: string }) => d.path)).toEqual(
      expect.arrayContaining(['commitSha', 'artifactDigest']),
    );
    expect(
      (
        await request(ctx.app)
          .post('/api/assessments')
          .set('Authorization', ALICE)
          .set('Content-Type', 'application/json')
          .send('{bad')
      ).status,
    ).toBe(400);
    expect(
      (
        await request(ctx.app)
          .post('/api/assessments')
          .set('Authorization', ALICE)
          .send({ blob: 'x'.repeat(6 * 1024 * 1024) })
      ).status,
    ).toBe(413);
    expect((await get(ctx, '/api/assessments/not-a-uuid')).status).toBe(400);
  });
  it('enforces role AND environment grants', async () => {
    ctx = await makeApp(goodArg());
    const body = {
      projectKey: 'demo',
      environment: 'dev',
      commitSha: 'abcdef1',
      pipelineRunId: 'r',
      artifactDigest: digestOf('x'),
      templatePath: 'm.bicep',
      whatIf: fixture('whatif-tag-only.json'),
    };
    expect(
      (
        await request(ctx.app)
          .post('/api/assessments')
          .set('Authorization', tok('alice@example.test', 'viewer'))
          .send(body)
      ).status,
    ).toBe(403); // role missing
    expect(
      (
        await request(ctx.app)
          .post('/api/assessments')
          .set('Authorization', tok('mallory@example.test', 'assessor,admin'))
          .send(body)
      ).status,
    ).toBe(403); // no grant
    await ctx.db.query(
      `DELETE FROM environment_access WHERE principal_oid='alice@example.test' AND environment_id=(SELECT id FROM environments WHERE name='prod')`,
    );
    const prodBody = { ...body, environment: 'prod' };
    expect(
      (await request(ctx.app).post('/api/assessments').set('Authorization', ALICE).send(prodBody)).status,
    ).toBe(403); // grant removed for prod
  });
});

describe('assessments', () => {
  it('low-risk dev change with complete evidence is allowed; results are retrievable', async () => {
    ctx = await makeApp(goodArg());
    const { res } = await submit(ctx, 'whatif-tag-only.json', 'dev');
    expect(res.status).toBe(202);
    const a = (await get(ctx, `/api/assessments/${res.body.id}`)).body;
    expect(a).toMatchObject({ status: 'complete', risk_level: 'low', gate_decision: 'allow', risk_score: 0 });
    expect(a.whatif_raw).toBeUndefined();
    const runs = (await get(ctx, `/api/assessments/${res.body.id}/agent-runs`)).body.items.map(
      (r: { agent: string }) => r.agent,
    );
    expect(runs).toEqual([
      'perception',
      'reasoning',
      'dependency',
      'policy',
      'simulation',
      'risk',
      'planning',
      'reviewer',
    ]);
    for (const p of [
      'resources',
      'dependencies',
      'policy-findings',
      'scenarios',
      'recommendations',
      'risk',
      'audit',
      'gate',
      'deployments',
    ])
      expect((await get(ctx, `/api/assessments/${res.body.id}/${p}`)).status).toBe(200);
  });
  it('is idempotent for duplicate submissions', async () => {
    ctx = await makeApp(goodArg());
    const { res, body } = await submit(ctx, 'whatif-tag-only.json', 'dev');
    const again = await request(ctx.app).post('/api/assessments').set('Authorization', ALICE).send(body);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ id: res.body.id, duplicate: true });
    expect((await ctx.db.query('SELECT count(*)::int n FROM assessments')).rows[0].n).toBe(1);
  });
  it('orchestrator does not double-process (retry safety)', async () => {
    ctx = await makeApp(goodArg());
    const { res } = await submit(ctx, 'whatif-tag-only.json', 'dev');
    await runAssessment({ db: ctx.db, cfg: ctx.cfg, arg: goodArg(), llm: new NullProvider() }, res.body.id);
    expect(
      (await ctx.db.query('SELECT count(*)::int n FROM agent_runs WHERE assessment_id=$1', [res.body.id]))
        .rows[0].n,
    ).toBe(8);
  });
  it('unavailable Resource Graph yields a partial assessment that cannot auto-allow', async () => {
    ctx = await makeApp(null);
    const { res } = await submit(ctx, 'whatif-tag-only.json', 'dev');
    const a = (await get(ctx, `/api/assessments/${res.body.id}`)).body;
    expect(a.status).toBe('partial');
    expect(Number(a.confidence)).toBeCloseTo(0.55, 2);
    expect(a.gate_decision).toBe('require_approval');
    expect(a.risk_detail.missingEvidence.length).toBe(2);
  });
  it('permission failures from Resource Graph are partial, never safe', async () => {
    ctx = await makeApp(new MockArg(() => new Error('Resource Graph HTTP 403')));
    const { res } = await submit(ctx, 'whatif-tag-only.json', 'dev');
    const a = (await get(ctx, `/api/assessments/${res.body.id}`)).body;
    expect(a.status).toBe('partial');
    expect(a.gate_decision).not.toBe('allow');
  });
  it('malformed or failed What-If fails the assessment and blocks', async () => {
    ctx = await makeApp(goodArg());
    const { res } = await submit(ctx, 'whatif-failed.json', 'dev');
    const a = (await get(ctx, `/api/assessments/${res.body.id}`)).body;
    expect(a).toMatchObject({ status: 'failed', gate_decision: 'block' });
    const auth = await request(ctx.app).post('/api/deployments/authorize').set('Authorization', PIPE).send({
      assessmentId: res.body.id,
      artifactDigest: a.artifact_digest,
      environment: 'dev',
      pipelineRunId: 'p',
    });
    expect(auth.status).toBe(403);
  });
  it('lists with pagination and only for granted environments', async () => {
    ctx = await makeApp(goodArg());
    await submit(ctx, 'whatif-tag-only.json', 'dev');
    await submit(ctx, 'whatif-tag-only.json', 'dev');
    const l = (await get(ctx, '/api/assessments?limit=1')).body;
    expect(l).toMatchObject({ total: 2, limit: 1 });
    expect(l.items).toHaveLength(1);
    expect((await get(ctx, '/api/assessments', tok('stranger@example.test', 'viewer'))).body.total).toBe(0);
  });
  it('production NSG HTTPS rule removal is blocked and cannot be approved', async () => {
    ctx = await makeApp(goodArg());
    const { res } = await submit(ctx, 'whatif-nsg-https-removed.json', 'prod');
    const a = (await get(ctx, `/api/assessments/${res.body.id}`)).body;
    expect(a).toMatchObject({ risk_level: 'critical', gate_decision: 'block' });
    expect(
      (await get(ctx, `/api/assessments/${res.body.id}/policy-findings`)).body.items.some(
        (f: { rule_id: string; prohibited: boolean }) => f.rule_id === 'LR-NET-001' && f.prohibited,
      ),
    ).toBe(true);
    const ar = await request(ctx.app)
      .post(`/api/assessments/${res.body.id}/approval-requests`)
      .set('Authorization', ALICE)
      .send({ justification: 'please let me through' });
    expect(ar.status).toBe(409);
  });
});

describe('approval and deployment gate', () => {
  async function highRisk(c: NonNullable<typeof ctx>) {
    const { res, body } = await submit(c, 'whatif-vm-resize.json', 'prod');
    const id = res.body.id as string;
    expect((await get(c, `/api/assessments/${id}`)).body.gate_decision).toBe('require_approval');
    return { id, digest: body.artifactDigest as string };
  }
  const authorize = (
    c: NonNullable<typeof ctx>,
    id: string,
    digest: string,
    over: Record<string, unknown> = {},
    who = PIPE,
  ) =>
    request(c.app)
      .post('/api/deployments/authorize')
      .set('Authorization', who)
      .send({
        assessmentId: id,
        artifactDigest: digest,
        environment: 'prod',
        pipelineRunId: 'deploy-1',
        ...over,
      });
  const requestApproval = (c: NonNullable<typeof ctx>, id: string, who = ALICE) =>
    request(c.app)
      .post(`/api/assessments/${id}/approval-requests`)
      .set('Authorization', who)
      .send({ justification: 'Resize needed for load test window' });
  const decide = (c: NonNullable<typeof ctx>, id: string, decision: 'approve' | 'reject', who = BOB) =>
    request(c.app)
      .post(`/api/approval-requests/${id}/decision`)
      .set('Authorization', who)
      .send({ decision, comment: 'reviewed evidence' });

  it('denies without approval; a client-supplied approved flag is ignored', async () => {
    ctx = await makeApp(goodArg());
    const { id, digest } = await highRisk(ctx);
    const r = await authorize(ctx, id, digest, { approved: true, approvalId: 'x' });
    expect(r.status).toBe(403);
    expect(r.body.reasons.join(' ')).toMatch(/No approval request exists/);
  });
  it('only pipeline identities may call authorize', async () => {
    ctx = await makeApp(goodArg());
    const { id, digest } = await highRisk(ctx);
    expect((await authorize(ctx, id, digest, {}, ALICE)).status).toBe(403);
    expect((await authorize(ctx, id, digest, {}, BOB)).status).toBe(403);
  });
  it('enforces separation of duties and approver role', async () => {
    ctx = await makeApp(goodArg());
    const { id } = await highRisk(ctx);
    const ar = (await requestApproval(ctx, id, BOB)).body.id;
    expect((await decide(ctx, ar, 'approve', BOB)).status).toBe(403); // requester cannot decide
    expect((await decide(ctx, ar, 'approve', ALICE)).status).toBe(403); // assessor is not approver
    expect((await decide(ctx, ar, 'approve', CAROL)).status).toBe(200);
    expect((await decide(ctx, ar, 'approve', CAROL)).status).toBe(409); // already decided
    expect((await requestApproval(ctx, id)).status).toBe(409); // open approval exists
  });
  it('full approval path: digest, environment and single-use binding', async () => {
    ctx = await makeApp(goodArg());
    const { id, digest } = await highRisk(ctx);
    const ar = (await requestApproval(ctx, id)).body.id;
    expect((await authorize(ctx, id, digest)).body.reasons.join(' ')).toMatch(/pending/);
    expect((await decide(ctx, ar, 'approve')).body.status).toBe('approved');
    const wrongDigest = await authorize(ctx, id, digestOf('different artifact'));
    expect(wrongDigest.status).toBe(403);
    expect(wrongDigest.body.reasons[0]).toMatch(/digest/);
    expect((await authorize(ctx, id, digest, { environment: 'dev' })).body.reasons[0]).toMatch(/Environment/);
    const ok = await authorize(ctx, id, digest);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ authorized: true, decision: 'require_approval' });
    // second call while in flight: approval is already consumed (and the environment is locked)
    expect((await authorize(ctx, id, digest)).body.reasons.join(' ')).toMatch(/consumed/);
    // finish, then replay: approval already consumed
    expect(
      (
        await request(ctx.app)
          .post(`/api/deployments/${ok.body.deploymentId}/result`)
          .set('Authorization', PIPE)
          .send({ status: 'succeeded', azureDeploymentName: 'aegis-1' })
      ).status,
    ).toBe(200);
    const replay = await authorize(ctx, id, digest);
    expect(replay.status).toBe(403);
    expect(replay.body.reasons.join(' ')).toMatch(/consumed/);
  });
  it('rejects expired and revoked approvals', async () => {
    ctx = await makeApp(goodArg());
    const { id, digest } = await highRisk(ctx);
    const ar = (await requestApproval(ctx, id)).body.id;
    await decide(ctx, ar, 'approve');
    await ctx.db.query(`UPDATE approval_requests SET expires_at = now() - interval '1 minute' WHERE id=$1`, [
      ar,
    ]);
    expect((await authorize(ctx, id, digest)).body.reasons.join(' ')).toMatch(/expired/);
    // new assessment, approve then revoke
    const second = await highRisk(ctx);
    const ar2 = (await requestApproval(ctx, second.id)).body.id;
    await decide(ctx, ar2, 'approve');
    expect(
      (await request(ctx.app).post(`/api/approval-requests/${ar2}/revoke`).set('Authorization', BOB).send({}))
        .status,
    ).toBe(200);
    expect((await authorize(ctx, second.id, second.digest)).body.reasons.join(' ')).toMatch(/revoked/);
  });
  it('rejected approvals do not authorize', async () => {
    ctx = await makeApp(goodArg());
    const { id, digest } = await highRisk(ctx);
    const ar = (await requestApproval(ctx, id)).body.id;
    await decide(ctx, ar, 'reject');
    expect((await authorize(ctx, id, digest)).status).toBe(403);
  });
  it('allows low-risk changes without approval but only one deployment per environment at a time', async () => {
    ctx = await makeApp(goodArg());
    const a1 = await submit(ctx, 'whatif-tag-only.json', 'dev');
    const a2 = await submit(ctx, 'whatif-tag-only.json', 'dev');
    const call = (r: typeof a1) =>
      request(ctx!.app).post('/api/deployments/authorize').set('Authorization', PIPE).send({
        assessmentId: r.res.body.id,
        artifactDigest: r.body.artifactDigest,
        environment: 'dev',
        pipelineRunId: 'd',
      });
    const [x, y] = await Promise.all([call(a1), call(a2)]);
    expect([x.status, y.status].sort()).toEqual([200, 403]);
  });
  it('writes every decision to a verifiable audit trail', async () => {
    ctx = await makeApp(goodArg());
    const { id, digest } = await highRisk(ctx);
    await authorize(ctx, id, digest);
    const events = (await get(ctx, `/api/assessments/${id}/audit`)).body.items.map(
      (e: { action: string }) => e.action,
    );
    expect(events).toEqual(['assessment.created', 'assessment.completed', 'deployment.authorize.denied']);
    expect((await get(ctx, '/api/audit', ALICE)).status).toBe(403);
    expect((await get(ctx, '/api/audit', CAROL)).status).toBe(200);
    expect((await get(ctx, '/api/audit/verify', CAROL)).body.ok).toBe(true);
  });
});

describe('token role is required in addition to environment grants', () => {
  it('a principal with a database grant but no recognised token role is rejected', async () => {
    ctx = await makeApp(goodArg());
    const noRole = tok('alice@example.test', '');
    expect((await get(ctx, '/api/assessments', noRole)).status).toBe(403);
    expect((await get(ctx, '/api/environments', noRole)).status).toBe(403);
    expect((await get(ctx, '/api/me', noRole)).status).toBe(200); // /me stays available so the UI can explain
  });
  it('admin can read assessments but cannot call pipeline-only authorization', async () => {
    ctx = await makeApp(goodArg());
    const { res, body } = await submit(ctx, 'whatif-tag-only.json', 'dev');
    expect(
      (await get(ctx, `/api/assessments/${res.body.id}`, tok('carol@example.test', 'admin'))).status,
    ).toBe(200);
    const r = await request(ctx.app)
      .post('/api/deployments/authorize')
      .set('Authorization', tok('carol@example.test', 'admin'))
      .send({
        assessmentId: res.body.id,
        artifactDigest: body.artifactDigest,
        environment: 'dev',
        pipelineRunId: 'x',
      });
    expect(r.status).toBe(403);
  });
});

describe('admin access management', () => {
  it('admin can grant access; non-admin cannot; the grant is audited and effective', async () => {
    ctx = await makeApp(goodArg());
    const grant = { principalId: 'dave@example.test', environment: 'dev', role: 'viewer' };
    expect(
      (await request(ctx.app).put('/api/admin/access').set('Authorization', ALICE).send(grant)).status,
    ).toBe(403);
    expect(
      (await request(ctx.app).put('/api/admin/access').set('Authorization', CAROL).send(grant)).status,
    ).toBe(204);
    expect(
      (
        await request(ctx.app)
          .put('/api/admin/access')
          .set('Authorization', CAROL)
          .send({ ...grant, role: 'nope' })
      ).status,
    ).toBe(400);
    const me = await get(ctx, '/api/me', tok('dave@example.test', 'viewer'));
    expect(me.body.grants).toEqual([{ environment: 'dev', kind: 'dev', role: 'viewer' }]);
    expect(
      (await ctx.db.query(`SELECT count(*)::int n FROM audit_events WHERE action='access.granted'`)).rows[0]
        .n,
    ).toBe(1);
  });
});
