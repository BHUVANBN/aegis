#!/usr/bin/env bash
# Runs the whole rebuild, step by step. Usage: ./run-all.sh [--from STEP] [--only STEP] [--no-probe]
cd "$(dirname "$0")"
STEPS=(00-preflight 10-infra 20-entra 30-app-infra 40-image 50-app-release 60-bootstrap 70-web 80-verify)
FROM=""; ONLY=""; EXTRA=""
while [ $# -gt 0 ]; do case "$1" in --from) FROM="$2"; shift;; --only) ONLY="$2"; shift;; --no-probe) EXTRA="--no-probe";; *) echo "unknown option $1"; exit 2;; esac; shift; done
[ -f config.env ] || { echo "Create config.env first:  cp config.env.example config.env  and edit it"; exit 2; }
started=0; [ -z "$FROM" ] && started=1
for s in "${STEPS[@]}"; do
  [ -n "$ONLY" ] && [ "$s" != "$ONLY" ] && [[ "$s" != "${ONLY}"* ]] && continue
  [ "$started" = 0 ] && [[ "$s" == "$FROM"* ]] && started=1
  [ "$started" = 1 ] || continue
  printf '\n\033[1;32m=== %s ===\033[0m\n' "$s"
  if [ "$s" = 00-preflight ]; then bash "./$s.sh" $EXTRA; else bash "./$s.sh"; fi || { echo "Step $s failed. Fix the cause (see TROUBLESHOOTING.md), then: ./run-all.sh --from $s"; exit 1; }
done
printf '\n\033[1;32mAll requested steps finished.\033[0m\n'
