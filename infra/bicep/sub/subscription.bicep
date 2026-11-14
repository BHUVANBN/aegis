targetScope = 'subscription'

@description('principalId of the AEGIS API managed identity (output apiIdentityPrincipalId of main.bicep).')
param apiIdentityPrincipalId string
@description('Email addresses for budget alerts.')
param budgetContactEmails array
@minValue(1)
param budgetAmountUsd int = 150
@description('First day of the current month, e.g. 2026-10-01. Budgets must start on the first of a month.')
param budgetStartDate string

var reader = 'acdd72a7-3385-48ef-bd42-f606fba81ae7'

// Least privilege for Resource Graph / Policy state reads: Reader only. AEGIS never gets write access.
resource apiReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(subscription().id, apiIdentityPrincipalId, reader)
  properties: {
    principalId: apiIdentityPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', reader)
  }
}

// A budget ALERTS; it does not stop spending.
#disable-next-line use-recent-api-versions // 2023-05-01 is the stable budgets schema used in Microsoft samples
resource budget 'Microsoft.Consumption/budgets@2023-05-01' = {
  name: 'aegis-credit-guard'
  properties: {
    category: 'Cost'
    amount: budgetAmountUsd
    timeGrain: 'Monthly'
    timePeriod: { startDate: budgetStartDate }
    notifications: {
      actual50: { enabled: true, operator: 'GreaterThan', threshold: 50, contactEmails: budgetContactEmails, thresholdType: 'Actual' }
      actual80: { enabled: true, operator: 'GreaterThan', threshold: 80, contactEmails: budgetContactEmails, thresholdType: 'Actual' }
      forecast100: { enabled: true, operator: 'GreaterThan', threshold: 100, contactEmails: budgetContactEmails, thresholdType: 'Forecasted' }
    }
  }
}
