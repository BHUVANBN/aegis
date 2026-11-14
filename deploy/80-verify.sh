#!/usr/bin/env bash
# Health + identity check; with --samples also submits three sample assessments like the demo.
source "$(dirname "$0")/lib.sh"; : "${API_FQDN:?}" "${API_APPID:?}"
command -v jq >/dev/null 2>&1 || die "jq is required for this step (sudo apt install jq)"
API="https://$API_FQDN"
wait_http "$API/healthz" 20 || die "healthz failed"; log "healthz ok"; curl -s -m 30 "$API/readyz"; echo
TOKEN=$(az account get-access-token --scope "api://$API_APPID/access_as_user" --query accessToken -o tsv 2>/dev/null) || die "cannot get a token (AADSTS65001/consent? see TROUBLESHOOTING.md)"
log "identity seen by the API:"; curl -sS -m 60 -H "Authorization: Bearer $TOKEN" "$API/api/me" | jq '{name,tokenRoles,grants}'
[ "${1:-}" = "--samples" ] || { log "done. Run with --samples to create three demo assessments."; exit 0; }
cd "$REPO_ROOT"; RUN="demo-$(date +%s)"
submit() { # fixture env tag -> assessment id
  local d="sha256:$(printf '%s' "$RUN-$3" | sha256sum | cut -d' ' -f1)"
  jq -n --arg p demo --arg e "$2" --arg r "$RUN-$3" --arg d "$d" --slurpfile w "tests/fixtures/$1" \
    '{projectKey:$p,environment:$e,commitSha:"abcdef1",pipelineRunId:$r,artifactDigest:$d,templatePath:"main.bicep",whatIf:$w[0]}' \
  | curl -sS -m 60 -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data @- "$API/api/assessments" | jq -r .id
}
C=$(submit whatif-nsg-https-removed.json prod crit); M=$(submit whatif-vm-resize.json prod med); L=$(submit whatif-tag-only.json dev low)
sleep 20
for id in $C $M $L; do curl -sS -m 60 -H "Authorization: Bearer $TOKEN" "$API/api/assessments/$id" | jq -c '{risk_level,gate_decision,status}'; done
log "expected: critical/block, medium/require_approval, low/allow (when evidence is complete)"
