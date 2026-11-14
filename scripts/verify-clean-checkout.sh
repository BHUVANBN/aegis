#!/usr/bin/env bash
# Proves the repository is reproducible: copies tracked files to a temp dir (no node_modules, no build output), installs from the
# committed lockfile with `npm ci`, and runs the full local check suite there. Needs PostgreSQL at TEST_DATABASE_URL.
set -euo pipefail
cd "$(dirname "$0")/.."
git add -A >/dev/null
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
git ls-files -z | xargs -0 -I{} cp --parents {} "$TMP"
cd "$TMP"
echo "== files: $(git -C "$OLDPWD" ls-files | wc -l); node: $(node -v)"
test -f package-lock.json || { echo "package-lock.json missing"; exit 1; }
npm ci --no-audit --no-fund
echo "== lockfile consistent: npm ci succeeded"
bash scripts/run-all-checks.sh
