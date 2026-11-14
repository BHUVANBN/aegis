targetScope = 'resourceGroup'

@description('Environment short name used in resource names.')
@allowed([ 'dev', 'prod' ])
param environmentName string = 'dev'
param location string = resourceGroup().location
@description('Deploys PostgreSQL, ACR, Container Apps and Static Web Apps. Leave false for the near-free baseline (monitoring, identity, Key Vault).')
param deployApp bool = false
@secure()
@description('Required when deployApp=true.')
param postgresAdminPassword string = ''
param entraTenantId string = subscription().tenantId
@description('Application ID URI of the AEGIS API app registration, e.g. api://<client-id>.')
param entraApiAudience string = ''
param apiImage string = 'mcr.microsoft.com/k8se/quickstart:latest'
param apiTargetPort int = 80
param kvAdminObjectId string = ''
@description('Private PostgreSQL (VNet integration, no public endpoint). Set false only to save a few cents/month; weaker security.')
param privateDatabase bool = true
@minValue(1)
param logDailyQuotaGb int = 1

var namePrefix = 'aegis-${environmentName}'
var tags = {
  app: 'aegis'
  environment: environmentName
  managedBy: 'bicep'
  costCentre: 'learning'
}

module observability 'modules/observability.bicep' = {
  name: 'observability'
  params: { location: location, namePrefix: namePrefix, tags: tags, dailyQuotaGb: logDailyQuotaGb }
}

module security 'modules/security.bicep' = {
  name: 'security'
  params: { location: location, namePrefix: namePrefix, tags: tags, workspaceId: observability.outputs.workspaceId, kvAdminObjectId: kvAdminObjectId }
}

module network 'modules/network.bicep' = if (deployApp && privateDatabase) {
  name: 'network'
  params: { location: location, namePrefix: namePrefix, tags: tags }
}

module data 'modules/data.bicep' = if (deployApp) {
  name: 'data'
  params: { location: location, namePrefix: namePrefix, tags: tags, keyVaultName: security.outputs.keyVaultName, administratorPassword: postgresAdminPassword, privateDatabase: privateDatabase, delegatedSubnetId: privateDatabase ? network!.outputs.postgresSubnetId : '', privateDnsZoneId: privateDatabase ? network!.outputs.privateDnsZoneId : '', dnsLinkId: privateDatabase ? network!.outputs.dnsLinkId : '' }
}

module compute 'modules/compute.bicep' = if (deployApp) {
  name: 'compute'
  params: {
    location: location
    namePrefix: namePrefix
    tags: tags
    workspaceName: observability.outputs.workspaceName
    identityId: security.outputs.identityId
    identityPrincipalId: security.outputs.identityPrincipalId
    identityClientId: security.outputs.identityClientId
    databaseUrlSecretUri: data!.outputs.databaseUrlSecretUri
    appInsightsConnectionString: observability.outputs.appInsightsConnectionString
    entraTenantId: entraTenantId
    entraApiAudience: entraApiAudience
    apiImage: apiImage
    apiTargetPort: apiTargetPort
    infrastructureSubnetId: privateDatabase ? network!.outputs.containerAppsSubnetId : ''
  }
}

output apiIdentityPrincipalId string = security.outputs.identityPrincipalId
output keyVaultName string = security.outputs.keyVaultName
output apiFqdn string = deployApp ? compute!.outputs.apiFqdn : ''
output acrName string = deployApp ? compute!.outputs.acrName : ''
output staticWebAppName string = deployApp ? compute!.outputs.staticWebAppName : ''
