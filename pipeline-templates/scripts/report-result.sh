#!/usr/bin/env bash
# Reports the deployment outcome to AEGIS. Args: <succeeded|failed> <deployment-id> [azure-deployment-name]
set -euo pipefail
source "$(dirname "$0")/common.sh"
STATUS="$1"; ID="$2"; NAME="${3:-}"
BODY="$(mktemp)"
jq -n --arg s "$STATUS" --arg n "$NAME" '{status:$s} + (if $n != "" then {azureDeploymentName:$n} else {} end)' > "$BODY"
aegis_call POST "/api/deployments/$ID/result" "$BODY" >/dev/null
rm -f "$BODY"
[[ "$(http_status)" == 200 ]] || { echo "Could not record deployment result ($(http_status))" >&2; exit 1; }
