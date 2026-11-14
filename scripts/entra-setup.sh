#!/usr/bin/env bash
# Creates the Entra ID app registrations for AEGIS (API + SPA). Nested properties are set via Graph PATCH
# because `az ad app update --set api.x=...` fails on a new app whose `api` property is empty.
set -euo pipefail
API_NAME="${1:-aegis-api}"; WEB_NAME="${2:-aegis-web}"; SPA_URI="${3:-http://localhost:5173}"
TENANT="$(az account show --query tenantId -o tsv)"
guid() { python3 -c 'import uuid;print(uuid.uuid4())'; }
R_VIEWER=$(guid); R_ASSESSOR=$(guid); R_APPROVER=$(guid); R_ADMIN=$(guid); R_PIPE=$(guid); SCOPE_ID=$(guid)
ROLES=$(cat <<JSON
[
 {"allowedMemberTypes":["User"],"description":"Read assessments","displayName":"Viewer","id":"$R_VIEWER","isEnabled":true,"value":"viewer"},
 {"allowedMemberTypes":["User"],"description":"Submit assessments and request approvals","displayName":"Assessor","id":"$R_ASSESSOR","isEnabled":true,"value":"assessor"},
 {"allowedMemberTypes":["User"],"description":"Approve or reject changes","displayName":"Approver","id":"$R_APPROVER","isEnabled":true,"value":"approver"},
 {"allowedMemberTypes":["User"],"description":"Administer access and audit","displayName":"Administrator","id":"$R_ADMIN","isEnabled":true,"value":"admin"},
 {"allowedMemberTypes":["Application"],"description":"CI/CD pipeline identity","displayName":"Pipeline","id":"$R_PIPE","isEnabled":true,"value":"pipeline"}
]
JSON
)
graph_patch() { # $1 appId  $2 json body
  local f i; f=$(mktemp); printf '%s' "$2" > "$f"
  for i in 1 2 3 4 5 6; do
    if az rest --method PATCH --url "https://graph.microsoft.com/v1.0/applications(appId='$1')" \
         --headers "Content-Type=application/json" --body "@$f" >/dev/null 2>&1; then rm -f "$f"; return 0; fi
    sleep 5
  done
  az rest --method PATCH --url "https://graph.microsoft.com/v1.0/applications(appId='$1')" \
    --headers "Content-Type=application/json" --body "@$f" >/dev/null   # final attempt shows the real error
  rm -f "$f"
}
API_APPID=$(az ad app create --display-name "$API_NAME" --sign-in-audience AzureADMyOrg --app-roles "$ROLES" --query appId -o tsv)
API_BODY=$(cat <<JSON
{"identifierUris":["api://$API_APPID"],"api":{"requestedAccessTokenVersion":2,"oauth2PermissionScopes":[{"id":"$SCOPE_ID","adminConsentDescription":"Access AEGIS as the signed-in user","adminConsentDisplayName":"Access AEGIS","isEnabled":true,"type":"User","userConsentDescription":"Access AEGIS on your behalf","userConsentDisplayName":"Access AEGIS","value":"access_as_user"}]}}
JSON
)
graph_patch "$API_APPID" "$API_BODY"
az ad sp create --id "$API_APPID" >/dev/null
WEB_APPID=$(az ad app create --display-name "$WEB_NAME" --sign-in-audience AzureADMyOrg --query appId -o tsv)
graph_patch "$WEB_APPID" "{\"spa\":{\"redirectUris\":[\"$SPA_URI\"]}}"
graph_patch "$API_APPID" "{\"api\":{\"preAuthorizedApplications\":[{\"appId\":\"$WEB_APPID\",\"delegatedPermissionIds\":[\"$SCOPE_ID\"]}]}}"
cat <<OUT

Configuration values (these are identifiers, not secrets):
  ENTRA_TENANT_ID=$TENANT
  ENTRA_API_AUDIENCE=api://$API_APPID
  VITE_ENTRA_CLIENT_ID=$WEB_APPID
  VITE_ENTRA_TENANT_ID=$TENANT
  VITE_ENTRA_API_SCOPE=api://$API_APPID/access_as_user
  Pipeline app role id (for assignment to the pipeline service principal): $R_PIPE
OUT
