#!/usr/bin/env bash
# Application resources: PostgreSQL (private), registry, Container Apps environment + API (placeholder image), Static Web App.
source "$(dirname "$0")/lib.sh"
: "${RG:?run 10-infra.sh first}" "${API_APPID:?run 20-entra.sh first}"
[ -n "${PGADMIN:-}" ] || save PGADMIN "$(openssl rand -base64 24 | tr -d '/+=')"   # kept in .state (git-ignored) so redeploys reuse it
log "deploying application resources (5-15 minutes, mostly PostgreSQL)..."
deploy_app "mcr.microsoft.com/k8se/quickstart:latest" 80
log "registry=$ACR_NAME  api=https://$API_FQDN  web-app=$SWA_NAME"
