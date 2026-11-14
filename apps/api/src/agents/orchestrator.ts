import type { AgentName, ChangedResource, Finding, Recommendation, RiskResult } from '@aegis/shared';
import type { Config } from '../config.js';
import { withTx, type Db } from '../db/db.js';
import { audit } from '../audit.js';
import type { ResourceGraphClient } from '../azure/resourceGraph.js';
import type { LlmProvider } from '../llm/provider.js';
import { TimeoutError, withTimeout } from '../util.js';
import { RULES_VERSION } from '../rules/riskRules.js';
import { evaluateGate } from '../gate.js';
import { parseWhatIf, PerceptionError, PARSER_VERSION, type PerceptionOutput } from './perception.js';
import { runDependencyAgent, type DependencyOutput } from './dependency.js';
import { runSimulationAgent, type SimulationOutput } from './simulation.js';
import { runPolicyAgent, type PolicyOutput } from './policy.js';
import { runRiskAgent } from './risk.js';
import { runPlanningAgent } from './planning.js';
import { runReasoningAgent } from './reasoning.js';
import { runReviewerAgent } from './reviewer.js';

export interface OrchestratorDeps {
  db: Db;
  cfg: Config;
  arg: ResourceGraphClient | null;
  llm: LlmProvider;
}

interface AgentRun {
  agent: AgentName;
  status: 'succeeded' | 'failed' | 'timed_out' | 'skipped';
  attempt: number;
  startedAt: Date;
  finishedAt: Date;
  error?: string;
  summary?: unknown;
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs the agents in the documented order: perception -> dependency -> simulation -> policy -> risk -> planning.
 * Perception, policy and risk are mandatory (failure => assessment `failed`, gate blocks).
 * Dependency, simulation and planning failures yield a `partial` assessment with reduced confidence.
 * Idempotent: only the process that flips pending->running proceeds.
 */
export async function runAssessment(d: OrchestratorDeps, assessmentId: string): Promise<void> {
  const claim = await d.db.query<{
    id: string;
    whatif_raw: unknown;
    env_kind: 'dev' | 'staging' | 'prod';
    env_name: string;
    subscription_id: string | null;
    requested_by: string;
  }>(
    `UPDATE assessments a SET status='running' FROM environments e
     WHERE a.id=$1 AND a.status='pending' AND e.id=a.environment_id
     RETURNING a.id, a.whatif_raw, e.kind AS env_kind, e.name AS env_name, e.subscription_id, a.requested_by`,
    [assessmentId],
  );
  const a = claim.rows[0];
  if (!a) return; // duplicate or already processed

  const runs: AgentRun[] = [];
  async function step<T>(
    agent: AgentName,
    fn: () => Promise<T> | T,
    retries = 1,
  ): Promise<{ ok: true; value: T } | { ok: false; error: Error }> {
    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      const startedAt = new Date();
      try {
        const value = await withTimeout(Promise.resolve().then(fn), d.cfg.AGENT_TIMEOUT_MS, agent);
        runs.push({ agent, status: 'succeeded', attempt, startedAt, finishedAt: new Date() });
        return { ok: true, value };
      } catch (e) {
        const err = e as Error;
        const timedOut = err instanceof TimeoutError;
        runs.push({
          agent,
          status: timedOut ? 'timed_out' : 'failed',
          attempt,
          startedAt,
          finishedAt: new Date(),
          error: err.message.slice(0, 500),
        });
        if (err instanceof PerceptionError || attempt > retries) return { ok: false, error: err };
      }
    }
    return { ok: false, error: new Error('unreachable') };
  }

  const failAssessment = async (reason: string): Promise<void> => {
    await withTx(d.db, async (tx) => {
      const gate = evaluateGate(
        { status: 'failed', risk: null, envKind: a.env_kind, hasProhibited: false },
        d.cfg,
      );
      await tx.query(
        `UPDATE assessments SET status='failed', gate_decision=$2, gate_reasons=$3, completed_at=now(), rules_version=$4, parser_version=$5 WHERE id=$1`,
        [a.id, gate.decision, JSON.stringify([reason, ...gate.reasons]), RULES_VERSION, PARSER_VERSION],
      );
      await persistRuns(tx, a.id, runs);
      await audit(tx, {
        actor: 'system:orchestrator',
        action: 'assessment.failed',
        assessmentId: a.id,
        environment: a.env_name,
        details: { reason },
      });
    });
  };

  // 1. perception (mandatory)
  const per = await step<PerceptionOutput>('perception', () => parseWhatIf(a.whatif_raw), 0);
  if (!per.ok) return failAssessment(`Perception failed: ${per.error.message}`);
  const resources: ChangedResource[] = per.value.resources;
  const subs = [
    ...new Set(
      [a.subscription_id, ...resources.map((r) => r.subscriptionId)].filter(
        (s): s is string => !!s && GUID_RE.test(s),
      ),
    ),
  ];

  // 2. reasoning (non-fatal, advisory): risk hypotheses; never scored
  const rsn = await step('reasoning', () => runReasoningAgent(resources, a.env_name), 0);
  const hypotheses = rsn.ok ? rsn.value : [];

  // 3. dependency (non-fatal)
  const dep = await step<DependencyOutput>('dependency', () => runDependencyAgent(resources, d.arg, subs));
  const dependency: DependencyOutput = dep.ok
    ? dep.value
    : {
        status: 'unavailable',
        reason: dep.error.message,
        edges: [],
        consumers: [],
        queriedAt: new Date().toISOString(),
        limitations: ['Dependency agent failed'],
      };

  // 4 (policy) runs before simulation so simulation can reference findings; recorded in documented order below
  const pol = await step<PolicyOutput>('policy', () => runPolicyAgent(resources, a.env_kind, d.arg, subs));
  if (!pol.ok) return failAssessment(`Policy agent failed: ${pol.error.message}`);
  const policy = pol.value;

  // 3. simulation (non-fatal)
  const sim = await step<SimulationOutput>(
    'simulation',
    () => runSimulationAgent(resources, dependency, policy.findings),
    0,
  );
  const simulation: SimulationOutput = sim.ok
    ? sim.value
    : {
        scenarios: [],
        blastRadius: {
          changedResources: resources.length,
          destructiveOperations: 0,
          confirmedDependents: dependency.consumers.length,
          inferredRelated: 0,
          publicEndpointDependents: 0,
        },
        disclaimer: 'Simulation agent failed; no scenarios available',
      };

  // 5. risk (mandatory)
  const rk = await step<RiskResult>(
    'risk',
    () =>
      runRiskAgent({
        findings: policy.findings,
        envKind: a.env_kind,
        dependency,
        policy,
        simulation,
        perceptionWarnings: per.value.warnings.length,
        truncated: per.value.truncatedResources || resources.some((r) => r.truncated),
      }),
    0,
  );
  if (!rk.ok) return failAssessment(`Risk agent failed: ${rk.error.message}`);
  const risk = rk.value;

  // 6. planning (non-fatal)
  const pl = await step<Recommendation[]>(
    'planning',
    () => runPlanningAgent(policy.findings, resources, risk.missingEvidence),
    0,
  );
  const recommendations = pl.ok ? pl.value : [];

  const agentFailed = !dep.ok || !sim.ok || !pl.ok || !rsn.ok;
  const evidenceGap = dependency.status !== 'ok' || policy.azurePolicy.status !== 'ok';
  let status: 'complete' | 'partial' = agentFailed || evidenceGap ? 'partial' : 'complete';
  const hasProhibited = policy.findings.some((f: Finding) => f.prohibited);
  let gate = evaluateGate({ status, risk, envKind: a.env_kind, hasProhibited }, d.cfg);
  if (!pl.ok) risk.missingEvidence.push('Planning agent failed; no recommendations generated');
  if (!sim.ok) risk.missingEvidence.push('Simulation agent failed; no impact scenarios generated');
  if (!rsn.ok) risk.missingEvidence.push('Reasoning agent failed; no hypotheses generated');

  // 7. reviewer (non-fatal): prepares the human decision from the gate result; it cannot change the decision
  const rv = await step(
    'reviewer',
    () =>
      runReviewerAgent({
        gate,
        findings: policy.findings,
        recommendations,
        missingEvidence: risk.missingEvidence,
        blastRadius: simulation.blastRadius,
        envKind: a.env_kind,
      }),
    0,
  );
  const reviewBrief = rv.ok ? rv.value : null;
  if (!rv.ok) {
    status = 'partial';
    risk.missingEvidence.push('Reviewer agent failed; no decision brief generated');
    gate = evaluateGate({ status, risk, envKind: a.env_kind, hasProhibited }, d.cfg);
  }

  // optional narrative (never affects decisions)
  let narrative: string | null = null;
  try {
    narrative = await d.llm.explain({
      riskLevel: risk.level,
      score: risk.score,
      findings: policy.findings.slice(0, 20).map((f) => ({
        ruleId: f.ruleId,
        title: f.title,
        severity: f.severity,
        resourceType: resources.find((r) => r.resourceId === f.resourceId)?.type,
      })),
      recommendations: recommendations.slice(0, 10).map((r) => r.title),
    });
  } catch {
    narrative = null;
  }

  await withTx(d.db, async (tx) => {
    await tx.query(
      `UPDATE assessments SET status=$2, whatif_sha256=$3, parser_version=$4, rules_version=$5, risk_score=$6, risk_level=$7, confidence=$8,
         risk_detail=$9, gate_decision=$10, gate_reasons=$11, narrative=$12, hypotheses=$13, review_brief=$14, completed_at=now() WHERE id=$1`,
      [
        a.id,
        status,
        per.value.rawSha256,
        per.value.parserVersion,
        risk.rulesVersion,
        risk.score,
        risk.level,
        risk.confidence,
        JSON.stringify({
          ...risk,
          blastRadius: simulation.blastRadius,
          simulationDisclaimer: simulation.disclaimer,
          dependencyStatus: dependency.status,
          azurePolicyStatus: policy.azurePolicy,
          dependencyLimitations: dependency.limitations,
          policyLimitations: policy.limitations,
          warnings: per.value.warnings,
        }),
        gate.decision,
        JSON.stringify(gate.reasons),
        narrative,
        JSON.stringify(hypotheses),
        reviewBrief ? JSON.stringify(reviewBrief) : null,
      ],
    );
    for (const r of resources)
      await tx.query(
        `INSERT INTO changed_resources(assessment_id,resource_id,type,name,subscription_id,resource_group,change_type,property_changes,truncated) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          a.id,
          r.resourceId,
          r.type,
          r.name,
          r.subscriptionId,
          r.resourceGroup,
          r.changeType,
          JSON.stringify(r.propertyChanges),
          r.truncated,
        ],
      );
    for (const e of dependency.edges)
      await tx.query(
        `INSERT INTO dependencies(assessment_id,from_resource_id,to_resource_id,kind,evidence,source,queried_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [a.id, e.from, e.to, e.kind, e.evidence, e.source, dependency.queriedAt],
      );
    for (const f of policy.findings)
      await tx.query(
        `INSERT INTO policy_findings(assessment_id,finding_key,rule_id,title,severity,category,resource_id,prohibited,likelihood,evidence,source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          a.id,
          f.id,
          f.ruleId,
          f.title,
          f.severity,
          f.category,
          f.resourceId,
          f.prohibited,
          f.likelihood,
          JSON.stringify(f.evidence),
          f.source,
        ],
      );
    for (const s of simulation.scenarios)
      await tx.query(
        `INSERT INTO impact_scenarios(assessment_id,basis,title,description,affected_resources) VALUES ($1,$2,$3,$4,$5)`,
        [a.id, s.basis, s.title, s.description, JSON.stringify(s.affectedResources)],
      );
    for (const c of risk.contributions)
      await tx.query(
        `INSERT INTO risk_contributions(assessment_id,finding_key,factor,points,explanation) VALUES ($1,$2,$3,$4,$5)`,
        [a.id, c.findingId, c.factor, c.points, c.explanation],
      );
    for (const r of recommendations)
      await tx.query(
        `INSERT INTO recommendations(assessment_id,finding_key,kind,title,steps,priority) VALUES ($1,$2,$3,$4,$5,$6)`,
        [a.id, r.findingId, r.kind, r.title, JSON.stringify(r.steps), r.priority],
      );
    runs.forEach((r) => {
      if (r.agent === 'perception')
        r.summary = { resources: resources.length, warnings: per.value.warnings.length };
      if (r.agent === 'reasoning') r.summary = { hypotheses: hypotheses.length };
      if (r.agent === 'reviewer') r.summary = { recommendedAction: reviewBrief?.recommendedAction ?? null };
      if (r.agent === 'dependency') r.summary = { status: dependency.status, edges: dependency.edges.length };
      if (r.agent === 'policy')
        r.summary = { findings: policy.findings.length, azurePolicy: policy.azurePolicy.status };
      if (r.agent === 'risk')
        r.summary = { score: risk.score, level: risk.level, confidence: risk.confidence };
    });
    await persistRuns(tx, a.id, runs);
    await audit(tx, {
      actor: 'system:orchestrator',
      action: 'assessment.completed',
      assessmentId: a.id,
      environment: a.env_name,
      details: {
        status,
        riskLevel: risk.level,
        score: risk.score,
        confidence: risk.confidence,
        gate: gate.decision,
        reasons: gate.reasons,
      },
    });
  });
}

async function persistRuns(tx: import('../db/db.js').Tx, id: string, runs: AgentRun[]): Promise<void> {
  for (const r of runs)
    await tx.query(
      `INSERT INTO agent_runs(assessment_id,agent,status,attempt,started_at,finished_at,error,output_summary) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        r.agent,
        r.status,
        r.attempt,
        r.startedAt,
        r.finishedAt,
        r.error ?? null,
        r.summary ? JSON.stringify(r.summary) : null,
      ],
    );
}
