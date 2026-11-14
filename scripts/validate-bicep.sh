#!/usr/bin/env bash
# Builds and lints every Bicep file. Treats errors AND warnings as failures (obsolete API versions show as warnings).
# Uses `az bicep` if az is installed, otherwise a standalone `bicep` binary on PATH.
set -euo pipefail
cd "$(dirname "$0")/.."
if command -v az >/dev/null 2>&1; then BICEP=(az bicep); BUILD=(build --stdout --file); else BICEP=(bicep); BUILD=(build --stdout); fi
fail=0
for f in infra/bicep/main.bicep infra/bicep/sub/subscription.bicep infra/sample-workload/main.bicep; do
  out="$("${BICEP[@]}" "${BUILD[@]}" "$f" 2>&1 >/dev/null || true)"
  if [[ -n "$out" ]]; then echo "FAIL $f"; echo "$out"; fail=1; else echo "OK   $f"; fi
done
exit $fail
