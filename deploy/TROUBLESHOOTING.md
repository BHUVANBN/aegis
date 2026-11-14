# Troubleshooting: every problem we actually hit building this, with the fix

| Symptom / message | Cause | Fix |
|---|---|---|
| `SkuNotAvailable` creating PostgreSQL | The size is listed for the region but your subscription cannot create it | Step 00 probes real creates and picks another region. Edit `REGIONS` in config.env. |
| `LocationNotAvailableForResourceType ... managedEnvironments` | Container Apps is not offered in that region | Same: step 00 only accepts regions that offer it |
| `ManagedEnvironmentSubnetDelegationError` | Container Apps subnet not delegated | Fixed in `infra/bicep/modules/network.bicep` (delegation `Microsoft.App/environments`). If you see it, your copy lacks the fix |
| `LocationIsOfferRestricted` / `DisallowedLocation` | Subscription or policy restricts the region | Remove the region from `REGIONS` |
| `TasksOperationsNotAllowed` | ACR Tasks is blocked (common on student/sandbox subscriptions) | Step 40 falls back to local Docker automatically |
| `permission denied ... docker.sock` | User is not in the docker group | `sudo usermod -aG docker $USER`, log out and in (or `sg docker -c "<cmd>"`) |
| Revision `ActivationFailed`, missing module `@azure/identity` | Docker image lacked nested `node_modules` | Fixed in the repo `Dockerfile`. Logs: Log Analytics query `ContainerAppConsoleLogs_CL` |
| `AADSTS65001` getting a token | Azure CLI app not pre-authorized for the API scope | Step 20 does this; wait a minute and retry |
| `AADSTS530035`, "Verify another way" loops | Security defaults + device-code login | Use the normal browser login (`az login`), skip MFA registration if offered |
| Login popup shows the sign-in page again, `interaction_in_progress` | Old popup flow | Fixed (redirect flow in `apps/web/src/auth.tsx`). Clear site data or use a private window |
| `az ad app update --set api.…` fails on a new app | Nested property on an empty object | Fixed in `scripts/entra-setup.sh` (Graph PATCH) |
| `Another object with the same userPrincipalName exists` | User already created | Look it up with `az ad user show`, reset its password |
| `No hosted parallelism has been purchased or granted` (Azure DevOps) | New organizations get no free hosted jobs | Link billing, or use a self-hosted agent (pool `Default`) |
| `VS30063: not authorized` registering an agent | Wrong organization name or PAT | Test with `curl -u :PAT https://dev.azure.com/ORG/_apis/projects` (200 = ok) |
| `TF401019` / "requires user authentication" creating repos or variable groups | The PAT lacks that scope | Create them in the portal |
| `A session for this agent already exists` | Old agent process still alive | Kill it (`pkill -f Agent.Listener`), wait a minute, restart |
| CI: PostgreSQL port 5432 already in use | A local PostgreSQL or dev container holds the port | Stop it (`docker compose stop`, `systemctl stop postgresql`) |
| `HTTP_STATUS: unbound variable`, `unrecognized arguments: environmentName=` in pipelines | Template script bugs | Fixed in `pipeline-templates/` |
| Key Vault name "already exists" after delete | Purge protection reserves the name 7 days | A new resource group gives a new name |
| Resource Graph checks show "unavailable" | API identity lacks Reader at subscription | Re-run step 10 with Owner rights, or ask an Owner to assign Reader |
| Static Web App region refused | East Asia not enabled | Change `staticWebAppLocation` in `infra/bicep/modules/compute.bicep` (centralus, eastus2, eastasia, westeurope, westus2) |
| `az containerapp exec` fails without a terminal | It needs a TTY | Step 60 wraps it with `script`; otherwise run it from an interactive shell |
| Slow first request / 40-second curl timeout | The API scales to zero | Retry; first call wakes it |
