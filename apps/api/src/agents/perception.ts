import { CHANGE_TYPES, type ChangedResource, type ChangeType, type PropertyChange } from '@aegis/shared';
import { canonicalJson, sha256Hex } from '../util.js';

export const PARSER_VERSION = 'whatif-parser-1.1.0';
const MAX_RESOURCES = 2000;
const MAX_PROPERTY_CHANGES = 500;
const MAX_STATE_BYTES = 100_000;

export class PerceptionError extends Error {}

export interface PerceptionOutput {
  resources: ChangedResource[];
  warnings: string[];
  parserVersion: string;
  rawSha256: string;
  truncatedResources: boolean;
  diagnostics: unknown[];
}

interface RawDelta {
  path?: string;
  propertyChangeType?: string;
  before?: unknown;
  after?: unknown;
  children?: RawDelta[];
}

const ID_RE = /^\/subscriptions\/([^/]+)(?:\/resourceGroups\/([^/]+))?(?:\/providers\/(.+))?$/i;

export function parseResourceId(id: string): {
  subscriptionId: string | null;
  resourceGroup: string | null;
  type: string;
  name: string;
} {
  const m = ID_RE.exec(id);
  if (!m) throw new PerceptionError(`Unrecognised resource id: ${id.slice(0, 200)}`);
  const [, sub, rg, rest] = m;
  if (!rest) {
    return rg
      ? {
          subscriptionId: sub ?? null,
          resourceGroup: rg,
          type: 'Microsoft.Resources/resourceGroups',
          name: rg,
        }
      : {
          subscriptionId: sub ?? null,
          resourceGroup: null,
          type: 'Microsoft.Resources/subscriptions',
          name: sub ?? '',
        };
  }
  const seg = rest.split('/');
  const ns = seg[0] ?? '';
  const types: string[] = [];
  let name = '';
  for (let i = 1; i < seg.length; i += 2) {
    types.push(seg[i] ?? '');
    name = seg[i + 1] ?? name;
  }
  return { subscriptionId: sub ?? null, resourceGroup: rg ?? null, type: [ns, ...types].join('/'), name };
}

function joinPath(parent: string, child: string): string {
  if (!parent) return child;
  if (!child) return parent;
  return child.startsWith('[') ? parent + child : `${parent}.${child}`;
}

function flatten(deltas: RawDelta[], parent: string, out: PropertyChange[], budget: { left: number }): void {
  for (const d of deltas) {
    if (budget.left <= 0) return;
    const path = joinPath(parent, d.path ?? '');
    if (Array.isArray(d.children) && d.children.length > 0) {
      flatten(d.children, path, out, budget);
    } else {
      out.push({ path, changeType: d.propertyChangeType ?? 'Unknown', before: d.before, after: d.after });
      budget.left -= 1;
    }
  }
}

function bounded(state: unknown): unknown {
  if (state === undefined) return undefined;
  return canonicalJson(state).length <= MAX_STATE_BYTES ? state : undefined;
}

/** Parses the JSON from `az deployment group|sub what-if --no-pretty-print` (also accepts the REST shape). */
export function parseWhatIf(raw: unknown): PerceptionOutput {
  if (raw === null || typeof raw !== 'object')
    throw new PerceptionError('What-If payload must be a JSON object');
  const root = raw as Record<string, unknown>;
  const body = (root.properties && typeof root.properties === 'object' ? root.properties : root) as Record<
    string,
    unknown
  >;
  const status = (root.status ?? body.status) as string | undefined;
  if (root.error)
    throw new PerceptionError('What-If payload contains an error object; the preview did not complete');
  if (status && status.toLowerCase() !== 'succeeded')
    throw new PerceptionError(`What-If status is "${status}", expected Succeeded`);
  if (!Array.isArray(body.changes)) throw new PerceptionError('What-If payload has no "changes" array');

  const warnings: string[] = [];
  const diagnostics = Array.isArray(body.diagnostics) ? (body.diagnostics as unknown[]) : [];
  if (diagnostics.length) warnings.push(`What-If reported ${diagnostics.length} diagnostic message(s)`);

  let truncatedResources = false;
  let changes = body.changes as unknown[];
  if (changes.length > MAX_RESOURCES) {
    truncatedResources = true;
    warnings.push(`What-If has ${changes.length} changes; only the first ${MAX_RESOURCES} were analysed`);
    changes = changes.slice(0, MAX_RESOURCES);
  }

  const resources: ChangedResource[] = [];
  changes.forEach((c, i) => {
    if (c === null || typeof c !== 'object') {
      warnings.push(`changes[${i}] is not an object and was skipped`);
      return;
    }
    const ch = c as Record<string, unknown>;
    const resourceId = typeof ch.resourceId === 'string' ? ch.resourceId : undefined;
    if (!resourceId) {
      warnings.push(`changes[${i}] has no resourceId and was skipped`);
      return;
    }
    const changeType = String(ch.changeType ?? '');
    if (!(CHANGE_TYPES as readonly string[]).includes(changeType)) {
      warnings.push(`changes[${i}] has unknown changeType "${changeType}" and was skipped`);
      return;
    }
    let parsed;
    try {
      parsed = parseResourceId(resourceId);
    } catch {
      warnings.push(`changes[${i}] has an unparseable resourceId and was skipped`);
      return;
    }
    const propertyChanges: PropertyChange[] = [];
    const budget = { left: MAX_PROPERTY_CHANGES };
    if (Array.isArray(ch.delta)) flatten(ch.delta as RawDelta[], '', propertyChanges, budget);
    const truncated = budget.left <= 0;
    if (truncated) warnings.push(`${resourceId}: property changes truncated at ${MAX_PROPERTY_CHANGES}`);
    resources.push({
      resourceId,
      ...parsed,
      changeType: changeType as ChangeType,
      propertyChanges,
      before: bounded(ch.before),
      after: bounded(ch.after),
      truncated,
    });
  });

  if (resources.length === 0 && changes.length > 0)
    throw new PerceptionError('No usable resource changes could be parsed');
  return {
    resources,
    warnings,
    parserVersion: PARSER_VERSION,
    rawSha256: sha256Hex(canonicalJson(raw)),
    truncatedResources,
    diagnostics,
  };
}
