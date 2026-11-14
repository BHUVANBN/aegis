-- Creates (or reuses) a project + one environment and grants the FIRST administrator access to it.
-- The API has no endpoint to create projects/environments (deliberate: onboarding is an admin/DB action).
-- Run once per environment, e.g.:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/bootstrap.sql \
--     -v project_key=demo -v project_name="Demo Project" -v repo_url=https://dev.azure.com/org/proj/_git/repo \
--     -v env_name=prod -v env_kind=prod -v subscription_id=<TARGET subscription id> -v resource_group=rg-demo-prod \
--     -v admin_oid=<your Entra object id>
-- subscription_id/resource_group describe the TARGET infrastructure AEGIS reads (Resource Graph, alerts), not AEGIS itself.
INSERT INTO projects (key, name, repo_url, pipeline_ref)
VALUES (:'project_key', :'project_name', :'repo_url', 'pipelines/workload-deploy.yml')
ON CONFLICT (key) DO NOTHING;

INSERT INTO environments (project_id, name, kind, subscription_id, resource_group)
SELECT id, :'env_name', :'env_kind', :'subscription_id', :'resource_group' FROM projects WHERE key = :'project_key'
ON CONFLICT (project_id, name) DO UPDATE SET subscription_id = EXCLUDED.subscription_id, resource_group = EXCLUDED.resource_group;

INSERT INTO environment_access (environment_id, principal_oid, role)
SELECT e.id, :'admin_oid', r.role
FROM environments e JOIN projects p ON p.id = e.project_id, (VALUES ('admin'), ('viewer')) AS r(role)
WHERE p.key = :'project_key' AND e.name = :'env_name'
ON CONFLICT DO NOTHING;

SELECT p.key AS project, e.name AS environment, e.kind, e.resource_group, count(a.*) AS grants
FROM environments e JOIN projects p ON p.id = e.project_id LEFT JOIN environment_access a ON a.environment_id = e.id
WHERE p.key = :'project_key' GROUP BY 1,2,3,4 ORDER BY 2;
