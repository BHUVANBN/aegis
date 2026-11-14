DROP TABLE IF EXISTS audit_events, verifications, deployments, approval_requests, recommendations, agent_runs,
  risk_contributions, impact_scenarios, policy_findings, dependencies, changed_resources, assessments,
  environment_access, environments, projects, principals CASCADE;
DROP FUNCTION IF EXISTS audit_events_immutable();
