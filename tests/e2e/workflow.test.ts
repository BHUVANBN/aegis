import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type pg from 'pg';
import { ALICE, BOB, CAROL, PIPE, digestOf, fixture, makeApp, MockArg } from '../helpers';
import type { AegisApp } from '../../apps/api/src/app';

/** End-to-end API workflow with recorded-style fixtures and a mocked Azure Resource Graph. No real Azure calls. */
let app: AegisApp;
let db: pg.Pool;
const vmId =
  '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-demo-prod/providers/Microsoft.Compute/virtualMachines/vm-app-01';
let observedSize = 'Standard_B2s';
const arg = new MockArg((kql) => {
  if (kql.startsWith('alertsmanagementresources')) return [];
  if (kql.includes("contains '"))
    return [
      {
        id: vmId.replace('virtualMachines/vm-app-01', 'networkInterfaces/nic-app-01'),
        name: 'nic-app-01',
        type: 'microsoft.network/networkinterfaces',
      },
    ];
  if (kql.includes('policyresources')) return [];
  if (kql.includes('in ('))
    return [
      {
        id: vmId,
        type: 'microsoft.compute/virtualmachines',
        properties: { hardwareProfile: { vmSize: observedSize }, provisioningState: 'Succeeded' },
        provisioningState: 'Succeeded',
      },
    ];
  return [];
});
beforeAll(async () => {
  ({ app, db } = await makeApp(arg));
});
afterAll(async () => {
  await app.drain();
  await db.end();
});

describe('submission -> assessment -> approval -> authorized deployment -> verification', () => {
  it('runs the full governed workflow', async () => {
    const digest = digestOf('compiled-main.json:vm-resize');
    const create = await request(app)
      .post('/api/assessments')
      .set('Authorization', ALICE)
      .send({
        projectKey: 'demo',
        environment: 'prod',
        commitSha: 'a1b2c3d4e5',
        pipelineRunId: 'build-101',
        artifactDigest: digest,
        templatePath: 'infra/main.bicep',
        whatIf: fixture('whatif-vm-resize.json'),
      });
    expect(create.status).toBe(202);
    await app.drain();
    const id = create.body.id as string;

    // dashboard data
    const a = (await request(app).get(`/api/assessments/${id}`).set('Authorization', ALICE)).body;
    expect(a).toMatchObject({
      status: 'complete',
      risk_level: 'medium',
      gate_decision: 'require_approval',
      environment: 'prod',
    });
    const deps = (await request(app).get(`/api/assessments/${id}/dependencies`).set('Authorization', ALICE))
      .body.items;
    expect(
      deps.some(
        (d: { kind: string; from_resource_id: string }) =>
          d.kind === 'confirmed-reference' && d.from_resource_id.endsWith('nic-app-01'),
      ),
    ).toBe(true);
    const risk = (await request(app).get(`/api/assessments/${id}/risk`).set('Authorization', ALICE)).body;
    expect(risk.contributions.length).toBeGreaterThan(0);
    expect(risk.detail.blastRadius.confirmedDependents).toBe(1);

    // gate says no without approval
    const gate = (await request(app).get(`/api/assessments/${id}/gate`).set('Authorization', ALICE)).body;
    expect(gate.decision).toBe('require_approval');

    // approval
    const ar = await request(app)
      .post(`/api/assessments/${id}/approval-requests`)
      .set('Authorization', ALICE)
      .send({ justification: 'Needed for scheduled load test' });
    expect(ar.status).toBe(201);
    const pending = (
      await request(app).get('/api/approval-requests?status=pending').set('Authorization', BOB)
    ).body.items;
    expect(pending.map((p: { id: string }) => p.id)).toContain(ar.body.id);
    expect(
      (
        await request(app)
          .post(`/api/approval-requests/${ar.body.id}/decision`)
          .set('Authorization', BOB)
          .send({ decision: 'approve', comment: 'Window confirmed with app owner' })
      ).status,
    ).toBe(200);

    // pipeline: authorize exact artifact, deploy (simulated), report result
    const auth = await request(app)
      .post('/api/deployments/authorize')
      .set('Authorization', PIPE)
      .send({ assessmentId: id, artifactDigest: digest, environment: 'prod', pipelineRunId: 'release-55' });
    expect(auth.status).toBe(200);
    const depId = auth.body.deploymentId as string;
    observedSize = 'Standard_B4ms'; // "Azure" now reflects the deployed change
    expect(
      (
        await request(app)
          .post(`/api/deployments/${depId}/result`)
          .set('Authorization', PIPE)
          .send({ status: 'succeeded', azureDeploymentName: 'aegis-release-55' })
      ).status,
    ).toBe(200);

    // verification
    const ver = await request(app)
      .post(`/api/deployments/${depId}/verification`)
      .set('Authorization', PIPE)
      .send({});
    expect(ver.status).toBe(201);
    expect(ver.body.status).toBe('passed');
    const dep = (await request(app).get(`/api/deployments/${depId}`).set('Authorization', ALICE)).body;
    expect(dep.verifications[0].status).toBe('passed');

    // audit trail
    const actions = (
      await request(app).get(`/api/assessments/${id}/audit`).set('Authorization', ALICE)
    ).body.items.map((e: { action: string }) => e.action);
    expect(actions).toEqual([
      'assessment.created',
      'assessment.completed',
      'approval.requested',
      'approval.approved',
      'deployment.authorized',
      'deployment.succeeded',
      'verification.recorded',
    ]);
    expect((await request(app).get('/api/audit/verify').set('Authorization', CAROL)).body.ok).toBe(true);
  });

  it('records a failed verification when Azure state does not match the approved change', async () => {
    const digest = digestOf('compiled-main.json:vm-resize-2');
    const c = await request(app)
      .post('/api/assessments')
      .set('Authorization', ALICE)
      .send({
        projectKey: 'demo',
        environment: 'prod',
        commitSha: 'a1b2c3d4e6',
        pipelineRunId: 'build-102',
        artifactDigest: digest,
        templatePath: 'infra/main.bicep',
        whatIf: fixture('whatif-vm-resize.json'),
      });
    await app.drain();
    const id = c.body.id as string;
    const ar = await request(app)
      .post(`/api/assessments/${id}/approval-requests`)
      .set('Authorization', ALICE)
      .send({ justification: 'Second resize rehearsal' });
    await request(app)
      .post(`/api/approval-requests/${ar.body.id}/decision`)
      .set('Authorization', CAROL)
      .send({ decision: 'approve', comment: 'ok per change board' });
    const auth = await request(app)
      .post('/api/deployments/authorize')
      .set('Authorization', PIPE)
      .send({ assessmentId: id, artifactDigest: digest, environment: 'prod', pipelineRunId: 'release-56' });
    expect(auth.status).toBe(200);
    await request(app)
      .post(`/api/deployments/${auth.body.deploymentId}/result`)
      .set('Authorization', PIPE)
      .send({ status: 'succeeded' });
    observedSize = 'Standard_B2s'; // drift: Azure still shows the old size
    const ver = await request(app)
      .post(`/api/deployments/${auth.body.deploymentId}/verification`)
      .set('Authorization', PIPE)
      .send({});
    expect(ver.body.status).toBe('failed');
    expect(ver.body.discrepancies[0]).toMatchObject({ expected: 'Standard_B4ms', observed: 'Standard_B2s' });
  });
});
