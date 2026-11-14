param location string
param namePrefix string
param tags object
param workspaceName string
param identityId string
param identityPrincipalId string
param identityClientId string
param databaseUrlSecretUri string
param appInsightsConnectionString string
param entraTenantId string
param entraApiAudience string
@description('Image for the API. The default is a Microsoft quickstart placeholder until you push the AEGIS image.')
param apiImage string = 'mcr.microsoft.com/k8se/quickstart:latest'
param apiTargetPort int = 80
param corsOrigins string = 'http://localhost:5173'
@description('Subnet (/23) for a VNet-integrated Container Apps environment. Empty = platform-managed network.')
param infrastructureSubnetId string = ''
@description('Region for Static Web Apps (only a few regions are supported).')
@allowed([ 'westus2', 'centralus', 'eastus2', 'westeurope', 'eastasia' ])
param staticWebAppLocation string = 'eastasia'

var acrName = take('${replace(namePrefix, '-', '')}acr${uniqueString(resourceGroup().id)}', 50)
var acrPull = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource law 'Microsoft.OperationalInsights/workspaces@2025-02-01' existing = { name: workspaceName }

resource acr 'Microsoft.ContainerRegistry/registries@2025-04-01' = {
  name: acrName
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}

resource pull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, identityId, acrPull)
  scope: acr
  properties: {
    principalId: identityPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPull)
  }
}

resource env 'Microsoft.App/managedEnvironments@2025-01-01' = {
  name: '${namePrefix}-cae'
  location: location
  tags: tags
  properties: {
    vnetConfiguration: empty(infrastructureSubnetId) ? null : { infrastructureSubnetId: infrastructureSubnetId, internal: false }
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: law.properties.customerId
        sharedKey: law.listKeys().primarySharedKey
      }
    }
  }
}

resource swa 'Microsoft.Web/staticSites@2025-03-01' = {
  name: '${namePrefix}-web'
  location: staticWebAppLocation
  tags: tags
  sku: { name: 'Free', tier: 'Free' }
  properties: {}
}

resource api 'Microsoft.App/containerApps@2025-01-01' = {
  name: '${namePrefix}-api'
  location: location
  tags: tags
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identityId}': {} } }
  dependsOn: [ pull ]
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: true, targetPort: apiTargetPort, transport: 'auto', allowInsecure: false }
      registries: [ { server: acr.properties.loginServer, identity: identityId } ]
      secrets: [ { name: 'database-url', keyVaultUrl: databaseUrlSecretUri, identity: identityId } ]
    }
    template: {
      containers: [
        {
          name: 'api'
          image: apiImage
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PORT', value: string(apiTargetPort) }
            { name: 'AUTH_MODE', value: 'entra' }
            { name: 'ENTRA_TENANT_ID', value: entraTenantId }
            { name: 'ENTRA_API_AUDIENCE', value: entraApiAudience }
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'DATABASE_SSL', value: 'true' }
            { name: 'ARG_ENABLED', value: 'true' }
            { name: 'AZURE_CLIENT_ID', value: identityClientId }
            { name: 'CORS_ORIGINS', value: 'https://${swa.properties.defaultHostname},${corsOrigins}' }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsightsConnectionString }
          ]
          probes: [
            { type: 'Liveness', httpGet: { path: '/healthz', port: apiTargetPort }, periodSeconds: 30 }
            { type: 'Readiness', httpGet: { path: '/readyz', port: apiTargetPort }, periodSeconds: 15 }
          ]
        }
      ]
      scale: { minReplicas: 0, maxReplicas: 2, rules: [ { name: 'http', http: { metadata: { concurrentRequests: '30' } } } ] }
    }
  }
}

output acrName string = acr.name
output acrLoginServer string = acr.properties.loginServer
output apiFqdn string = api.properties.configuration.ingress.fqdn
output staticWebAppName string = swa.name
output staticWebAppHost string = swa.properties.defaultHostname
