#!/usr/bin/env bash
# Creates the AEGIS Azure Policy definition and assigns it to a resource group in Audit mode.
# Usage: scripts/policy-setup.sh <resource-group> [Audit|Deny]
set -euo pipefail
RG="$1"; EFFECT="${2:-Audit}"
cd "$(dirname "$0")/.."
F=infra/policies/deny-public-blob-access.policy.json
az policy definition create --name aegis-deny-public-blob --display-name "AEGIS - Deny public blob access" \
  --mode Indexed --rules "$(jq -c .properties.policyRule $F)" --params "$(jq -c .properties.parameters $F)"
SCOPE="$(az group show -n "$RG" --query id -o tsv)"
az policy assignment create --name aegis-public-blob --scope "$SCOPE" --policy aegis-deny-public-blob --params "{\"effect\":{\"value\":\"$EFFECT\"}}"
echo "Assigned in $EFFECT mode to $RG. Compliance can take ~30 minutes:  az policy state list -g $RG --query \"[?complianceState=='NonCompliant']\" -o table"
