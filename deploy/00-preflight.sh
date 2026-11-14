#!/usr/bin/env bash
# Checks tools, login, permissions, providers, and picks a region that really works. Usage: 00-preflight.sh [--no-probe]
source "$(dirname "$0")/lib.sh"
PROBE=1; [ "${1:-}" = "--no-probe" ] && PROBE=0

log "1/6 tools"
need az "install Azure CLI"; need curl "install curl"; need node "install Node 22"
need npm "install npm"; need openssl "install openssl"; need python3 "install python3"
command -v jq >/dev/null 2>&1 || warn "jq not found: steps 80-verify and the sample assessments need it (sudo apt install jq)"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" = 22 ] || warn "Node $NODE_MAJOR found; this project was built and tested on Node 22 (nvm install 22)"
if docker info >/dev/null 2>&1; then save HAS_DOCKER 1; else save HAS_DOCKER 0; warn "Docker is not usable here; the image will be built with 'az acr build' (needs ACR Tasks)"; fi
curl -sI -m 8 https://registry.npmjs.org >/dev/null 2>&1 && log "npm registry reachable" || warn "npm registry NOT reachable: the web build needs npm packages"

log "2/6 login and subscription"
az account show >/dev/null 2>&1 || die "not logged in. Run: az login"
save SUB "$(az account show --query id -o tsv)"; save TENANT "$(az account show --query tenantId -o tsv)"
load_me; save ME_OID "$ME_OID"
log "subscription: $(az account show --query name -o tsv)"

log "3/6 your Azure roles (Owner, or Contributor + User Access Administrator, is needed)"
ROLES=$(az role assignment list --assignee "$ME_OID" --all --query "[].roleDefinitionName" -o tsv 2>/dev/null | sort -u | tr '\n' ',')
log "roles seen: ${ROLES:-none visible}"
echo "$ROLES" | grep -qE 'Owner|Contributor' || warn "no Owner/Contributor visible: deployments or role assignments may be refused"
POL=$(az policy assignment list --query "[].displayName" -o tsv 2>/dev/null | head -5 | tr '\n' ';')
[ -z "$POL" ] || warn "policy assignments exist (they may restrict regions/SKUs): $POL"

log "4/6 resource providers"
PROVS="Microsoft.App Microsoft.Maintenance Microsoft.ContainerRegistry Microsoft.DBforPostgreSQL Microsoft.KeyVault Microsoft.ManagedIdentity Microsoft.Network Microsoft.OperationalInsights Microsoft.Insights Microsoft.Web Microsoft.Storage Microsoft.Authorization Microsoft.ResourceGraph Microsoft.Consumption"
for p in $PROVS; do
  st=$(az provider show -n "$p" --query registrationState -o tsv 2>/dev/null || echo Unknown)
  [ "$st" = Registered ] || { log "registering $p (was $st)"; az provider register -n "$p" -o none 2>/dev/null || warn "cannot register $p"; }
done
for i in $(seq 1 40); do
  pending=""; for p in $PROVS; do [ "$(az provider show -n "$p" --query registrationState -o tsv 2>/dev/null)" = Registered ] || pending="$pending $p"; done
  [ -z "$pending" ] && break; log "waiting for:$pending"; sleep 15
done
[ -z "${pending:-}" ] || warn "still not registered:${pending}"

log "5/6 can this account create Entra app registrations?"
APPID_TEST=$(az ad app create --display-name aegis-preflight --query id -o tsv 2>/dev/null || true)
if [ -n "$APPID_TEST" ]; then save CAN_APPREG 1; az ad app delete --id "$APPID_TEST" 2>/dev/null || true; log "yes"
else save CAN_APPREG 0; warn "NO. Step 20 will stop and write ADMIN-REQUEST.md for someone with rights to fill in."; fi

log "6/6 region"
probe_pg() { # region: really try to create a B1ms server (costs cents), then delete it
  local r=$1 g="aegis-probe-$1-$$" ok=1
  az group create -n "$g" -l "$r" -o none 2>/dev/null || return 1
  az postgres flexible-server create -g "$g" -n "aegisprobe$RANDOM$RANDOM" -l "$r" --tier Burstable --sku-name Standard_B1ms \
    --version 16 --storage-size 32 --public-access None --admin-user pgadmin \
    --admin-password "$(openssl rand -base64 18 | tr -d '/+=')Aa1" --yes -o none 2>/dev/null && ok=0
  az group delete -n "$g" --yes --no-wait -o none 2>/dev/null || true
  return $ok
}
if [ "${FORCE_REGION:-0}" = 1 ] && [ -n "${LOCATION:-}" ]; then log "using forced region $LOCATION"; save LOCATION "$LOCATION"
else
  LOCATION=""
  # captured once into variables: "cmd | grep -q" under pipefail can fail spuriously (grep exits early, cmd gets SIGPIPE)
  MA_LOCS=$(az provider show -n Microsoft.App --query "resourceTypes[?resourceType=='managedEnvironments'].locations[]" -o tsv 2>/dev/null || true)
  for r in ${REGIONS:-southeastasia centralindia}; do
    dn=$(az account list-locations --query "[?name=='$r'].displayName | [0]" -o tsv 2>/dev/null)
    [ -n "$dn" ] || { warn "$r: not enabled for this subscription"; continue; }
    grep -qix "$dn" <<<"$MA_LOCS" || { warn "$r: Container Apps not offered"; continue; }
    SKUS=$(az postgres flexible-server list-skus -l "$r" --query "[].supportedServerEditions[].supportedServerSkus[].name" -o tsv 2>/dev/null || true)
    grep -qx Standard_B1ms <<<"$SKUS" || { warn "$r: PostgreSQL B1ms not listed"; continue; }
    if [ "$PROBE" = 1 ]; then log "probing a real PostgreSQL create in $r (a few minutes)..."; probe_pg "$r" || { warn "$r: PostgreSQL create refused (SKU/capacity/subscription)"; continue; }; fi
    save LOCATION "$r"; log "selected region: $r"; break
  done
  [ -n "$LOCATION" ] || die "no usable region. Try different REGIONS in config.env, or ask for quota. See TROUBLESHOOTING.md"
fi
[ -n "$(az account list-locations --query "[?name=='eastasia'].name | [0]" -o tsv 2>/dev/null)" ] || warn "East Asia is not enabled: the Static Web App location in infra/bicep/modules/compute.bicep (staticWebAppLocation) must be changed to an allowed one (centralus, eastus2, eastasia, westeurope, westus2)"
log "preflight complete. region=$LOCATION. Next: ./run-all.sh --from 10-infra"
