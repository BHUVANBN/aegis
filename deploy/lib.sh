#!/usr/bin/env bash
# Shared helpers. Sourced by every step. Never run directly.
set -euo pipefail
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DEPLOY_DIR/.." && pwd)"
STATE_DIR="$DEPLOY_DIR/.state"; STATE_FILE="$STATE_DIR/state.env"
mkdir -p "$STATE_DIR"; chmod 700 "$STATE_DIR"; touch "$STATE_FILE"; chmod 600 "$STATE_FILE"
# shellcheck disable=SC1091
[ -f "$DEPLOY_DIR/config.env" ] && source "$DEPLOY_DIR/config.env"
# shellcheck disable=SC1090
source "$STATE_FILE"

log()  { printf '\033[1;34m[aegis]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m  %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[fail]\033[0m  %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing tool: $1  ($2)"; }

# save KEY VALUE : persist to .state/state.env (local only, git-ignored) and set the variable now
save() {
  { grep -v "^$1=" "$STATE_FILE" || true; } > "$STATE_FILE.tmp"
  printf '%s=%q\n' "$1" "$2" >> "$STATE_FILE.tmp"
  mv "$STATE_FILE.tmp" "$STATE_FILE"; chmod 600 "$STATE_FILE"
  eval "$1=\$2"
}
signed_in_oid() { az ad signed-in-user show --query id -o tsv 2>/dev/null || true; }
load_me() { ME_OID="${ADMIN_OID:-${ME_OID:-}}"; [ -n "$ME_OID" ] || ME_OID="$(signed_in_oid)"; [ -n "$ME_OID" ] || die "cannot read your user id. Set ADMIN_OID in config.env"; }

# wait_http URL [tries] : poll until HTTP 200 (the API scales to zero, so the first call can be slow)
wait_http() {
  local url=$1 tries=${2:-30} i code
  for i in $(seq 1 "$tries"); do
    code=$(curl -s -m 30 -o /dev/null -w '%{http_code}' "$url" || true)
    [ "$code" = 200 ] && return 0
    sleep 10
  done
  return 1
}
# graph_patch_app APPID JSON : PATCH an app registration (retries for Entra replication delay)
graph_patch_app() {
  local f i; f=$(mktemp); printf '%s' "$2" > "$f"
  for i in 1 2 3 4 5 6; do
    if az rest --method PATCH --url "https://graph.microsoft.com/v1.0/applications(appId='$1')" \
         --headers "Content-Type=application/json" --body "@$f" -o none 2>/dev/null; then rm -f "$f"; return 0; fi
    sleep 5
  done
  az rest --method PATCH --url "https://graph.microsoft.com/v1.0/applications(appId='$1')" \
    --headers "Content-Type=application/json" --body "@$f" -o none; local rc=$?; rm -f "$f"; return $rc
}
# deploy_app IMAGE PORT : the application deployment profile (deployApp=true)
deploy_app() {
  : "${RG:?}" "${API_APPID:?}" "${PGADMIN:?}"
  load_me
  az deployment group create -g "$RG" -n aegis-app -f "$REPO_ROOT/infra/bicep/main.bicep" \
    -p "$REPO_ROOT/infra/bicep/main.dev.bicepparam" \
    -p environmentName="${ENV_NAME:-dev}" deployApp=true postgresAdminPassword="$PGADMIN" \
       entraApiAudience="api://$API_APPID" kvAdminObjectId="$ME_OID" apiImage="$1" apiTargetPort="$2" -o none
  save ACR_NAME "$(az deployment group show -g "$RG" -n aegis-app --query properties.outputs.acrName.value -o tsv)"
  save API_FQDN "$(az deployment group show -g "$RG" -n aegis-app --query properties.outputs.apiFqdn.value -o tsv)"
  save SWA_NAME "$(az deployment group show -g "$RG" -n aegis-app --query properties.outputs.staticWebAppName.value -o tsv)"
  save KV_NAME  "$(az deployment group show -g "$RG" -n aegis-app --query properties.outputs.keyVaultName.value -o tsv)"
}
