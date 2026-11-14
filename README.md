# AEGIS - Agentic Infrastructure Change Risk Detection

PERN application (React + TypeScript + Vite, Node + Express + TypeScript, PostgreSQL via `pg`) that assesses Azure
Bicep/ARM What-If output before deployment, scores risk deterministically, enforces an approval-bound deployment gate,
and verifies the result afterwards. See the single-file build manual (AEGIS-Build-Manual.txt) for full instructions,
honest validation status, Azure setup, pipeline setup, cost control and troubleshooting.

Quick start (local only, no Azure account): `bash scripts/local-setup.sh`, then `npm run dev:api` and
`VITE_AUTH_MODE=dev npm run dev:web`. Run every check: `bash scripts/run-all-checks.sh`.
