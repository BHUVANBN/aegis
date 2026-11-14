import { z } from 'zod';

export const ROLES = ['viewer', 'assessor', 'approver', 'admin', 'pipeline'] as const;
export type Role = (typeof ROLES)[number];

export const ENVIRONMENT_KINDS = ['dev', 'staging', 'prod'] as const;
export type EnvironmentKind = (typeof ENVIRONMENT_KINDS)[number];

export const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const GATE_DECISIONS = ['allow', 'require_approval', 'block'] as const;
export type GateDecision = (typeof GATE_DECISIONS)[number];

export const CHANGE_TYPES = [
  'Create',
  'Delete',
  'Deploy',
  'Ignore',
  'Modify',
  'NoChange',
  'Unsupported',
] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export const AGENT_NAMES = [
  'perception',
  'reasoning',
  'dependency',
  'policy',
  'simulation',
  'risk',
  'planning',
  'reviewer',
] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

export const ASSESSMENT_STATUSES = ['pending', 'running', 'complete', 'partial', 'failed'] as const;
export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];

export const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;

/** Request: create an assessment. whatIf is the raw JSON from `az deployment group what-if --no-pretty-print`. */
export const CreateAssessmentSchema = z.object({
  projectKey: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  environment: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  commitSha: z.string().regex(/^[a-f0-9]{7,40}$/),
  pipelineRunId: z.string().min(1).max(100),
  artifactDigest: z.string().regex(DIGEST_RE),
  templatePath: z.string().min(1).max(300),
  whatIf: z.unknown(),
});
export type CreateAssessmentInput = z.infer<typeof CreateAssessmentSchema>;

export const ApprovalRequestSchema = z.object({
  justification: z.string().min(10).max(2000),
});

export const ApprovalDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  comment: z.string().min(3).max(2000),
});

export const AuthorizeDeploymentSchema = z.object({
  assessmentId: z.string().uuid(),
  artifactDigest: z.string().regex(DIGEST_RE),
  environment: z.string().min(1).max(100),
  pipelineRunId: z.string().min(1).max(100),
});

export const DeploymentResultSchema = z.object({
  status: z.enum(['succeeded', 'failed']),
  azureDeploymentName: z.string().max(200).optional(),
  correlationId: z.string().max(100).optional(),
  message: z.string().max(2000).optional(),
});

export const AccessGrantSchema = z.object({
  principalId: z.string().min(1).max(200),
  displayName: z.string().max(200).optional(),
  environment: z.string().min(1).max(100),
  role: z.enum(ROLES),
});

export const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export interface Paged<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApiError {
  error: { code: string; message: string; requestId?: string; details?: unknown };
}

export interface PropertyChange {
  path: string;
  changeType: string;
  before?: unknown;
  after?: unknown;
}

export interface ChangedResource {
  resourceId: string;
  subscriptionId: string | null;
  resourceGroup: string | null;
  type: string;
  name: string;
  changeType: ChangeType;
  propertyChanges: PropertyChange[];
  /** Full resource state as reported by What-If (bounded in size; may be absent). */
  before?: unknown;
  after?: unknown;
  truncated: boolean;
}

export interface Finding {
  id: string;
  ruleId: string;
  title: string;
  severity: Severity;
  likelihood: number; // 0..1
  prohibited: boolean;
  category: string;
  resourceId: string | null;
  evidence: { path?: string; before?: unknown; after?: unknown; note?: string }[];
  source: 'local-rule' | 'azure-policy';
}

export interface DependencyEdge {
  from: string; // consumer resource id
  to: string; // affected (changed) resource id
  kind: 'confirmed-reference' | 'inferred-colocation';
  evidence: string;
  source: string;
}

export interface ScoreContribution {
  findingId: string | null;
  factor: string;
  points: number;
  explanation: string;
}

export interface RiskResult {
  score: number;
  level: RiskLevel;
  confidence: number;
  rulesVersion: string;
  contributions: ScoreContribution[];
  missingEvidence: string[];
  overriddenByProhibited: boolean;
}

export interface Recommendation {
  findingId: string | null;
  kind: 'preventive' | 'recovery';
  title: string;
  steps: string[];
  priority: number;
}

/** Reasoning agent output: a hypothesis is a question to investigate, never a score input. */
export interface Hypothesis {
  id: string;
  resourceId: string;
  resourceClass: string;
  statement: string;
  whatWouldConfirm: string;
  relatedRuleIds: string[];
}

/** Reviewer agent output: a deterministic brief that prepares a human decision. */
export interface ReviewBrief {
  recommendedAction: GateDecision;
  requiredApproverRole: 'approver' | 'none' | 'not-approvable';
  headline: string;
  checklist: { item: string; evidenceRef: string }[];
  openQuestions: string[];
  generatedBy: 'deterministic-reviewer-1.0.0';
}
