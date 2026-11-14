#!/usr/bin/env bash
# Daily spend check + resource inventory. Usage: scripts/check-cost.sh [resource-group ...]
# Cost data lags by several hours; treat numbers as estimates and confirm in Cost Management > Cost analysis.
set -euo pipefail
START="$(date -u +%Y-%m-01)"; END="$(date -u +%Y-%m-%d)"
echo "== Subscription: $(az account show --query '[name,id]' -o tsv | tr '\t' ' ')"
echo "== Usage cost month-to-date ($START .. $END), by resource group"
az consumption usage list --start-date "$START" --end-date "$END" --query "[].{rg:resourceGroup, cost:pretaxCost}" -o json 2>/dev/null \
  | jq -r 'group_by(.rg)[] | "\(.[0].rg // "n/a")\t\(map(.cost|tonumber)|add)"' | sort -k2 -nr || echo "(consumption API unavailable for this subscription type: use the portal)"
for rg in "$@"; do echo "== Resources in $rg"; az resource list -g "$rg" --query "[].{name:name,type:type,sku:sku.name}" -o table; done
echo "== Reminder: budgets alert but do not stop spend. Stop PostgreSQL / delete the resource group when idle."
