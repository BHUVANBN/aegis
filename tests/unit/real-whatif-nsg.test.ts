import { describe, expect, it } from 'vitest';
import { evaluateLocalRules } from '../../apps/api/src/agents/policy';
import type { ChangedResource } from '../../packages/shared/src/index';

// Captured from a real `az deployment group what-if` run: the removed HTTPS rule is reported at path "properties"
// with before = { securityRules: [...] } and after = null.
const realNsgRemoval: ChangedResource = {
  resourceId:
    '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-demo-prod/providers/Microsoft.Network/networkSecurityGroups/nsg-web-prod',
  subscriptionId: '00000000-0000-0000-0000-000000000000',
  resourceGroup: 'rg-demo-prod',
  type: 'Microsoft.Network/networkSecurityGroups',
  name: 'nsg-web-prod',
  changeType: 'Modify',
  truncated: false,
  propertyChanges: [
    {
      path: 'properties',
      changeType: 'Delete',
      after: null,
      before: {
        securityRules: [
          {
            name: 'allow-https-inbound',
            properties: {
              access: 'Allow',
              priority: 110,
              protocol: 'Tcp',
              direction: 'Inbound',
              sourcePortRange: '*',
              sourceAddressPrefix: 'Internet',
              destinationPortRange: '443',
              destinationAddressPrefix: '*',
            },
          },
        ],
      },
    },
  ],
};

describe('real What-If shape for NSG rule removal', () => {
  it('flags removal of public HTTPS as a prohibited critical finding in prod', () => {
    const hit = evaluateLocalRules([realNsgRemoval], 'prod').find((x) => x.ruleId === 'LR-NET-001');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('critical');
    expect(hit?.prohibited).toBe(true);
  });
  it('still flags it in dev but is not prohibited there', () => {
    const hit = evaluateLocalRules([realNsgRemoval], 'dev').find((x) => x.ruleId === 'LR-NET-001');
    expect(hit).toBeDefined();
    expect(hit?.prohibited).toBe(false);
  });
});
