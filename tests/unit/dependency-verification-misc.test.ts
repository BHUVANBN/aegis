import { describe, expect, it } from 'vitest';
import { parseWhatIf } from '../../apps/api/src/agents/perception';
import { runDependencyAgent } from '../../apps/api/src/agents/dependency';
import { runPolicyAgent } from '../../apps/api/src/agents/policy';
import { compareState } from '../../apps/api/src/verification';
import { redact } from '../../apps/api/src/audit';
import { canonicalJson, getByPath, withTimeout, TimeoutError } from '../../apps/api/src/util';
import { loadConfig } from '../../apps/api/src/config';
import { fixture, MockArg } from '../helpers';

const SUB = ['00000000-0000-0000-0000-000000000000'];

describe('dependency agent', () => {
  it('reports unavailable when ARG is not configured', async () => {
    const out = await runDependencyAgent(
      parseWhatIf(fixture('whatif-nsg-https-removed.json')).resources,
      null,
      SUB,
    );
    expect(out.status).toBe('unavailable');
  });
  it('maps confirmed references and inferred co-location separately', async () => {
    const arg = new MockArg((kql) =>
      kql.includes('contains')
        ? [
            {
              id: '/subscriptions/s/resourceGroups/rg-demo-prod/providers/Microsoft.Network/virtualNetworks/vnet1',
              name: 'vnet1',
              type: 'microsoft.network/virtualnetworks',
            },
          ]
        : [
            {
              id: '/subscriptions/s/resourceGroups/rg-demo-prod/providers/Microsoft.Compute/virtualMachines/vm1',
              name: 'vm1',
              type: 'microsoft.compute/virtualmachines',
            },
          ],
    );
    const out = await runDependencyAgent(
      parseWhatIf(fixture('whatif-nsg-https-removed.json')).resources,
      arg,
      SUB,
    );
    expect(out.status).toBe('ok');
    expect(out.edges.some((e) => e.kind === 'confirmed-reference' && e.from.endsWith('vnet1'))).toBe(true);
    expect(out.edges.some((e) => e.kind === 'inferred-colocation' && e.from.endsWith('vm1'))).toBe(true);
    expect(out.limitations.join(' ')).toMatch(/NOT visible/);
  });
  it('permission failures become unavailable, never ok', async () => {
    const out = await runDependencyAgent(
      parseWhatIf(fixture('whatif-nsg-https-removed.json')).resources,
      new MockArg(() => new Error('Resource Graph HTTP 403 (missing Reader permission?)')),
      SUB,
    );
    expect(out.status).toBe('unavailable');
    expect(out.reason).toMatch(/403/);
  });
  it('does not query ids with unexpected characters (query injection guard)', async () => {
    const arg = new MockArg();
    const r = parseWhatIf({
      status: 'Succeeded',
      changes: [
        { resourceId: "/subscriptions/s/resourceGroups/r/providers/A.B/c/d'; drop", changeType: 'Modify' },
      ],
    }).resources;
    const out = await runDependencyAgent(r, arg, SUB);
    expect(arg.calls).toHaveLength(0);
    expect(out.limitations.join(' ')).toMatch(/unexpected characters/);
  });
});

describe('policy agent azure state', () => {
  it('never reports compliance when the policy query fails', async () => {
    const out = await runPolicyAgent(
      parseWhatIf(fixture('whatif-vm-resize.json')).resources,
      'prod',
      new MockArg(() => new Error('boom')),
      SUB,
    );
    expect(out.azurePolicy.status).toBe('unavailable');
  });
  it('adds a finding for existing non-compliance', async () => {
    const r = parseWhatIf(fixture('whatif-vm-resize.json')).resources;
    const out = await runPolicyAgent(
      r,
      'prod',
      new MockArg(() => [{ resourceId: r[0]!.resourceId, policy: 'require-tags', assignment: 'a1' }]),
      SUB,
    );
    expect(out.findings.some((f) => f.ruleId === 'AP-NONCOMPLIANT' && f.source === 'azure-policy')).toBe(
      true,
    );
  });
});

describe('verification compareState', () => {
  const exp = (r: ReturnType<typeof parseWhatIf>['resources'][number]) => ({
    resource_id: r.resourceId,
    type: r.type,
    name: r.name,
    change_type: r.changeType,
    property_changes: r.propertyChanges,
    resource_group: r.resourceGroup,
  });
  const vm = parseWhatIf(fixture('whatif-vm-resize.json')).resources;
  const row = (size: string) => ({
    id: vm[0]!.resourceId,
    type: 'x',
    properties: { hardwareProfile: { vmSize: size }, provisioningState: 'Succeeded' },
    provisioningState: 'Succeeded',
  });
  const route =
    (size: string, alerts: unknown[] = []) =>
    (kql: string) =>
      kql.startsWith('alertsmanagementresources') ? alerts : [row(size)];
  it('passes when state matches and no alerts fired', async () => {
    const r = await compareState(
      vm.map(exp),
      new MockArg(route('Standard_B4ms')),
      SUB,
      'rg-demo-prod',
      new Date(),
      'succeeded',
    );
    expect(r.status).toBe('passed');
  });
  it('fails on property mismatch', async () => {
    const r = await compareState(
      vm.map(exp),
      new MockArg(route('Standard_B2s')),
      SUB,
      'rg-demo-prod',
      new Date(),
      'succeeded',
    );
    expect(r.status).toBe('failed');
    expect(r.discrepancies[0]!.note).toBe('properties.hardwareProfile.vmSize');
  });
  it('fails when alerts fired', async () => {
    const r = await compareState(
      vm.map(exp),
      new MockArg(route('Standard_B4ms', [{ name: 'cpu', sev: 'Sev2' }])),
      SUB,
      'rg-demo-prod',
      new Date(),
      'succeeded',
    );
    expect(r.status).toBe('failed');
  });
  it('is inconclusive when Resource Graph is unavailable or deployment not reported', async () => {
    expect((await compareState(vm.map(exp), null, SUB, null, new Date(), 'succeeded')).status).toBe(
      'inconclusive',
    );
    expect(
      (await compareState(vm.map(exp), new MockArg(() => new Error('x')), SUB, null, new Date(), 'succeeded'))
        .status,
    ).toBe('inconclusive');
    expect((await compareState(vm.map(exp), new MockArg(), SUB, null, new Date(), 'authorized')).status).toBe(
      'inconclusive',
    );
    expect((await compareState(vm.map(exp), new MockArg(), SUB, null, new Date(), 'failed')).status).toBe(
      'failed',
    );
  });
  it('is partially verified when health signals cannot be queried', async () => {
    const r = await compareState(
      vm.map(exp),
      new MockArg(route('Standard_B4ms')),
      SUB,
      null,
      new Date(),
      'succeeded',
    );
    expect(r.status).toBe('partially_verified');
  });
  it('verifies NSG rule removal by element name, not by index', async () => {
    const nsg = parseWhatIf(fixture('whatif-nsg-https-removed.json')).resources.filter((r) =>
      r.type.endsWith('networkSecurityGroups'),
    );
    const present = [
      {
        id: nsg[0]!.resourceId,
        properties: { securityRules: [{ name: 'allow-https-inbound' }], provisioningState: 'Succeeded' },
        provisioningState: 'Succeeded',
      },
    ];
    const absent = [
      {
        id: nsg[0]!.resourceId,
        properties: { securityRules: [{ name: 'other' }], provisioningState: 'Succeeded' },
        provisioningState: 'Succeeded',
      },
    ];
    expect(
      (await compareState(nsg.map(exp), new MockArg(() => present), SUB, null, new Date(), 'succeeded'))
        .status,
    ).toBe('failed');
    expect(
      (
        await compareState(
          nsg.map(exp),
          new MockArg((k) => (k.startsWith('alerts') ? [] : absent)),
          SUB,
          'rg-demo-prod',
          new Date(),
          'succeeded',
        )
      ).status,
    ).toBe('passed');
  });
});

describe('utilities', () => {
  it('canonicalJson is key-order independent', () =>
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(
      canonicalJson({ a: [2, { c: 2, d: 1 }], b: 1 }),
    ));
  it('getByPath handles arrays and case', () =>
    expect(getByPath({ Properties: { rules: [{ n: 1 }] } }, 'properties.rules[0].n')).toBe(1));
  it('withTimeout rejects', async () => {
    await expect(withTimeout(new Promise(() => undefined), 20, 'x')).rejects.toBeInstanceOf(TimeoutError);
  });
  it('redact removes secret-like keys', () =>
    expect(redact({ apiKey: 'x', nested: { Authorization: 'y', ok: 1 } })).toEqual({
      apiKey: '[redacted]',
      nested: { Authorization: '[redacted]', ok: 1 },
    }));
});

describe('config safety', () => {
  const base = { DATABASE_URL: 'postgres://x' };
  it('refuses dev auth in production', () =>
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', AUTH_MODE: 'dev' } as never)).toThrow(
      /forbidden/,
    ));
  it('requires tenant/audience for entra', () =>
    expect(() => loadConfig({ ...base, AUTH_MODE: 'entra' } as never)).toThrow(/ENTRA_TENANT_ID/));
  it('defaults to entra auth', () => expect(() => loadConfig({ ...base } as never)).toThrow());
  it('requires LLM settings when enabled', () =>
    expect(() => loadConfig({ ...base, AUTH_MODE: 'dev', LLM_PROVIDER: 'azure-openai' } as never)).toThrow());
});
