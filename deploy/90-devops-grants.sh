#!/usr/bin/env bash
# After creating the two Azure DevOps service connections: give their identities the "pipeline" role and per-environment access in AEGIS.
# Usage: ./90-devops-grants.sh DEV_CONNECTION_APPID PROD_CONNECTION_APPID
# (find the app ids with: az ad app list --query "[?contains(displayName,'<your-devops-org>')].{name:displayName,appId:appId}" -o table)
source "$(dirname "$0")/lib.sh"; : "${API_FQDN:?run the main steps first}" "${API_APPID:?}"
[ $# -eq 2 ] || die "usage: $0 DEV_CONNECTION_APPID PROD_CONNECTION_APPID"
TOKEN=$(az account get-access-token --scope "api://$API_APPID/access_as_user" --query accessToken -o tsv)
API_SP=$(az ad sp show --id "$API_APPID" --query id -o tsv)
RID=$(az ad app show --id "$API_APPID" --query "appRoles[?value=='pipeline'].id | [0]" -o tsv)
for pair in "dev:$1" "prod:$2"; do
  envn=${pair%%:*}; app=${pair#*:}
  SP=$(az ad sp show --id "$app" --query id -o tsv) || die "no service principal for $app"
  az rest --method POST --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$API_SP/appRoleAssignedTo" --headers "Content-Type=application/json" \
    --body "{\"principalId\":\"$SP\",\"resourceId\":\"$API_SP\",\"appRoleId\":\"$RID\"}" -o none 2>/dev/null || warn "$envn: role already assigned or not permitted"
  code=$(curl -sS -m 60 -o /dev/null -w '%{http_code}' -X PUT -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"principalId\":\"$SP\",\"environment\":\"$envn\",\"role\":\"pipeline\"}" "https://$API_FQDN/api/admin/access")
  log "$envn: environment grant HTTP $code (204 = ok)"
done
