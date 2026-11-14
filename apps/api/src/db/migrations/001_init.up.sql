-- AEGIS schema v1. All timestamps are timestamptz (UTC). gen_random_uuid() is built in (PostgreSQL 13+), no extension needed.

CREATE TABLE principals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  oid           text NOT NULL UNIQUE,            -- Entra object id (or dev identity)
  display_name  text,
  email         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key          text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9][a-z0-9-]*$'),
  name         text NOT NULL,
  repo_url     text,
  pipeline_ref text,                              -- e.g. Azure DevOps pipeline definition path/name
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE environments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (name ~ '^[a-z0-9][a-z0-9-]*$'),
  kind            text NOT NULL CHECK (kind IN ('dev','staging','prod')),
  subscription_id text,
  resource_group  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

-- Environment-level authorization: a token role is necessary but NOT sufficient; a grant here is also required.
CREATE TABLE environment_access (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id uuid NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  principal_oid  text NOT NULL,
  role           text NOT NULL CHECK (role IN ('viewer','assessor','approver','admin','pipeline')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (environment_id, principal_oid, role)
);
CREATE INDEX environment_access_oid_idx ON environment_access(principal_oid);

CREATE TABLE assessments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES projects(id),
  environment_id   uuid NOT NULL REFERENCES environments(id),
  version          integer NOT NULL DEFAULT 1,
  commit_sha       text NOT NULL,
  pipeline_run_id  text NOT NULL,
  artifact_digest  text NOT NULL CHECK (artifact_digest ~ '^sha256:[a-f0-9]{64}$'),
  template_path    text NOT NULL,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','complete','partial','failed')),
  whatif_raw       jsonb,
  whatif_sha256    text,
  parser_version   text,
  rules_version    text,
  risk_score       integer CHECK (risk_score BETWEEN 0 AND 100),
  risk_level       text CHECK (risk_level IN ('low','medium','high','critical')),
  confidence       numeric(4,3) CHECK (confidence BETWEEN 0 AND 1),
  risk_detail      jsonb,
  gate_decision    text CHECK (gate_decision IN ('allow','require_approval','block')),
  gate_reasons     jsonb,
  narrative        text,                         -- optional LLM text; never used for decisions
  requested_by     text NOT NULL,                -- principal oid
  created_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  UNIQUE (environment_id, pipeline_run_id, artifact_digest)   -- idempotency key
);
CREATE INDEX assessments_env_created_idx ON assessments(environment_id, created_at DESC);
CREATE INDEX assessments_digest_idx ON assessments(artifact_digest);

CREATE TABLE changed_resources (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id    uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  resource_id      text NOT NULL,
  type             text NOT NULL,
  name             text NOT NULL,
  subscription_id  text,
  resource_group   text,
  change_type      text NOT NULL,
  property_changes jsonb NOT NULL DEFAULT '[]',
  truncated        boolean NOT NULL DEFAULT false
);
CREATE INDEX changed_resources_assessment_idx ON changed_resources(assessment_id);

CREATE TABLE dependencies (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id    uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  from_resource_id text NOT NULL,
  to_resource_id   text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('confirmed-reference','inferred-colocation')),
  evidence         text NOT NULL,
  source           text NOT NULL,
  queried_at       timestamptz NOT NULL
);
CREATE INDEX dependencies_assessment_idx ON dependencies(assessment_id);

CREATE TABLE policy_findings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  finding_key   text NOT NULL,
  rule_id       text NOT NULL,
  title         text NOT NULL,
  severity      text NOT NULL CHECK (severity IN ('info','low','medium','high','critical')),
  category      text NOT NULL,
  resource_id   text,
  prohibited    boolean NOT NULL DEFAULT false,
  likelihood    numeric(3,2) NOT NULL,
  evidence      jsonb NOT NULL DEFAULT '[]',
  source        text NOT NULL CHECK (source IN ('local-rule','azure-policy'))
);
CREATE INDEX policy_findings_assessment_idx ON policy_findings(assessment_id);

CREATE TABLE impact_scenarios (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id      uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  basis              text NOT NULL CHECK (basis IN ('azure-what-if','heuristic')),
  title              text NOT NULL,
  description        text NOT NULL,
  affected_resources jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX impact_scenarios_assessment_idx ON impact_scenarios(assessment_id);

CREATE TABLE risk_contributions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  finding_key   text,
  factor        text NOT NULL,
  points        numeric(6,2) NOT NULL,
  explanation   text NOT NULL
);
CREATE INDEX risk_contributions_assessment_idx ON risk_contributions(assessment_id);

CREATE TABLE agent_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  agent         text NOT NULL,
  status        text NOT NULL CHECK (status IN ('succeeded','failed','timed_out','skipped')),
  attempt       integer NOT NULL DEFAULT 1,
  started_at    timestamptz NOT NULL,
  finished_at   timestamptz NOT NULL,
  error         text,
  output_summary jsonb
);
CREATE INDEX agent_runs_assessment_idx ON agent_runs(assessment_id);

CREATE TABLE recommendations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  finding_key   text,
  kind          text NOT NULL CHECK (kind IN ('preventive','recovery')),
  title         text NOT NULL,
  steps         jsonb NOT NULL,
  priority      integer NOT NULL
);
CREATE INDEX recommendations_assessment_idx ON recommendations(assessment_id);

CREATE TABLE approval_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id      uuid NOT NULL REFERENCES assessments(id),
  assessment_version integer NOT NULL,
  environment_id     uuid NOT NULL REFERENCES environments(id),
  artifact_digest    text NOT NULL CHECK (artifact_digest ~ '^sha256:[a-f0-9]{64}$'),
  requested_by       text NOT NULL,
  justification      text NOT NULL,
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','approved','rejected','revoked','expired','consumed')),
  decided_by         text,
  decided_at         timestamptz,
  decision_comment   text,
  expires_at         timestamptz,
  revoked_by         text,
  revoked_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (decided_by IS NULL OR decided_by <> requested_by)       -- separation of duties, enforced in the DB too
);
CREATE UNIQUE INDEX approval_one_open_per_assessment ON approval_requests(assessment_id) WHERE status IN ('pending','approved');
CREATE INDEX approval_requests_env_idx ON approval_requests(environment_id, status);

CREATE TABLE deployments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id         uuid NOT NULL REFERENCES assessments(id),
  approval_id           uuid UNIQUE REFERENCES approval_requests(id),   -- UNIQUE => an approval authorizes one deployment only
  environment_id        uuid NOT NULL REFERENCES environments(id),
  artifact_digest       text NOT NULL,
  pipeline_run_id       text NOT NULL,
  status                text NOT NULL DEFAULT 'authorized' CHECK (status IN ('authorized','succeeded','failed','expired')),
  authorized_by         text NOT NULL,
  authorized_at         timestamptz NOT NULL DEFAULT now(),
  lock_expires_at       timestamptz NOT NULL,
  completed_at          timestamptz,
  azure_deployment_name text,
  correlation_id        text,
  message               text,
  gate_snapshot         jsonb NOT NULL
);
-- At most one in-flight deployment per environment (race protection).
CREATE UNIQUE INDEX deployments_one_inflight_per_env ON deployments(environment_id) WHERE status = 'authorized';
CREATE INDEX deployments_assessment_idx ON deployments(assessment_id);

CREATE TABLE verifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id uuid NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  status        text NOT NULL CHECK (status IN ('passed','failed','inconclusive','partially_verified')),
  checks        jsonb NOT NULL DEFAULT '[]',
  discrepancies jsonb NOT NULL DEFAULT '[]',
  limitations   jsonb NOT NULL DEFAULT '[]',
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verifications_deployment_idx ON verifications(deployment_id, created_at DESC);

-- Security audit trail: append-only, hash-chained. See docs for guarantees and limits.
CREATE TABLE audit_events (
  id            bigserial PRIMARY KEY,
  at            timestamptz NOT NULL DEFAULT now(),
  actor         text NOT NULL,
  action        text NOT NULL,
  assessment_id uuid,
  environment   text,
  details       jsonb NOT NULL DEFAULT '{}',
  prev_hash     text NOT NULL,
  hash          text NOT NULL
);
CREATE INDEX audit_events_assessment_idx ON audit_events(assessment_id, id);
CREATE INDEX audit_events_at_idx ON audit_events(at DESC);

CREATE FUNCTION audit_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END $$;
CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_immutable();
