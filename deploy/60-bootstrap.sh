#!/usr/bin/env bash
# Register the demo project and its prod/dev environments, with you as admin. Runs inside the API container (private database).
source "$(dirname "$0")/lib.sh"; : "${RG:?}" "${SUB:?}"; load_me
APP="aegis-${ENV_NAME:-dev}-api"
run_in_app() { # needs a TTY; 'script' provides one when this runs non-interactively
  local cmd="$1"
  if [ -t 0 ]; then az containerapp exec -n "$APP" -g "$RG" --command "$cmd"
  elif command -v script >/dev/null 2>&1; then script -qec "az containerapp exec -n $APP -g $RG --command $(printf '%q' "$cmd")" /dev/null
  else die "no TTY and no 'script' command. Run this step from an interactive terminal"; fi
}
curl -s -m 60 -o /dev/null "https://$API_FQDN/healthz" || true   # wake the app
for pair in "prod:prod:${DEMO_RG_PROD:-rg-demo-prod}" "dev:dev:${DEMO_RG_DEV:-rg-demo-dev}"; do
  IFS=: read -r name kind rg <<<"$pair"
  log "bootstrapping environment $name -> $rg"
  OUT=$(run_in_app "node_modules/.bin/tsx apps/api/src/db/bootstrap.ts --project-key demo --project-name Demo --repo-url https://example.com/aegis --env-name $name --env-kind $kind --subscription-id $SUB --resource-group $rg --admin-oid $ME_OID" 2>&1) || true
  echo "$OUT" | grep -q "bootstrapped environment" && log "ok: $(echo "$OUT" | grep 'bootstrapped environment' | tr -d '\r')" || { echo "$OUT" | tail -8; die "bootstrap of $name failed (see above)"; }
done
log "step 60 complete"
