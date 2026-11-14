#!/usr/bin/env bash
# End-to-end smoke test against a RUNNING AEGIS API (local or deployed). Exercises the scenarios a reviewer should see:
# critical (blocked), medium (approval), approval rules (self-approval, wrong digest, replay), tag-only (low), reconciliation, audit chain.
#
# Local (dev auth):   API_URL=http://localhost:8080 bash scripts/smoke-test.sh
# Deployed (Entra):   API_URL=https://<fqdn> ALICE_TOKEN=... BOB_TOKEN=... PIPE_TOKEN=... CAROL_TOKEN=... PROJECT=demo PROD_ENV=prod DEV_ENV=dev \
#                     EVIDENCE=complete bash scripts/smoke-test.sh      (tokens: "Bearer <jwt>"; BOB needs approver, PIPE needs pipeline,
#                     ALICE needs assessor, CAROL admin; all with environment grants; ALICE and BOB must be different people)
# EVIDENCE=partial (default for local runs without Resource Graph) or complete (Resource Graph reachable).
set -uo pipefail
cd "$(dirname "$0")/.."
API_URL="${API_URL:-http://localhost:8080}"
PROJECT="${PROJECT:-demo}"; PROD_ENV="${PROD_ENV:-prod}"; DEV_ENV="${DEV_ENV:-dev}"; EVIDENCE="${EVIDENCE:-partial}"
ALICE_TOKEN="${ALICE_TOKEN:-Bearer dev:alice@example.test:assessor,viewer}"
BOB_TOKEN="${BOB_TOKEN:-Bearer dev:bob@example.test:approver,viewer}"
CAROL_TOKEN="${CAROL_TOKEN:-Bearer dev:carol@example.test:admin,viewer}"
PIPE_TOKEN="${PIPE_TOKEN:-Bearer dev:pipeline@example.test:pipeline}"
FIX=tests/fixtures
RUN="smoke-$(date +%s)"
pass=0; fail=0
ok()  { echo "PASS  $1"; pass=$((pass+1)); }
bad() { echo "FAIL  $1  -> $2"; fail=$((fail+1)); }
expect() { [[ "$2" == "$3" ]] && ok "$1" || bad "$1" "expected '$3' got '$2'"; }
call() { # token method path [json]  -> body in $BODY, code in $CODE
  local tmp; tmp="$(mktemp)"
  if [[ -n "${4:-}" ]]; then CODE="$(curl -sS -o "$tmp" -w '%{http_code}' -X "$2" -H "Authorization: $1" -H 'Content-Type: application/json' --data "$4" "$API_URL$3")"
  else CODE="$(curl -sS -o "$tmp" -w '%{http_code}' -X "$2" -H "Authorization: $1" "$API_URL$3")"; fi
  BODY="$(cat "$tmp")"; rm -f "$tmp"
}
digest() { printf 'sha256:%s' "$(printf '%s' "$1" | sha256sum | cut -d' ' -f1)"; }
submit() { # fixture env tag -> prints "<assessment id> <artifact digest>"
  DIGEST="$(digest "$RUN-$3")"
  local req; req="$(jq -n --arg p "$PROJECT" --arg e "$2" --arg r "$RUN-$3" --arg d "$DIGEST" --slurpfile w "$FIX/$1" '{projectKey:$p,environment:$e,commitSha:"abcdef1",pipelineRunId:$r,artifactDigest:$d,templatePath:"main.bicep",whatIf:$w[0]}')"
  call "$ALICE_TOKEN" POST /api/assessments "$req"
  local id; id="$(jq -r .id <<<"$BODY")"
  for _ in $(seq 1 40); do call "$ALICE_TOKEN" GET "/api/assessments/$id"; [[ "$(jq -r .status <<<"$BODY")" =~ ^(pending|running)$ ]] || break; sleep 0.5; done
  echo "$id $DIGEST"
}

for tool in curl jq sha256sum; do command -v "$tool" >/dev/null || { echo "Missing prerequisite: $tool" >&2; exit 2; }; done
for _ in $(seq 1 40); do [[ "$(curl -s -o /dev/null -w '%{http_code}' "$API_URL/healthz" || true)" == 200 ]] && break; sleep 1; done
[[ "$(curl -s -o /dev/null -w '%{http_code}' "$API_URL/healthz" || true)" == 200 ]] || { echo "API not reachable at $API_URL" >&2; exit 2; }
call "" GET /healthz; expect "health endpoint" "$CODE" 200
call "" GET /api/me; expect "unauthenticated request rejected" "$CODE" 401
call "$ALICE_TOKEN" GET /api/me; expect "authenticated identity resolves" "$CODE" 200

# 1. CRITICAL: remove public HTTPS rule from production NSG -> blocked, cannot be approved
read -r ID DIGEST <<<"$(submit whatif-nsg-https-removed.json "$PROD_ENV" crit)"
call "$ALICE_TOKEN" GET "/api/assessments/$ID"
expect "critical: risk level" "$(jq -r .risk_level <<<"$BODY")" critical
expect "critical: gate decision" "$(jq -r .gate_decision <<<"$BODY")" block
call "$ALICE_TOKEN" POST "/api/assessments/$ID/approval-requests" '{"justification":"please let this through, it is urgent"}'
expect "critical: approval request refused" "$CODE" 409
call "$PIPE_TOKEN" POST /api/deployments/authorize "$(jq -n --arg a "$ID" --arg d "$DIGEST" --arg e "$PROD_ENV" '{assessmentId:$a,artifactDigest:$d,environment:$e,pipelineRunId:"x"}')"
expect "critical: deployment authorization denied" "$CODE" 403
call "$ALICE_TOKEN" GET "/api/assessments/$ID/review-brief"
expect "critical: reviewer brief says not approvable" "$(jq -r .brief.requiredApproverRole <<<"$BODY")" not-approvable
call "$ALICE_TOKEN" GET "/api/assessments/$ID/hypotheses"
expect "critical: reasoning agent produced hypotheses" "$([[ "$(jq '.items|length' <<<"$BODY")" -ge 1 ]] && echo yes || echo no)" yes

# 2. MEDIUM in prod: VM resize -> approval required; approval rules
read -r ID DIGEST <<<"$(submit whatif-vm-resize.json "$PROD_ENV" med)"; MD="$DIGEST"
call "$ALICE_TOKEN" GET "/api/assessments/$ID"
expect "medium: gate decision" "$(jq -r .gate_decision <<<"$BODY")" require_approval
auth() { call "$PIPE_TOKEN" POST /api/deployments/authorize "$(jq -n --arg a "$ID" --arg d "$1" --arg e "$PROD_ENV" '{assessmentId:$a,artifactDigest:$d,environment:$e,pipelineRunId:"deploy"}')"; }
auth "$MD"; expect "medium: authorization denied without approval" "$CODE" 403
call "$ALICE_TOKEN" POST "/api/assessments/$ID/approval-requests" '{"justification":"Resize needed for the scheduled load test"}'
expect "medium: approval requested" "$CODE" 201; AR="$(jq -r .id <<<"$BODY")"
call "$ALICE_TOKEN" POST "/api/approval-requests/$AR/decision" '{"decision":"approve","comment":"self approval attempt"}'
expect "approval: non-approver cannot approve" "$CODE" 403
call "$BOB_TOKEN" POST "/api/approval-requests/$AR/decision" '{"decision":"approve","comment":"Reviewed evidence and window"}'
expect "approval: approver approves" "$CODE" 200
auth "$(digest tampered-artifact)"; expect "approval: different artifact digest denied" "$CODE" 403
call "$ALICE_TOKEN" POST /api/deployments/authorize "$(jq -n --arg a "$ID" --arg d "$MD" --arg e "$PROD_ENV" '{assessmentId:$a,artifactDigest:$d,environment:$e,pipelineRunId:"x"}')"
expect "authorize: human (non-pipeline) token denied" "$CODE" 403
auth "$MD"; expect "approval: exact artifact authorized" "$CODE" 200; DEP="$(jq -r .deploymentId <<<"$BODY")"
auth "$MD"; expect "approval: replay denied" "$CODE" 403
call "$PIPE_TOKEN" POST "/api/deployments/$DEP/result" '{"status":"succeeded","azureDeploymentName":"smoke"}'; expect "deployment result recorded" "$CODE" 200
call "$PIPE_TOKEN" POST "/api/deployments/$DEP/verification" '{}'
expect "verification recorded (status: $(jq -r .status <<<"$BODY"))" "$CODE" 201
[[ "$(jq -r .status <<<"$BODY")" == passed ]] && echo "INFO  verification passed against live Azure state" || echo "INFO  verification status is $(jq -r .status <<<"$BODY") (expected inconclusive without Resource Graph, or failed/partial because the fixture resources do not exist in Azure)"

# 3. LOW: tag-only change in dev
read -r ID DIGEST <<<"$(submit whatif-tag-only.json "$DEV_ENV" low)"
call "$ALICE_TOKEN" GET "/api/assessments/$ID"
expect "low: risk level" "$(jq -r .risk_level <<<"$BODY")" low
if [[ "$EVIDENCE" == complete ]]; then expect "low: allowed when evidence is complete" "$(jq -r .gate_decision <<<"$BODY")" allow
else expect "low: NOT auto-allowed when evidence is missing" "$(jq -r .gate_decision <<<"$BODY")" require_approval; fi

# 4. oversight
call "$ALICE_TOKEN" GET /api/audit; expect "audit log hidden from non-admin" "$CODE" 403
call "$CAROL_TOKEN" GET /api/audit/verify
expect "audit hash chain verifies" "$(jq -r .ok <<<"$BODY")" true
ENVID="$(call "$BOB_TOKEN" GET /api/environments; jq -r --arg e "$PROD_ENV" '.items[]|select(.name==$e)|.id' <<<"$BODY" | head -1)"
call "$BOB_TOKEN" POST "/api/environments/$ENVID/reconcile" '{"sinceHours":24}'
expect "reconciliation endpoint responds (status: $(jq -r .status <<<"$BODY"))" "$CODE" 200
call "$BOB_TOKEN" GET /api/learning/summary; expect "learning summary available to approver" "$CODE" 200

echo; echo "RESULT: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
