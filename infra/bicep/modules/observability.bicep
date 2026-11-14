@description('Azure region.')
param location string
@description('Name prefix, e.g. aegis-dev.')
param namePrefix string
param tags object
@description('Daily ingestion cap in GB. Caps cost; data beyond the cap is dropped until the next day.')
@minValue(1)
param dailyQuotaGb int = 1
@description('Retention in days (30 is included free for Log Analytics).')
@minValue(30)
param retentionDays int = 30

resource law 'Microsoft.OperationalInsights/workspaces@2025-02-01' = {
  name: '${namePrefix}-law'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: retentionDays
    workspaceCapping: { dailyQuotaGb: dailyQuotaGb }
    features: { disableLocalAuth: false }
  }
}

resource appi 'Microsoft.Insights/components@2020-02-02' = {
  name: '${namePrefix}-appi'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: law.id
    IngestionMode: 'LogAnalytics'
    DisableIpMasking: false
  }
}

output workspaceId string = law.id
output workspaceName string = law.name
output appInsightsConnectionString string = appi.properties.ConnectionString
