#!/usr/bin/env bash
# Point the Container App at the real image (port 8080) and wait until it is healthy.
source "$(dirname "$0")/lib.sh"; : "${IMAGE_TAG:?run 40-image.sh first}"
deploy_app "$ACR_NAME.azurecr.io/aegis-api:$IMAGE_TAG" 8080
log "waiting for https://$API_FQDN/readyz (the app wakes from zero; first call can take a minute)"
wait_http "https://$API_FQDN/readyz" 30 || die "API not ready. Check: az containerapp logs show -n aegis-${ENV_NAME:-dev}-api -g $RG --tail 50  (see TROUBLESHOOTING.md)"
curl -s -m 30 "https://$API_FQDN/readyz"; echo
