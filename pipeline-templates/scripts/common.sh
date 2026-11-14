#!/usr/bin/env bash
# Shared helpers for pipeline scripts. Requires: az, curl, jq, sha256sum.
set -euo pipefail

: "${AEGIS_API_URL:?AEGIS_API_URL is required}"
: "${AEGIS_API_AUDIENCE:?AEGIS_API_AUDIENCE is required (api://<client-id>)}"

# HTTP status lives in a file: callers run aegis_call inside $(...), a subshell that would discard a plain variable.
AEGIS_STATUS_FILE="$(mktemp)"; echo 000 > "$AEGIS_STATUS_FILE"
http_status() { cat "$AEGIS_STATUS_FILE"; }

# Entra token for the pipeline's service principal (workload identity federation; no stored secret).
aegis_token() {
  az account get-access-token --resource "$AEGIS_API_AUDIENCE" --query accessToken -o tsv
}

# Calls the AEGIS API. Prints body; sets HTTP_STATUS. Never prints the token.
aegis_call() { # method path [json-file]
  local method="$1" path="$2" data="${3:-}" out
  out="$(mktemp)"
  local args=(-sS -o "$out" -w '%{http_code}' -X "$method" -H "Authorization: Bearer $(aegis_token)" -H 'Content-Type: application/json' --max-time 60)
  [[ -n "$data" ]] && args+=(--data-binary "@$data")
  curl "${args[@]}" "${AEGIS_API_URL%/}$path" > "$AEGIS_STATUS_FILE"
  cat "$out"; rm -f "$out"
}

artifact_digest() { printf 'sha256:%s' "$(sha256sum "$1" | cut -d' ' -f1)"; }
