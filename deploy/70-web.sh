#!/usr/bin/env bash
# Build the dashboard against this deployment and publish it to the Static Web App; register its login redirect.
source "$(dirname "$0")/lib.sh"; : "${SWA_NAME:?}" "${WEB_APPID:?}" "${API_APPID:?}" "${API_FQDN:?}"
cd "$REPO_ROOT"
[ -d node_modules ] || { log "npm ci (first run)"; npm ci --no-audit --no-fund; }
log "building the web app"
VITE_AUTH_MODE=entra VITE_ENTRA_CLIENT_ID="$WEB_APPID" VITE_ENTRA_TENANT_ID="$TENANT" \
VITE_ENTRA_API_SCOPE="api://$API_APPID/access_as_user" VITE_API_BASE="https://$API_FQDN" npm run build:web
TOKEN=$(az staticwebapp secrets list -n "$SWA_NAME" -g "$RG" --query properties.apiKey -o tsv)
log "publishing to the Static Web App (the deployment token is not printed or stored)"
npx --yes @azure/static-web-apps-cli deploy apps/web/dist --deployment-token "$TOKEN" --env production
HOST=$(az staticwebapp show -n "$SWA_NAME" -g "$RG" --query defaultHostname -o tsv); save SWA_HOST "$HOST"
log "allowing the dashboard address as a login redirect"
graph_patch_app "$WEB_APPID" "{\"spa\":{\"redirectUris\":[\"http://localhost:5173\",\"https://$HOST\"]}}" || warn "could not set the redirect URI; add https://$HOST to the aegis-web app (SPA platform) manually"
log "dashboard: https://$HOST   (sign in with the same account; use a private window if a login popup/loop appears)"
