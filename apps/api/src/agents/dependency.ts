import type { ChangedResource, DependencyEdge } from '@aegis/shared';
import type { ResourceGraphClient } from '../azure/resourceGraph.js';
import { SAFE_RESOURCE_ID_RE } from '../util.js';

export interface DependencyOutput {
  status: 'ok' | 'partial' | 'unavailable';
  reason?: string;
  edges: DependencyEdge[];
  consumers: { id: string; type: string; name: string }[];
  queriedAt: string;
  limitations: string[];
}

const MAX_TARGETS = 50;
const SOURCE = 'azure-resource-graph';

export async function runDependencyAgent(
  resources: ChangedResource[],
  arg: ResourceGraphClient | null,
  subscriptions: string[],
): Promise<DependencyOutput> {
  const queriedAt = new Date().toISOString();
  const limitations = [
    'Confirmed edges mean the consumer resource properties literally contain the affected resource id (Resource Graph text match). Runtime/data-plane dependencies (connection strings, DNS, traffic flows) are NOT visible to this agent.',
    'Subnet-to-NSG associations appear as a reference from the parent virtual network, not from the subnet itself.',
    'The graph is limited to subscriptions the AEGIS identity can read, and Resource Graph data can lag recent changes.',
    'Inferred edges (same resource group) are weak signals, not dependencies.',
  ];
  if (!arg)
    return {
      status: 'unavailable',
      reason: 'Resource Graph client not configured (ARG_ENABLED=false)',
      edges: [],
      consumers: [],
      queriedAt,
      limitations,
    };

  const targets = resources.filter(
    (r) =>
      (r.changeType === 'Modify' || r.changeType === 'Delete' || r.changeType === 'Deploy') &&
      SAFE_RESOURCE_ID_RE.test(r.resourceId),
  );
  const skippedUnsafe = resources.filter(
    (r) => r.changeType !== 'Create' && !SAFE_RESOURCE_ID_RE.test(r.resourceId),
  ).length;
  if (skippedUnsafe)
    limitations.push(`${skippedUnsafe} resource id(s) contained unexpected characters and were not queried.`);
  const picked = targets.slice(0, MAX_TARGETS);
  if (targets.length > MAX_TARGETS)
    limitations.push(`Only the first ${MAX_TARGETS} affected resources were investigated.`);
  if (picked.length === 0) return { status: 'ok', edges: [], consumers: [], queriedAt, limitations };

  const edges: DependencyEdge[] = [];
  const consumers = new Map<string, { id: string; type: string; name: string }>();
  let failures = 0;
  let lastError = '';

  for (let i = 0; i < picked.length; i += 5) {
    await Promise.all(
      picked.slice(i, i + 5).map(async (t) => {
        try {
          const id = t.resourceId.toLowerCase();
          const rows = await arg.query(
            `resources | where tolower(id) != '${id}' | where tolower(id) !startswith '${id}/' | where tolower(tostring(properties)) contains '${id}' | project id, name, type, resourceGroup | take 200`,
            subscriptions,
          );
          for (const row of rows) {
            const cid = String(row.id);
            consumers.set(cid.toLowerCase(), { id: cid, type: String(row.type), name: String(row.name) });
            edges.push({
              from: cid,
              to: t.resourceId,
              kind: 'confirmed-reference',
              evidence: `properties of ${String(row.type)}/${String(row.name)} contain the id of the affected resource`,
              source: SOURCE,
            });
          }
        } catch (e) {
          failures++;
          lastError = (e as Error).message.slice(0, 300);
        }
      }),
    );
  }

  const rgs = [
    ...new Set(picked.filter((p) => p.resourceGroup).map((p) => p.resourceGroup!.toLowerCase())),
  ].filter((g) => /^[a-z0-9._()-]+$/.test(g));
  for (const rg of rgs) {
    try {
      const rows = await arg.query(
        `resources | where tolower(resourceGroup) == '${rg}' | project id, name, type | take 25`,
        subscriptions,
      );
      for (const row of rows) {
        const cid = String(row.id);
        for (const t of picked.filter(
          (p) => p.resourceGroup?.toLowerCase() === rg && p.resourceId.toLowerCase() !== cid.toLowerCase(),
        )) {
          if (!edges.some((e) => e.from.toLowerCase() === cid.toLowerCase() && e.to === t.resourceId))
            edges.push({
              from: cid,
              to: t.resourceId,
              kind: 'inferred-colocation',
              evidence: `same resource group (${rg})`,
              source: SOURCE,
            });
        }
      }
    } catch (e) {
      failures++;
      lastError = (e as Error).message.slice(0, 300);
    }
  }

  const status = failures === 0 ? 'ok' : failures >= picked.length ? 'unavailable' : 'partial';
  return {
    status,
    reason: failures ? lastError : undefined,
    edges,
    consumers: [...consumers.values()],
    queriedAt,
    limitations,
  };
}
