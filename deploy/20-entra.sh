#!/usr/bin/env bash
# Entra app registrations (aegis-api with roles + scope, aegis-web SPA), your roles, CLI pre-authorization.
source "$(dirname "$0")/lib.sh"; load_me
if [ "${ENTRA_PROVIDED:-0}" = 1 ]; then
  : "${API_APPID:?set API_APPID in config.env}" "${WEB_APPID:?set WEB_APPID in config.env}"; log "using app registrations provided by an admin"
elif [ "${CAN_APPREG:-0}" != 1 ]; then
  die "this account cannot create app registrations. Give deploy/ADMIN-REQUEST.md to someone who can, then set ENTRA_PROVIDED=1, API_APPID and WEB_APPID in config.env and rerun: ./run-all.sh --from 20-entra"
else
  A=$(az ad app list --display-name aegis-api --query "[0].appId" -o tsv); W=$(az ad app list --display-name aegis-web --query "[0].appId" -o tsv)
  if [ -n "$A" ] && [ -n "$W" ]; then log "reusing existing aegis-api / aegis-web"; API_APPID=$A; WEB_APPID=$W
  else
    [ -z "$A$W" ] || die "only one of aegis-api / aegis-web exists. Delete it (az ad app delete --id ...) and rerun"
    log "creating app registrations"
    OUT=$(bash "$REPO_ROOT/scripts/entra-setup.sh" aegis-api aegis-web http://localhost:5173)
    echo "$OUT"
    API_APPID=$(echo "$OUT" | sed -n 's/^ *ENTRA_API_AUDIENCE=api:\/\///p' | head -1)
    WEB_APPID=$(echo "$OUT" | sed -n 's/^ *VITE_ENTRA_CLIENT_ID=//p' | head -1)
  fi
fi
[ -n "$API_APPID" ] && [ -n "$WEB_APPID" ] || die "could not determine the app ids"
save API_APPID "$API_APPID"; save WEB_APPID "$WEB_APPID"
API_SP=$(az ad sp show --id "$API_APPID" --query id -o tsv)
log "assigning API roles to you (admin, assessor, approver, viewer)"
for role in admin assessor approver viewer; do
  RID=$(az ad app show --id "$API_APPID" --query "appRoles[?value=='$role'].id | [0]" -o tsv)
  az rest --method POST --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$API_SP/appRoleAssignedTo" \
    --headers "Content-Type=application/json" \
    --body "{\"principalId\":\"$ME_OID\",\"resourceId\":\"$API_SP\",\"appRoleId\":\"$RID\"}" -o none 2>/dev/null || warn "role $role: not assigned (already assigned, or no rights)"
done
log "pre-authorizing the web app and Azure CLI for the API scope"
SCOPE_ID=$(az ad app show --id "$API_APPID" --query "api.oauth2PermissionScopes[?value=='access_as_user'].id | [0]" -o tsv)
CLI=04b07795-8ddb-461a-bbee-02f9e1bf7b46
graph_patch_app "$API_APPID" "{\"api\":{\"preAuthorizedApplications\":[{\"appId\":\"$WEB_APPID\",\"delegatedPermissionIds\":[\"$SCOPE_ID\"]},{\"appId\":\"$CLI\",\"delegatedPermissionIds\":[\"$SCOPE_ID\"]}]}}" || warn "pre-authorization failed"
log "step 20 complete (tenant=$TENANT api=$API_APPID web=$WEB_APPID)"
