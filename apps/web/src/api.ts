import type { ApiError, Paged } from '@aegis/shared';

export type TokenProvider = () => Promise<string>;
let tokenProvider: TokenProvider | null = null;
export const setTokenProvider = (p: TokenProvider | null): void => {
  tokenProvider = p;
};
const BASE = import.meta.env.VITE_API_BASE ?? '';

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!tokenProvider) throw new ApiRequestError(401, 'unauthenticated', 'Not signed in');
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      Authorization: await tokenProvider(),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as (ApiError & T) | null;
  if (!res.ok)
    throw new ApiRequestError(
      res.status,
      data?.error?.code ?? 'error',
      data?.error?.message ?? `HTTP ${res.status}`,
      data?.error?.details,
    );
  return data as T;
}

export interface AssessmentRow {
  id: string;
  status: string;
  risk_level: string | null;
  risk_score: number | null;
  confidence: string | null;
  gate_decision: string | null;
  artifact_digest: string;
  commit_sha: string;
  pipeline_run_id: string;
  created_at: string;
  environment: string;
  environment_kind: string;
}
export interface Assessment extends AssessmentRow {
  risk_detail: {
    missingEvidence?: string[];
    blastRadius?: Record<string, number>;
    simulationDisclaimer?: string;
    dependencyLimitations?: string[];
    policyLimitations?: string[];
    azurePolicyStatus?: { status: string; reason?: string };
    dependencyStatus?: string;
    warnings?: string[];
  } | null;
  gate_reasons: string[] | null;
  narrative: string | null;
  rules_version: string | null;
  parser_version: string | null;
  version: number;
}
export interface Item {
  [k: string]: unknown;
}
export interface GateView {
  decision: string;
  reasons: string[];
  approval: {
    id: string;
    status: string;
    requested_by: string;
    decided_by: string | null;
    expires_at: string | null;
  } | null;
}
export interface Me {
  oid: string;
  name?: string;
  email?: string;
  tokenRoles: string[];
  grants: { environment: string; kind: string; role: string }[];
}


export interface MetricsSummary {
  generatedAt: string;
  days: number;
  includeSamples: boolean;
  sampleCount: number;
  totals: { assessments: number; completed: number; failed: number; allow: number; requireApproval: number; block: number };
  byRisk: { level: string; count: number }[];
  byLevelDecision: { level: string; decision: string; count: number }[];
  daily: { day: string; allow: number; requireApproval: number; block: number }[];
  durations: {
    assessmentMedianSec: number | null;
    assessmentP90Sec: number | null;
    approvalMedianSec: number | null;
    approvalP90Sec: number | null;
    leadTimeMedianSec: number | null;
  };
  approvals: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    expired: number;
    revoked: number;
    consumed: number;
    oldestPendingSec: number | null;
  };
  deployments: { total: number; succeeded: number; failed: number; authorized: number; expired: number };
  verifications: { total: number; passed: number; failed: number; inconclusive: number; partial: number };
  topRules: { ruleId: string; title: string; severity: string; count: number; prohibited: boolean }[];
  byEnvironment: {
    project: string;
    environment: string;
    kind: string;
    assessments: number;
    blocked: number;
    needsApproval: number;
    deployments: number;
    deploymentsSucceeded: number;
  }[];
  reconciliation: { runs: number; findings: number; lastRunAt: string | null };
}
export interface SystemStatus {
  time: string;
  db: { ok: boolean; latencyMs: number };
  authMode: string;
  llm: string;
  resourceGraph: boolean;
  rulesVersion: string | null;
  uptimeSec: number;
  audit: { ok: boolean; checked: number; brokenAtId?: number };
  stuckAssessments: { id: string; environment: string; status: string; ageSec: number }[];
  failedAssessments24h: number;
  agentStats: { agent: string; runs: number; failures: number; medianMs: number | null }[];
  pendingApprovals: { count: number; oldestSec: number | null };
  expiredDeployments: number;
  recentActivity: { id: number; at: string; actor: string; action: string; environment: string | null }[] | null;
  lastReconcile: { at: string; environment: string | null; status: string | null; findings: number } | null;
}
export interface AdminEnvironment {
  id: string;
  name: string;
  kind: string;
  subscription_id: string | null;
  resource_group: string | null;
  grants: number;
}
export interface AdminProject {
  id: string;
  key: string;
  name: string;
  repo_url: string | null;
  created_at: string;
  environments: AdminEnvironment[];
}
export interface Principal {
  oid: string;
  display_name: string | null;
  email: string | null;
  last_seen_at: string;
}
export interface Grant {
  principal_oid: string;
  display_name: string | null;
  email: string | null;
  role: string;
  created_at: string;
}
export const API_BASE: string = BASE;
export interface Ping {
  ok: boolean;
  status: number;
  ms: number;
  body: Record<string, unknown> | null;
}
/** Public health probes (no sign-in needed). Never throws: a network failure is reported as ok=false. */
export async function ping(path: '/healthz' | '/readyz'): Promise<Ping> {
  const t0 = performance.now();
  try {
    const res = await fetch(`${BASE}${path}`);
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: res.ok, status: res.status, ms: Math.round(performance.now() - t0), body };
  } catch {
    return { ok: false, status: 0, ms: Math.round(performance.now() - t0), body: null };
  }
}

export const api = {
  me: () => call<Me>('GET', '/me'),
  assessments: (q: { environment?: string; limit: number; offset: number }) =>
    call<Paged<AssessmentRow>>(
      'GET',
      `/assessments?limit=${q.limit}&offset=${q.offset}${q.environment ? `&environment=${encodeURIComponent(q.environment)}` : ''}`,
    ),
  assessment: (id: string) => call<Assessment>('GET', `/assessments/${id}`),
  items: (id: string, part: string) => call<{ items: Item[] }>('GET', `/assessments/${id}/${part}`),
  risk: (id: string) =>
    call<{
      score: number;
      level: string;
      confidence: string;
      contributions: { factor: string; points: string; explanation: string }[];
    }>('GET', `/assessments/${id}/risk`),
  gate: (id: string) => call<GateView>('GET', `/assessments/${id}/gate`),
  requestApproval: (id: string, justification: string) =>
    call<{ id: string }>('POST', `/assessments/${id}/approval-requests`, { justification }),
  approvals: (status?: string) =>
    call<{ items: Item[] }>(
      'GET',
      `/approval-requests?limit=50&offset=0${status ? `&status=${status}` : ''}`,
    ),
  decide: (id: string, decision: 'approve' | 'reject', comment: string) =>
    call<{ status: string }>('POST', `/approval-requests/${id}/decision`, { decision, comment }),
  revoke: (id: string) => call<{ status: string }>('POST', `/approval-requests/${id}/revoke`, {}),
  reconcile: (environmentId: string, sinceHours: number) =>
    call<{
      status: string;
      reason?: string;
      windowsChecked: number;
      changesSeen: number;
      findings: Item[];
      limitations: string[];
    }>('POST', `/environments/${environmentId}/reconcile`, { sinceHours }),
  environments: () =>
    call<{ items: { id: string; name: string; kind: string; project_key: string }[] }>(
      'GET',
      '/environments',
    ),
  brief: (id: string) =>
    call<{
      brief: {
        headline: string;
        recommendedAction: string;
        requiredApproverRole: string;
        checklist: { item: string; evidenceRef: string }[];
        openQuestions: string[];
      } | null;
    }>('GET', `/assessments/${id}/review-brief`),
  learning: () =>
    call<{
      minSample: number;
      note: string;
      rules: {
        ruleId: string;
        severity: string;
        assessments: number;
        deployed: number;
        verifiedPassed: number;
        verifiedFailed: number;
        verifiedOther: number;
        suggestion: string | null;
      }[];
    }>('GET', '/learning/summary'),
  audit: (limit: number, offset: number) =>
    call<Paged<Item>>('GET', `/audit?limit=${limit}&offset=${offset}`),
  auditVerify: () => call<{ ok: boolean; checked: number; brokenAtId?: number }>('GET', '/audit/verify'),
  metrics: (days: number, includeSamples: boolean) =>
    call<MetricsSummary>('GET', `/metrics/summary?days=${days}&includeSamples=${includeSamples}`),
  system: () => call<SystemStatus>('GET', '/system/status'),
  adminProjects: () => call<{ items: AdminProject[] }>('GET', '/admin/projects'),
  createProject: (b: { key: string; name: string; repoUrl?: string }) =>
    call<{ id: string }>('POST', '/admin/projects', b),
  createEnvironment: (b: {
    projectKey: string;
    name: string;
    kind: 'dev' | 'staging' | 'prod';
    subscriptionId?: string;
    resourceGroup?: string;
  }) => call<{ id: string }>('POST', '/admin/environments', b),
  principals: () => call<{ items: Principal[] }>('GET', '/admin/principals'),
  envAccess: (envId: string) => call<{ items: Grant[] }>('GET', `/admin/environments/${envId}/access`),
  grantAccess: (envId: string, principalId: string, role: string) =>
    call<void>('POST', `/admin/environments/${envId}/access`, { principalId, role }),
  revokeAccess: (envId: string, principalId: string, role: string) =>
    call<void>('POST', `/admin/environments/${envId}/access/revoke`, { principalId, role }),
  createAssessment: (b: {
    projectKey: string;
    environment: string;
    commitSha: string;
    pipelineRunId: string;
    artifactDigest: string;
    templatePath: string;
    whatIf: unknown;
  }) => call<{ id: string; status: string; duplicate: boolean }>('POST', '/assessments', b),
};
