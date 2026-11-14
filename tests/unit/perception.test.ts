import { describe, expect, it } from 'vitest';
import { parseResourceId, parseWhatIf, PerceptionError } from '../../apps/api/src/agents/perception';
import { fixture } from '../helpers';

describe('parseResourceId', () => {
  it('parses top-level and nested resources', () => {
    const a = parseResourceId(
      '/subscriptions/s1/resourceGroups/rg1/providers/Microsoft.Network/networkSecurityGroups/nsg1',
    );
    expect(a).toMatchObject({
      subscriptionId: 's1',
      resourceGroup: 'rg1',
      type: 'Microsoft.Network/networkSecurityGroups',
      name: 'nsg1',
    });
    const b = parseResourceId(
      '/subscriptions/s1/resourceGroups/rg1/providers/Microsoft.Network/networkSecurityGroups/nsg1/securityRules/r1',
    );
    expect(b.type).toBe('Microsoft.Network/networkSecurityGroups/securityRules');
    expect(b.name).toBe('r1');
  });
  it('parses subscription-scope and resource-group ids', () => {
    expect(
      parseResourceId('/subscriptions/s1/providers/Microsoft.Authorization/roleAssignments/g1').resourceGroup,
    ).toBeNull();
    expect(parseResourceId('/subscriptions/s1/resourceGroups/rg1').type).toBe(
      'Microsoft.Resources/resourceGroups',
    );
  });
  it('rejects garbage', () => {
    expect(() => parseResourceId('not-an-id')).toThrow(PerceptionError);
  });
});

describe('parseWhatIf', () => {
  it('flattens nested delta children into full property paths', () => {
    const out = parseWhatIf(fixture('whatif-nsg-https-removed.json'));
    const nsg = out.resources.find((r) => r.name === 'nsg-web')!;
    expect(nsg.changeType).toBe('Modify');
    expect(nsg.propertyChanges).toHaveLength(1);
    expect(nsg.propertyChanges[0]).toMatchObject({
      path: 'properties.securityRules[1]',
      changeType: 'Delete',
    });
    expect(out.parserVersion).toMatch(/^whatif-parser/);
    expect(out.rawSha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it('is deterministic for the same input', () => {
    expect(parseWhatIf(fixture('whatif-vm-resize.json')).rawSha256).toBe(
      parseWhatIf(fixture('whatif-vm-resize.json')).rawSha256,
    );
  });
  it('accepts the REST response shape (properties.changes)', () => {
    const f = fixture('whatif-tag-only.json') as { changes: unknown[] };
    expect(parseWhatIf({ status: 'Succeeded', properties: { changes: f.changes } }).resources).toHaveLength(
      1,
    );
  });
  it('rejects failed previews and malformed payloads', () => {
    expect(() => parseWhatIf(fixture('whatif-failed.json'))).toThrow(PerceptionError);
    expect(() => parseWhatIf(null)).toThrow(PerceptionError);
    expect(() => parseWhatIf({ status: 'Succeeded' })).toThrow(/no "changes"/);
  });
  it('skips malformed entries with warnings but fails if nothing is usable', () => {
    const good = (fixture('whatif-tag-only.json') as { changes: unknown[] }).changes[0];
    const out = parseWhatIf({
      status: 'Succeeded',
      changes: [
        good,
        5,
        { changeType: 'Modify' },
        { resourceId: 'bad', changeType: 'Modify' },
        { resourceId: '/subscriptions/s/resourceGroups/r/providers/A.B/c/d', changeType: 'Weird' },
      ],
    });
    expect(out.resources).toHaveLength(1);
    expect(out.warnings.length).toBe(4);
    expect(() => parseWhatIf({ status: 'Succeeded', changes: [5] })).toThrow(PerceptionError);
  });
  it('caps very large assessments and flags truncation', () => {
    const one = (fixture('whatif-tag-only.json') as { changes: { resourceId: string }[] }).changes[0]!;
    const many = Array.from({ length: 2100 }, (_, i) => ({ ...one, resourceId: one.resourceId + i }));
    const out = parseWhatIf({ status: 'Succeeded', changes: many });
    expect(out.resources).toHaveLength(2000);
    expect(out.truncatedResources).toBe(true);
  });
  it('truncates huge per-resource property lists', () => {
    const delta = Array.from({ length: 600 }, (_, i) => ({
      path: `properties.p${i}`,
      propertyChangeType: 'Modify',
      before: 1,
      after: 2,
    }));
    const out = parseWhatIf({
      status: 'Succeeded',
      changes: [
        { resourceId: '/subscriptions/s/resourceGroups/r/providers/A.B/c/d', changeType: 'Modify', delta },
      ],
    });
    expect(out.resources[0]!.propertyChanges).toHaveLength(500);
    expect(out.resources[0]!.truncated).toBe(true);
  });
});
