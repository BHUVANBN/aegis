import type { ChangedResource, Finding } from '@aegis/shared';
import type { DependencyOutput } from './dependency.js';

export interface Scenario {
  basis: 'azure-what-if' | 'heuristic';
  title: string;
  description: string;
  affectedResources: string[];
}
export interface SimulationOutput {
  scenarios: Scenario[];
  blastRadius: {
    changedResources: number;
    destructiveOperations: number;
    confirmedDependents: number;
    inferredRelated: number;
    publicEndpointDependents: number;
  };
  disclaimer: string;
}

const PUBLIC_TYPES = [
  'microsoft.network/publicipaddresses',
  'microsoft.network/applicationgateways',
  'microsoft.web/sites',
  'microsoft.cdn/profiles',
  'microsoft.network/frontdoors',
];

export function runSimulationAgent(
  resources: ChangedResource[],
  deps: DependencyOutput,
  findings: Finding[],
): SimulationOutput {
  const scenarios: Scenario[] = [];
  const confirmedFor = (id: string) =>
    deps.edges.filter((e) => e.to === id && e.kind === 'confirmed-reference');

  for (const r of resources) {
    if (r.changeType === 'Delete') {
      scenarios.push({
        basis: 'azure-what-if',
        title: `Delete ${r.type}/${r.name}`,
        description: 'Azure What-If reports this resource will be deleted.',
        affectedResources: [r.resourceId],
      });
      const dep = confirmedFor(r.resourceId);
      if (dep.length)
        scenarios.push({
          basis: 'heuristic',
          title: `Consumers of ${r.name} may fail`,
          description: `${dep.length} resource(s) reference the deleted resource in their configuration. They may lose functionality; the actual effect depends on each consumer and is not simulated by Azure.`,
          affectedResources: dep.map((d) => d.from),
        });
    }
  }
  for (const f of findings) {
    if (f.ruleId === 'LR-NET-001') {
      scenarios.push({
        basis: 'heuristic',
        title: 'Inbound web traffic may be blocked',
        description:
          'What-If confirms the allow rule is removed (fact). Whether traffic is actually blocked depends on other NSG rules, priorities, subnet vs NIC association and upstream appliances, which What-If does not evaluate (inference).',
        affectedResources: f.resourceId ? [f.resourceId] : [],
      });
    } else if (f.category === 'public-exposure') {
      scenarios.push({
        basis: 'heuristic',
        title: 'Resource may become reachable from the Internet',
        description: `${f.title}. Actual reachability also depends on firewall rules and private endpoints that are not part of this change.`,
        affectedResources: f.resourceId ? [f.resourceId] : [],
      });
    } else if (f.category === 'privilege-escalation') {
      scenarios.push({
        basis: 'heuristic',
        title: 'Principal gains broader Azure permissions',
        description: f.title,
        affectedResources: f.resourceId ? [f.resourceId] : [],
      });
    } else if (f.category === 'encryption') {
      scenarios.push({
        basis: 'heuristic',
        title: 'Data protection weakened',
        description: f.title,
        affectedResources: f.resourceId ? [f.resourceId] : [],
      });
    }
  }
  const confirmed = new Set(
    deps.edges.filter((e) => e.kind === 'confirmed-reference').map((e) => e.from.toLowerCase()),
  );
  const inferred = new Set(
    deps.edges.filter((e) => e.kind === 'inferred-colocation').map((e) => e.from.toLowerCase()),
  );
  const publicDeps = deps.consumers.filter((c) => PUBLIC_TYPES.includes(c.type.toLowerCase())).length;
  return {
    scenarios,
    blastRadius: {
      changedResources: resources.length,
      destructiveOperations: resources.filter((r) => r.changeType === 'Delete').length,
      confirmedDependents: confirmed.size,
      inferredRelated: [...inferred].filter((x) => !confirmed.has(x)).length,
      publicEndpointDependents: publicDeps,
    },
    disclaimer:
      'Facts come from Azure What-If output. Scenarios labelled "heuristic" are AEGIS inferences, not Azure simulations.',
  };
}
