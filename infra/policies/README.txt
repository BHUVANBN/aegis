Azure Policy definitions complementing the local rules in apps/api/src/agents/policy.ts.
Local deterministic rules run BEFORE deployment (from What-If output). Azure Policy runs DURING deployment (ARM
enforcement) and AFTER (compliance). They overlap on purpose: defence in depth.
Create (see scripts/policy-setup.sh):  az policy definition create --name aegis-deny-public-blob --rules <file> ...
Start with effect=Audit, review compliance, then switch the assignment parameter to Deny.
