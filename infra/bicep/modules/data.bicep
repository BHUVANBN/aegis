param location string
param namePrefix string
param tags object
param keyVaultName string
@secure()
@description('PostgreSQL administrator password. Passed at deploy time, stored only in Key Vault.')
param administratorPassword string
@description('Burstable SKU keeps cost low. Stop the server when idle: compute billing stops, storage continues.')
param skuName string = 'Standard_B1ms'
@minValue(32)
param storageGb int = 32
@description('true: VNet-integrated server with NO public endpoint. false: public endpoint + AllowAzureServices firewall rule (weaker).')
param privateDatabase bool = true
param delegatedSubnetId string = ''
param privateDnsZoneId string = ''
@description('Dependency anchor so the DNS zone link exists before the server is created.')
param dnsLinkId string = ''

var serverName = '${namePrefix}-pg-${uniqueString(resourceGroup().id)}'
var adminUser = 'aegisadmin'

resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2025-08-01' = {
  name: serverName
  location: location
  tags: tags
  sku: { name: skuName, tier: 'Burstable' }
  properties: {
    version: '16'
    administratorLogin: adminUser
    administratorLoginPassword: administratorPassword
    storage: { storageSizeGB: storageGb }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    network: privateDatabase
      ? { publicNetworkAccess: 'Disabled', delegatedSubnetResourceId: delegatedSubnetId, privateDnsZoneArmResourceId: privateDnsZoneId }
      : { publicNetworkAccess: 'Enabled' }
  }
}

resource db 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2025-08-01' = {
  parent: pg
  name: 'aegis'
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

// 0.0.0.0 - 0.0.0.0 means "allow Azure services". Production hardening: private endpoint + VNet integration (extra cost).
resource allowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2025-08-01' = if (!privateDatabase) {
  parent: pg
  name: 'AllowAzureServices'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

resource kv 'Microsoft.KeyVault/vaults@2025-05-01' existing = { name: keyVaultName }

resource dbUrl 'Microsoft.KeyVault/vaults/secrets@2025-05-01' = {
  parent: kv
  name: 'database-url'
  properties: {
    value: 'postgres://${adminUser}:${uriComponent(administratorPassword)}@${pg.properties.fullyQualifiedDomainName}:5432/aegis?sslmode=require'
    contentType: 'text/plain'
  }
}

output dnsLinkAnchor string = dnsLinkId
output serverName string = pg.name
output serverFqdn string = pg.properties.fullyQualifiedDomainName
output databaseUrlSecretUri string = dbUrl.properties.secretUri
