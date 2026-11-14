#!/usr/bin/env bash
# One command to run every local check (no Azure credentials needed). Requires PostgreSQL reachable via TEST_DATABASE_URL.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:e2e
VITE_AUTH_MODE=dev npm run build:web
bash scripts/validate-bicep.sh
bash -n scripts/*.sh pipeline-templates/scripts/*.sh
echo "ALL LOCAL CHECKS PASSED"
