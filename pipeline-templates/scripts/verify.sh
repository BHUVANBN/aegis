#!/usr/bin/env bash
# Runs post-deployment verification. Fails on "failed"; warns on "inconclusive" / "partially_verified".
# Args: <deployment-id> <output-dir>
set -euo pipefail
source "$(dirname "$0")/common.sh"
ID="$1"; OUT="$2"; mkdir -p "$OUT"
sleep "${VERIFY_DELAY_SECONDS:-120}" # Resource Graph lags Azure state slightly
RESP="$(aegis_call POST "/api/deployments/$ID/verification" /dev/null)"
[[ "$(http_status)" == 201 ]] || { echo "Verification call failed ($(http_status)): $RESP" >&2; exit 1; }
echo "$RESP" > "$OUT/verification.json"
STATUS="$(jq -r .status <<<"$RESP")"
echo "Verification: $STATUS"
jq -r '.limitations[]' <<<"$RESP" | sed 's/^/  limitation: /'
case "$STATUS" in
  passed) ;;
  failed) jq -r '.discrepancies[] | "  DISCREPANCY: \(.name) \(.note // "")"' <<<"$RESP" >&2; exit 1 ;;
  *) echo "##vso[task.logissue type=warning]Post-deployment verification is $STATUS - review the evidence in AEGIS."
     echo "##vso[task.complete result=SucceededWithIssues;]" ;;
esac
