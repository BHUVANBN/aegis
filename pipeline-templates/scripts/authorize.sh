#!/usr/bin/env bash
# Asks the AEGIS gate to authorize deploying THIS artifact. The digest is recomputed from the file about to be deployed.
# Env: AEGIS_API_URL AEGIS_API_AUDIENCE ENVIRONMENT RUN_ID ASSESSMENT_ID
# Args: <compiled-template.json>
set -euo pipefail
source "$(dirname "$0")/common.sh"
: "${ASSESSMENT_ID:?}"; : "${ENVIRONMENT:?}"; : "${RUN_ID:?}"
DIGEST="$(artifact_digest "$1")"
BODY="$(mktemp)"
jq -n --arg a "$ASSESSMENT_ID" --arg d "$DIGEST" --arg e "$ENVIRONMENT" --arg r "$RUN_ID" '{assessmentId:$a, artifactDigest:$d, environment:$e, pipelineRunId:$r}' > "$BODY"
RESP="$(aegis_call POST /api/deployments/authorize "$BODY")"
rm -f "$BODY"
if [[ "$(http_status)" != 200 ]]; then
  echo "AEGIS gate DENIED deployment ($(http_status)):" >&2
  jq -r '.reasons[]? // .error.message' <<<"$RESP" >&2
  exit 1
fi
DEPLOYMENT_ID="$(jq -r .deploymentId <<<"$RESP")"
echo "AEGIS authorized deployment $DEPLOYMENT_ID (decision: $(jq -r .decision <<<"$RESP"))"
echo "##vso[task.setvariable variable=DEPLOYMENT_ID;isOutput=true]$DEPLOYMENT_ID"
