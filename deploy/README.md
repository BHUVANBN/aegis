# AEGIS deployment kit: rebuild the whole system in a new Azure account

Put this `deploy/` folder at the root of the AEGIS repo (the repo already contains every fix from the original build).
It repeats, by script, the manual steps we did the first time. **Written from the exact commands that worked, but tested here only
with stubs and a mock `az` (logic, resume, region choice, installer). Run it step by step the first time.**

## 1. Get the project onto the other machine
Check your organization's rules first: some company laptops and sandboxes forbid pulling from public Git hosts.
- **Git (private repo):** `cat deploy/gitignore-additions.txt >> .gitignore`, commit, push. Never commit `deploy/config.env`, `deploy/.state/`, tokens, or `.env` files.
- **No Git?** `deploy/make-installer.sh` packs everything into ONE self-extracting file (`../aegis-installer.sh`). Move it by any approved channel, then `bash aegis-installer.sh`.

## 2. Run
```bash
cd deploy
cp config.env.example config.env && nano config.env     # set ADMIN_EMAIL at least
az login
./run-all.sh                 # everything, in order
./run-all.sh --only 00       # or one step at a time (recommended the first time)
./run-all.sh --from 40-image # resume after fixing a failure
```
Needs: Azure CLI, Node 22, npm, openssl, python3, curl, jq. Docker only if ACR Tasks is blocked. Network to Azure, npm, and the Docker/MCR registries.

| Step | Does |
|---|---|
| 00-preflight | tools, login, roles, providers, Entra rights, **picks a region that really works** (`--no-probe` skips the real PostgreSQL test) |
| 10-infra | resource groups, baseline (monitoring, Key Vault, identity), Reader role + budget alert |
| 20-entra | `aegis-api` + `aegis-web` apps, your four roles, CLI pre-authorization (or `ADMIN-REQUEST.md` if blocked) |
| 30-app-infra | PostgreSQL (private), registry, Container Apps, Static Web App |
| 40-image | build and push the API image (Azure build, else local Docker) |
| 50-app-release | run the real image, wait until `/readyz` is ready |
| 60-bootstrap | register the demo project, prod and dev environments, you as admin |
| 70-web | build and publish the dashboard, register its login redirect |
| 80-verify | health, identity; `--samples` creates three demo assessments |
| 90-devops-grants | after the DevOps service connections exist: pipeline role + access |

State is kept in `deploy/.state/` (git-ignored, mode 600; it holds the generated database password). Steps are safe to repeat.
`teardown.sh` deletes everything the kit created.

## 3. Azure DevOps (manual, optional)
The core runs without it. Only the governed pipelines need it. In the portal, with the same names:
1. Organization, then a **private project named `aegis`**. Without free hosted jobs, register a self-hosted agent in pool `Default`.
2. Repos: `aegis` (push the whole repo) and `aegis-pipeline-templates` (push the *contents* of `pipeline-templates/` as the repo root).
3. Library > variable group `aegis-pipeline`: `AEGIS_API_URL=https://<API_FQDN>`, `AEGIS_API_AUDIENCE=api://<API_APPID>` (values are in `.state/state.env`).
4. Service connections (Azure Resource Manager, app registration automatic, **workload identity federation**, resource-group scope):
   `aegis-dev-sc` to `rg-demo-dev`, `aegis-prod-sc` to `rg-demo-prod`. Untick "grant access to all pipelines".
5. `./90-devops-grants.sh <dev connection appId> <prod connection appId>`
6. Environments `aegis-dev` and `aegis-prod`, each with a **Required template** check: repository `aegis/aegis-pipeline-templates`, ref `refs/heads/main`, path `governed-pipeline.yml`. On prod also **Branch control** (`refs/heads/main`).
7. Pipelines from `/pipelines/ci.yml`, `/pipelines/workload-deploy.yml`, `/pipelines/bypass-test.yml`. Approve the permission prompts on first run.

## 4. Cost and safety
Expect roughly USD 1-2 per day while running (our earlier estimate; check Cost Management). The budget alert only emails you; it does not stop spending.
Pause the database when idle: `az postgres flexible-server stop -g <rg> -n <server>` (and `start` before use).
See `TROUBLESHOOTING.md` for every error we met, and `ADMIN-REQUEST.md` if app registrations are blocked.
