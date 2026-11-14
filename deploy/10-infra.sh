#!/usr/bin/env bash
# Resource groups, baseline (monitoring, Key Vault, identity), subscription-level Reader + budget alert.
source "$(dirname "$0")/lib.sh"
: "${LOCATION:?run 00-preflight.sh first}"; load_me
RG="${RG_NAME:-rg-aegis}"; save RG "$RG"; ENVN="${ENV_NAME:-dev}"
DEMO_LOC="${DEMO_LOCATION:-$LOCATION}"
log "resource groups ($RG in $LOCATION; demo groups in $DEMO_LOC)"
az group create -n "$RG" -l "$LOCATION" --tags app=aegis environment="$ENVN" -o none
for g in "${DEMO_RG_DEV:-rg-demo-dev}" "${DEMO_RG_PROD:-rg-demo-prod}"; do az group create -n "$g" -l "$DEMO_LOC" --tags app=aegis-demo -o none; done
log "baseline deployment (deployApp=false)"
az deployment group create -g "$RG" -n aegis-baseline -f "$REPO_ROOT/infra/bicep/main.bicep" \
  -p "$REPO_ROOT/infra/bicep/main.dev.bicepparam" -p environmentName="$ENVN" -o none
save API_PRINCIPAL "$(az deployment group show -g "$RG" -n aegis-baseline --query properties.outputs.apiIdentityPrincipalId.value -o tsv)"
save KV_NAME "$(az deployment group show -g "$RG" -n aegis-baseline --query properties.outputs.keyVaultName.value -o tsv)"
log "subscription level: Reader for the API identity + budget alert (alerts only, does not stop spending)"
if az deployment sub create -l "$LOCATION" -n aegis-sub -f "$REPO_ROOT/infra/bicep/sub/subscription.bicep" \
     -p apiIdentityPrincipalId="$API_PRINCIPAL" budgetContactEmails="[\"${ADMIN_EMAIL:?set ADMIN_EMAIL in config.env}\"]" \
        budgetStartDate="$(date +%Y-%m-01)" budgetAmountUsd="${BUDGET_USD:-150}" -o none; then log "done"
else warn "subscription-level deployment failed (needs Owner at subscription scope). Without Reader, Resource Graph checks will report 'unavailable'. Ask for the role or skip."; fi
log "step 10 complete"
