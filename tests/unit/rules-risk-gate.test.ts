import { describe, expect, it } from 'vitest';
import { parseWhatIf } from '../../apps/api/src/agents/perception';
import { classifyResource } from '../../apps/api/src/agents/classify';
import { evaluateLocalRules, runPolicyAgent } from '../../apps/api/src/agents/policy';
import { runRiskAgent, levelForScore } from '../../apps/api/src/agents/risk';
import { runSimulationAgent } from '../../apps/api/src/agents/simulation';
import { runPlanningAgent } from '../../apps/api/src/agents/planning';
import type { DependencyOutput } from '../../apps/api/src/agents/dependency';
import { evaluateGate } from '../../apps/api/src/gate';
import { RULES_VERSION } from '../../apps/api/src/rules/riskRules';
import { fixture, MockArg } from '../helpers';

const okDep: DependencyOutput = {
  status: 'ok',
  edges: [],
  consumers: [],
  queriedAt: new Date().toISOString(),
  limitations: [],
};
const cfg = { MEDIUM_REQUIRES_APPROVAL_IN: 'prod', MIN_CONFIDENCE_FOR_AUTO_ALLOW: 0.8 };
const assess = async (name: string, env: 'dev' | 'staging' | 'prod', dep = okDep, argOk = true) => {
  const per = parseWhatIf(fixture(name));
  const pol = await runPolicyAgent(per.resources, env, argOk ? new MockArg() : null, [
    '00000000-0000-0000-0000-000000000000',
  ]);
  const sim = runSimulationAgent(per.resources, dep, pol.findings);
  const risk = runRiskAgent({
    findings: pol.findings,
    envKind: env,
    dependency: dep,
    policy: pol,
    simulation: sim,
    perceptionWarnings: 0,
    truncated: false,
  });
  return { per, pol, sim, risk };
};

describe('classification', () => {
  it('classifies resources', () => {
    const c = (n: string) => parseWhatIf(fixture(n)).resources.map(classifyResource);
    expect(c('whatif-tag-only.json')).toEqual(['metadata-only']);
    expect(c('whatif-nsg-https-removed.json')).toEqual(['network-security', 'unchanged']);
    expect(c('whatif-vm-resize.json')).toEqual(['compute']);
    expect(c('whatif-delete-postgres.json')).toEqual(['database']);
    expect(c('whatif-role-owner.json')).toEqual(['identity']);
  });
});

describe('local rules', () => {
  it('LR-NET-001: removing public 443 allow is critical and prohibited in prod, high in dev', () => {
    const r = parseWhatIf(fixture('whatif-nsg-https-removed.json')).resources;
    const prod = evaluateLocalRules(r, 'prod').find((f) => f.ruleId === 'LR-NET-001')!;
    expect(prod.severity).toBe('critical');
    expect(prod.prohibited).toBe(true);
    expect(prod.evidence[0]!.path).toBe('properties.securityRules[1]');
    const dev = evaluateLocalRules(r, 'dev').find((f) => f.ruleId === 'LR-NET-001')!;
    expect(dev.severity).toBe('critical');
    expect(dev.prohibited).toBe(false);
  });
  it('storage: public blob access, https disabled, weak TLS', () => {
    const ids = evaluateLocalRules(parseWhatIf(fixture('whatif-storage-public.json')).resources, 'dev').map(
      (f) => f.ruleId,
    );
    expect(ids).toContain('LR-STG-001');
    expect(ids).toContain('LR-ENC-001');
  });
  it('deleting a database is critical, prohibited only in prod', () => {
    const r = parseWhatIf(fixture('whatif-delete-postgres.json')).resources;
    expect(evaluateLocalRules(r, 'prod')[0]).toMatchObject({ ruleId: 'LR-DEL-001', prohibited: true });
    expect(evaluateLocalRules(r, 'dev')[0]).toMatchObject({ ruleId: 'LR-DEL-001', prohibited: false });
  });
  it('subscription-scope Owner assignment is critical and prohibited', () => {
    const f = evaluateLocalRules(parseWhatIf(fixture('whatif-role-owner.json')).resources, 'dev')[0]!;
    expect(f).toMatchObject({ ruleId: 'LR-IAM-001', severity: 'critical', prohibited: true });
  });
  it('tag-only changes produce no findings', () => {
    expect(evaluateLocalRules(parseWhatIf(fixture('whatif-tag-only.json')).resources, 'prod')).toEqual([]);
  });
});

describe('NSG whole-array What-If form', () => {
  const mk = (before: unknown[], after: unknown[]) =>
    parseWhatIf({
      status: 'Succeeded',
      changes: [
        {
          resourceId:
            '/subscriptions/s/resourceGroups/rg-demo-prod/providers/Microsoft.Network/networkSecurityGroups/n',
          changeType: 'Modify',
          delta: [{ path: 'properties.securityRules', propertyChangeType: 'Modify', before, after }],
        },
      ],
    }).resources;
  const https = {
    name: 'allow-https',
    properties: {
      access: 'Allow',
      direction: 'Inbound',
      sourceAddressPrefix: 'Internet',
      destinationPortRange: '443',
    },
  };
  it('detects removal of the public 443 rule when the array is reported whole', () => {
    expect(
      evaluateLocalRules(mk([https], []), 'prod').some((f) => f.ruleId === 'LR-NET-001' && f.prohibited),
    ).toBe(true);
  });
  it('does not flag when the rule is still present', () => {
    expect(evaluateLocalRules(mk([https], [https]), 'prod').some((f) => f.ruleId === 'LR-NET-001')).toBe(
      false,
    );
  });
  it('detects an added Internet-to-SSH allow rule', () => {
    const ssh = {
      name: 'ssh',
      properties: {
        access: 'Allow',
        direction: 'Inbound',
        sourceAddressPrefix: '*',
        destinationPortRange: '22',
      },
    };
    expect(evaluateLocalRules(mk([https], [https, ssh]), 'dev').some((f) => f.ruleId === 'LR-NET-002')).toBe(
      true,
    );
  });
});

describe('risk scoring', () => {
  it('level thresholds', () => {
    expect([0, 19, 20, 44, 45, 69, 70, 100].map(levelForScore)).toEqual([
      'low',
      'low',
      'medium',
      'medium',
      'high',
      'high',
      'critical',
      'critical',
    ]);
  });
  it('tag-only in dev: score 0, low, full confidence', async () => {
    const { risk } = await assess('whatif-tag-only.json', 'dev');
    expect(risk).toMatchObject({ score: 0, level: 'low', confidence: 1, rulesVersion: RULES_VERSION });
  });
  it('VM resize in prod: 12 x 0.6 x 1.25 = 9 points, but severity floor makes it medium', async () => {
    const { risk } = await assess('whatif-vm-resize.json', 'prod');
    expect(risk.contributions[0]!.points).toBe(9);
    expect(risk.score).toBe(9);
    expect(risk.level).toBe('medium');
  });
  it('prohibited finding forces critical regardless of score', async () => {
    const { risk } = await assess('whatif-nsg-https-removed.json', 'prod');
    expect(risk.level).toBe('critical');
    expect(risk.overriddenByProhibited).toBe(true);
  });
  it('missing evidence lowers confidence and is listed', async () => {
    const { risk } = await assess(
      'whatif-tag-only.json',
      'dev',
      { ...okDep, status: 'unavailable', reason: 'no ARG' },
      false,
    );
    expect(risk.confidence).toBeCloseTo(0.55, 3);
    expect(risk.missingEvidence.length).toBe(2);
  });
  it('blast radius adds capped points', async () => {
    const per = parseWhatIf(fixture('whatif-vm-resize.json'));
    const consumers = Array.from({ length: 10 }, (_, i) => ({
      id: `/subscriptions/s/resourceGroups/r/providers/A.B/c/x${i}`,
      type: 'A.B/c',
      name: `x${i}`,
    }));
    const dep: DependencyOutput = {
      ...okDep,
      consumers,
      edges: consumers.map((c) => ({
        from: c.id,
        to: per.resources[0]!.resourceId,
        kind: 'confirmed-reference' as const,
        evidence: 'x',
        source: 'test',
      })),
    };
    const { risk } = await assess('whatif-vm-resize.json', 'prod', dep);
    expect(risk.contributions.find((c) => c.factor === 'blast-radius')!.points).toBe(15);
  });
});

describe('gate (pure)', () => {
  const g = (
    level: 'low' | 'medium' | 'high' | 'critical',
    over: Partial<Parameters<typeof evaluateGate>[0]> = {},
    conf = 1,
  ) =>
    evaluateGate(
      {
        status: 'complete',
        risk: { level, confidence: conf, overriddenByProhibited: false },
        envKind: 'prod',
        hasProhibited: false,
        ...over,
      },
      cfg,
    );
  it('maps levels to decisions', () => {
    expect(g('low').decision).toBe('allow');
    expect(g('medium').decision).toBe('require_approval');
    expect(g('medium', { envKind: 'dev' }).decision).toBe('allow');
    expect(g('high').decision).toBe('require_approval');
    expect(g('critical').decision).toBe('block');
  });
  it('fails closed', () => {
    expect(g('low', { status: 'failed', risk: null }).decision).toBe('block');
    expect(g('low', { status: 'running' }).decision).toBe('block');
    expect(g('low', { status: 'partial' }).decision).toBe('require_approval');
    expect(g('low', {}, 0.55).decision).toBe('require_approval');
    expect(g('low', { hasProhibited: true }).decision).toBe('block');
  });
});

describe('simulation and planning', () => {
  it('labels heuristics and facts separately', async () => {
    const { sim, pol, per } = await assess('whatif-nsg-https-removed.json', 'prod');
    expect(sim.scenarios.some((s) => s.basis === 'heuristic')).toBe(true);
    expect(sim.disclaimer).toMatch(/heuristic/);
    const recs = runPlanningAgent(pol.findings, per.resources, []);
    expect(recs.some((r) => r.kind === 'preventive' && r.findingId)).toBe(true);
    expect(recs.flatMap((r) => r.steps).join(' ')).not.toMatch(/bypass|disable the policy/i);
  });
  it('missing evidence yields a restore-evidence recommendation', () => {
    expect(runPlanningAgent([], [], ['x']).some((r) => r.title.includes('missing evidence'))).toBe(true);
  });
});
