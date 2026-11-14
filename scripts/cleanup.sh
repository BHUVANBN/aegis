#!/usr/bin/env bash
# Deletes AEGIS resource groups. Irreversible. Usage: scripts/cleanup.sh rg-aegis-dev rg-demo-dev rg-demo-prod
set -euo pipefail
[[ $# -gt 0 ]] || { echo "usage: $0 <resource-group>..."; exit 2; }
for rg in "$@"; do
  az group exists -n "$rg" | grep -q true || { echo "skip $rg (not found)"; continue; }
  read -r -p "Delete resource group '$rg' and everything in it? type the name to confirm: " ans
  [[ "$ans" == "$rg" ]] && az group delete -n "$rg" --yes --no-wait && echo "deleting $rg (async)" || echo "skipped $rg"
done
echo "Key Vault has purge protection: its name stays reserved ~7 days after deletion (soft-delete retention). Use a different suffix if you redeploy."
echo "Verify:  az group list --query \"[?starts_with(name,'rg-')].name\" -o tsv"
