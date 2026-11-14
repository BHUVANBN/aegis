#!/usr/bin/env bash
# Submits the compiled ARM template digest + What-If JSON to AEGIS and waits for the assessment.
# Env: AEGIS_API_URL AEGIS_API_AUDIENCE PROJECT_KEY ENVIRONMENT COMMIT_SHA RUN_ID
# Args: <compiled-template.json> <whatif.json> <template-source-path> <output-dir>
set -euo pipefail
source "$(dirname "$0")/common.sh"
TEMPLATE="$1"; WHATIF="$2"; SOURCE_PATH="$3"; OUT="$4"
mkdir -p "$OUT"
DIGEST="$(artifact_digest "$TEMPLATE")"
echo "Artifact digest: $DIGEST"
BODY="$OUT/request.json"
jq -n --arg p "$PROJECT_KEY" --arg e "$ENVIRONMENT" --arg c "$COMMIT_SHA" --arg r "$RUN_ID" --arg d "$DIGEST" --arg t "$SOURCE_PATH" \
  --slurpfile w "$WHATIF" '{projectKey:$p, environment:$e, commitSha:$c, pipelineRunId:$r, artifactDigest:$d, templatePath:$t, whatIf:$w[0]}' > "$BODY"

RESP="$(aegis_call POST /api/assessments "$BODY")"
[[ "$(http_status)" == 200 || "$(http_status)" == 202 ]] || { echo "Assessment submission failed ($(http_status)): $RESP" >&2; exit 1; }
ID="$(jq -r .id <<<"$RESP")"
echo "Assessment id: $ID"

for _ in $(seq 1 60); do
  A="$(aegis_call GET "/api/assessments/$ID")"
  STATUS="$(jq -r .status <<<"$A")"
  [[ "$STATUS" == pending || "$STATUS" == running ]] || break
  sleep 2
done
echo "$A" | jq 'del(.whatif_raw)' > "$OUT/assessment.json"
DECISION="$(jq -r '.gate_decision // "block"' <<<"$A")"
echo "Status=$STATUS risk=$(jq -r .risk_level <<<"$A") score=$(jq -r .risk_score <<<"$A") confidence=$(jq -r .confidence <<<"$A") gate=$DECISION"
echo "##vso[task.setvariable variable=ASSESSMENT_ID;isOutput=true]$ID"
echo "##vso[task.setvariable variable=ARTIFACT_DIGEST;isOutput=true]$DIGEST"
echo "##vso[task.setvariable variable=GATE_DECISION;isOutput=true]$DECISION"
if [[ "$STATUS" == pending || "$STATUS" == running ]]; then echo "Assessment did not finish in time" >&2; exit 1; fi
