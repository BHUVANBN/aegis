const SUB = '00000000-0000-0000-0000-000000000000';
const rid = (rg: string, provider: string, name: string): string =>
  `/subscriptions/${SUB}/resourceGroups/${rg}/providers/${provider}/${name}`;

export interface SampleScenario {
  tag: 'crit' | 'med' | 'low';
  kind: 'prod' | 'dev';
  title: string;
  expected: string;
  whatIf: unknown;
}

export const SAMPLE_SCENARIOS: SampleScenario[] = [
  {
    tag: 'crit',
    kind: 'prod',
    title: 'Remove public HTTPS from a production firewall',
    expected: 'Critical, blocked',
    whatIf: {
      status: 'Succeeded',
      diagnostics: [],
      changes: [
        {
          resourceId: rid('rg-demo-prod', 'Microsoft.Network', 'networkSecurityGroups/nsg-web'),
          changeType: 'Modify',
          before: { name: 'nsg-web', type: 'Microsoft.Network/networkSecurityGroups', location: 'centralindia' },
          after: { name: 'nsg-web', type: 'Microsoft.Network/networkSecurityGroups', location: 'centralindia' },
          delta: [
            {
              path: 'properties.securityRules',
              propertyChangeType: 'Modify',
              children: [
                {
                  path: '[1]',
                  propertyChangeType: 'Delete',
                  before: {
                    name: 'allow-https-inbound',
                    properties: {
                      access: 'Allow',
                      direction: 'Inbound',
                      priority: 110,
                      protocol: 'Tcp',
                      sourceAddressPrefix: '*',
                      sourcePortRange: '*',
                      destinationAddressPrefix: '*',
                      destinationPortRange: '443',
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    tag: 'med',
    kind: 'prod',
    title: 'Resize a production virtual machine',
    expected: 'Medium, approval required',
    whatIf: {
      status: 'Succeeded',
      diagnostics: [],
      changes: [
        {
          resourceId: rid('rg-demo-prod', 'Microsoft.Compute', 'virtualMachines/vm-app-01'),
          changeType: 'Modify',
          delta: [
            {
              path: 'properties.hardwareProfile.vmSize',
              propertyChangeType: 'Modify',
              before: 'Standard_B2s',
              after: 'Standard_B4ms',
            },
          ],
        },
      ],
    },
  },
  {
    tag: 'low',
    kind: 'dev',
    title: 'Add a cost-centre tag in development',
    expected: 'Low, allowed',
    whatIf: {
      status: 'Succeeded',
      diagnostics: [],
      changes: [
        {
          resourceId: rid('rg-demo-dev', 'Microsoft.Storage', 'storageAccounts/stdemodev001'),
          changeType: 'Modify',
          delta: [{ path: 'tags.costCenter', propertyChangeType: 'Create', after: 'cc-1042' }],
        },
      ],
    },
  },
];

export async function sha256Digest(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
}
