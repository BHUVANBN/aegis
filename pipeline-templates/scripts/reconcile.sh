#!/usr/bin/env bash
# Asks AEGIS to compare Azure's recorded changes for the environment against authorized deployment windows (detective control).
# Env: AEGIS_API_URL AEGIS_API_AUDIENCE ENVIRONMENT   Args: <output-dir>
set -euo pipefail
source "$(dirname "$0")/common.sh"
OUT="$1"; mkdir -p "$OUT"
ENVS="$(aegis_call GET /api/environments)"
[[ "$(http_status)" == 200 ]] || { echo "Could not list environments ($(http_status))" >&2; exit 1; }
ENV_ID="$(jq -r --arg e "$ENVIRONMENT" '.items[] | select(.name==$e) | .id' <<<"$ENVS" | head -n1)"
[[ -n "$ENV_ID" ]] || { echo "Environment $ENVIRONMENT not visible to this identity" >&2; exit 1; }
BODY="$(mktemp)"; echo '{"sinceHours":24}' > "$BODY"
RESP="$(aegis_call POST "/api/environments/$ENV_ID/reconcile" "$BODY")"; rm -f "$BODY"
[[ "$(http_status)" == 200 ]] || { echo "Reconciliation call failed ($(http_status)): $RESP" >&2; exit 1; }
echo "$RESP" > "$OUT/reconciliation.json"
STATUS="$(jq -r .status <<<"$RESP")"; N="$(jq '.findings | length' <<<"$RESP")"
echo "Reconciliation: status=$STATUS windows=$(jq .windowsChecked <<<"$RESP") changesSeen=$(jq .changesSeen <<<"$RESP") suspected=$N"
if [[ "$STATUS" != ok ]]; then
  echo "##vso[task.logissue type=warning]Reconciliation evidence unavailable ($(jq -r '.reason // "unknown"' <<<"$RESP")): this is NOT a clean result."
  echo "##vso[task.complete result=SucceededWithIssues;]"
elif [[ "$N" -gt 0 ]]; then
  jq -r '.findings[] | "  suspected out-of-band change: \(.at) \(.changeType) \(.resourceId) by \(.changedBy) via \(.clientType)"' <<<"$RESP"
  echo "##vso[task.logissue type=warning]$N change(s) outside authorized deployment windows: review (could be platform/manual changes or a pipeline bypass)."
  echo "##vso[task.complete result=SucceededWithIssues;]"
fi
