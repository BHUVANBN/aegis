#!/usr/bin/env bash
# Deletes everything this kit created (resource groups + the two Entra apps). Irreversible.
source "$(dirname "$0")/lib.sh"
echo "This deletes: ${RG:-rg-aegis}, ${DEMO_RG_DEV:-rg-demo-dev}, ${DEMO_RG_PROD:-rg-demo-prod}, and the Entra apps aegis-api / aegis-web."
read -rp "Type DELETE to continue: " a; [ "$a" = DELETE ] || { echo aborted; exit 1; }
for g in "${RG:-rg-aegis}" "${DEMO_RG_DEV:-rg-demo-dev}" "${DEMO_RG_PROD:-rg-demo-prod}"; do az group delete -n "$g" --yes --no-wait -o none 2>/dev/null && log "deleting $g" || warn "$g not found"; done
for n in aegis-api aegis-web; do for id in $(az ad app list --display-name "$n" --query "[].id" -o tsv); do az ad app delete --id "$id" && log "deleted app $n"; done; done
log "Key Vault names stay reserved for 7 days (purge protection). Local state: rm -rf deploy/.state"
