import type { ChangedResource } from '@aegis/shared';
import { DATABASE_TYPES, NETWORK_SECURITY_TYPES, SENSITIVE_DATA_TYPES } from '../rules/riskRules.js';

export type ResourceClass =
  | 'unchanged'
  | 'metadata-only'
  | 'data-store'
  | 'database'
  | 'network-security'
  | 'identity'
  | 'compute'
  | 'other';

export function isTagOnly(r: ChangedResource): boolean {
  if (r.changeType === 'NoChange' || r.changeType === 'Ignore') return true;
  return (
    r.changeType === 'Modify' &&
    r.propertyChanges.length > 0 &&
    !r.truncated &&
    r.propertyChanges.every((p) => /^tags(\.|\[|$)/i.test(p.path))
  );
}

export function classifyResource(r: ChangedResource): ResourceClass {
  const t = r.type.toLowerCase();
  if (r.changeType === 'NoChange' || r.changeType === 'Ignore') return 'unchanged';
  if (isTagOnly(r)) return 'metadata-only';
  if (DATABASE_TYPES.includes(t)) return 'database';
  if (SENSITIVE_DATA_TYPES.includes(t)) return 'data-store';
  if (NETWORK_SECURITY_TYPES.includes(t)) return 'network-security';
  if (t.startsWith('microsoft.authorization/') || t.startsWith('microsoft.managedidentity/'))
    return 'identity';
  if (
    t.startsWith('microsoft.compute/') ||
    t.startsWith('microsoft.web/') ||
    t.startsWith('microsoft.containerservice/')
  )
    return 'compute';
  return 'other';
}

export function propAfter(r: ChangedResource, path: string): { found: boolean; value: unknown } {
  const pc = r.propertyChanges.find((p) => p.path.toLowerCase() === path.toLowerCase());
  if (pc && pc.changeType !== 'Delete') return { found: true, value: pc.after };
  if (pc && pc.changeType === 'Delete') return { found: true, value: undefined };
  return { found: false, value: undefined };
}
