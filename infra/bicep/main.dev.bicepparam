using 'main.bicep'

param environmentName = 'dev'
param deployApp = false
// For deployApp=true pass secrets on the command line, never in this file:
//   --parameters postgresAdminPassword="$PGADMIN" entraApiAudience="api://<client-id>"
param logDailyQuotaGb = 1
