param location string
param namePrefix string
param tags object

// PostgreSQL private access requires a private DNS zone whose name ends with .postgres.database.azure.com
var dnsZoneName = '${namePrefix}.private.postgres.database.azure.com'

resource vnet 'Microsoft.Network/virtualNetworks@2025-05-01' = {
  name: '${namePrefix}-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: [ '10.30.0.0/16' ] }
    subnets: [
      {
        // Container Apps (consumption-only environment) needs a /23 subnet
        name: 'snet-containerapps'
        properties: {
          addressPrefix: '10.30.0.0/23'
          delegations: [
            { name: 'cae', properties: { serviceName: 'Microsoft.App/environments' } }
          ]
        }
      }
      {
        name: 'snet-postgres'
        properties: {
          addressPrefix: '10.30.2.0/28'
          delegations: [
            { name: 'pg', properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' } }
          ]
        }
      }
    ]
  }
}

resource zone 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: dnsZoneName
  location: 'global'
  tags: tags
}

resource link 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: zone
  name: 'link-${namePrefix}'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: { id: vnet.id }
  }
}

output containerAppsSubnetId string = '${vnet.id}/subnets/snet-containerapps'
output postgresSubnetId string = '${vnet.id}/subnets/snet-postgres'
output privateDnsZoneId string = zone.id
// consumers depend on the link so DNS resolution exists when the server is created
output dnsLinkId string = link.id
