param location string
param namePrefix string
param tags object
param workspaceId string
@description('Entra object id of a human/group that may manage secrets. Optional; leave empty to rely on the deployment identity.')
param kvAdminObjectId string = ''

var kvName = take('${replace(namePrefix, '-', '')}kv${uniqueString(resourceGroup().id)}', 24)
// Built-in role definition ids (verify with: az role definition list --name "<role>" --query [].name -o tsv)
var kvSecretsUser = '4633458b-17de-408a-b874-0445c86b69e6'
var kvSecretsOfficer = 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: '${namePrefix}-id-api'
  location: location
  tags: tags
}

resource kv 'Microsoft.KeyVault/vaults@2025-05-01' = {
  name: kvName
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled'
    networkAcls: { defaultAction: 'Allow', bypass: 'AzureServices' }
  }
}

#disable-next-line use-recent-api-versions // 2021-05-01-preview is the version that supports log categories + workspace destination
resource kvDiag 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-law'
  scope: kv
  properties: {
    workspaceId: workspaceId
    logs: [ { category: 'AuditEvent', enabled: true } ]
  }
}

resource apiReadsSecrets 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kv.id, identity.id, kvSecretsUser)
  scope: kv
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsUser)
  }
}

resource officer 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(kvAdminObjectId)) {
  name: guid(kv.id, kvAdminObjectId, kvSecretsOfficer)
  scope: kv
  properties: {
    principalId: kvAdminObjectId
    principalType: 'User'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsOfficer)
  }
}

output identityId string = identity.id
output identityClientId string = identity.properties.clientId
output identityPrincipalId string = identity.properties.principalId
output keyVaultName string = kv.name
output keyVaultUri string = kv.properties.vaultUri
