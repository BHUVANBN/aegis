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
  tokenRoles: string[];
  grants: { environment: string; kind: string; role: string }[];
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
};
