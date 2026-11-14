#!/usr/bin/env bash
# Local-only development: PostgreSQL in Docker, migrations, seed. No Azure account needed.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .env ]] || cp .env.example .env
docker compose up -d db
until docker compose exec -T db pg_isready -U aegis -d aegis >/dev/null 2>&1; do sleep 1; done
docker compose exec -T db psql -U aegis -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='aegis_test'" | grep -q 1 || docker compose exec -T db psql -U aegis -d postgres -c "CREATE DATABASE aegis_test"
npm ci
export DATABASE_URL=postgres://aegis:aegis_dev_pw@localhost:5432/aegis
npm run migrate -w @aegis/api
npm run seed -w @aegis/api
echo "Ready. Start the API: npm run dev:api   Start the web UI: VITE_AUTH_MODE=dev npm run dev:web"
