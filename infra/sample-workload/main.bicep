// Demo workload that AEGIS assesses. Deployed to rg-demo-dev / rg-demo-prod by the pipeline.
targetScope = 'resourceGroup'

@allowed([ 'dev', 'prod' ])
param environmentName string
param location string = resourceGroup().location
@description('Set to false to simulate the risky change: removing public HTTPS access.')
param allowHttps bool = true

var httpsRule = [
  {
    name: 'allow-https-inbound'
    properties: {
      priority: 110
      direction: 'Inbound'
      access: 'Allow'
      protocol: 'Tcp'
      sourcePortRange: '*'
      destinationPortRange: '443'
      sourceAddressPrefix: 'Internet'
      destinationAddressPrefix: '*'
    }
  }
]

resource nsg 'Microsoft.Network/networkSecurityGroups@2025-05-01' = {
  name: 'nsg-web-${environmentName}'
  location: location
  tags: { app: 'aegis-demo', environment: environmentName }
  properties: { securityRules: allowHttps ? httpsRule : [] }
}

resource vnet 'Microsoft.Network/virtualNetworks@2025-05-01' = {
  name: 'vnet-demo-${environmentName}'
  location: location
  tags: { app: 'aegis-demo', environment: environmentName }
  properties: {
    addressSpace: { addressPrefixes: [ '10.20.0.0/16' ] }
    subnets: [
      { name: 'web', properties: { addressPrefix: '10.20.1.0/24', networkSecurityGroup: { id: nsg.id } } }
    ]
  }
}

resource st 'Microsoft.Storage/storageAccounts@2025-01-01' = {
  name: 'stdemo${environmentName}${uniqueString(resourceGroup().id)}'
  location: location
  tags: { app: 'aegis-demo', environment: environmentName }
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
  }
}

output nsgName string = nsg.name
