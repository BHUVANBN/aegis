import type { RiskLevel, Severity } from '@aegis/shared';

/** Versioned risk model. Changing any number below requires bumping RULES_VERSION and updating tests. */
export const RULES_VERSION = 'risk-rules-1.0.0';

export const SEVERITY_POINTS: Record<Severity, number> = {
  info: 0,
  low: 4,
  medium: 12,
  high: 30,
  critical: 55,
};
export const ENV_MULTIPLIER = { dev: 0.6, staging: 1.0, prod: 1.25 } as const;
export const BLAST_POINTS_PER_CONFIRMED_DEPENDENT = 3;
export const BLAST_POINTS_CAP = 15;
/** score < low -> low; < medium -> medium; < high -> high; else critical */
export const THRESHOLDS = { low: 20, medium: 45, high: 70 } as const;
export const CONFIDENCE_PENALTIES = {
  dependencyUnavailable: 0.25,
  dependencyPartial: 0.1,
  policyUnavailable: 0.2,
  policyPartial: 0.1,
  truncated: 0.15,
  perWarning: 0.05,
  maxWarningPenalty: 0.15,
} as const;

export const SENSITIVE_DATA_TYPES = [
  'microsoft.sql/servers',
  'microsoft.sql/servers/databases',
  'microsoft.dbforpostgresql/flexibleservers',
  'microsoft.dbformysql/flexibleservers',
  'microsoft.documentdb/databaseaccounts',
  'microsoft.storage/storageaccounts',
  'microsoft.keyvault/vaults',
  'microsoft.recoveryservices/vaults',
];
export const NETWORK_SECURITY_TYPES = [
  'microsoft.network/networksecuritygroups',
  'microsoft.network/networksecuritygroups/securityrules',
  'microsoft.network/azurefirewalls',
  'microsoft.network/firewallpolicies',
  'microsoft.network/applicationgateways',
  'microsoft.network/virtualnetworks',
  'microsoft.network/virtualnetworks/subnets',
];
export const DATABASE_TYPES = SENSITIVE_DATA_TYPES.filter(
  (t) => !t.includes('storage') && !t.includes('keyvault') && !t.includes('recovery'),
);
export const SENSITIVE_PORTS = [
  '22',
  '3389',
  '1433',
  '3306',
  '5432',
  '5985',
  '5986',
  '445',
  '1521',
  '27017',
  '*',
];
export const BROAD_SOURCES = ['*', 'internet', '0.0.0.0/0', 'any'];

export const ROLE_DEFINITIONS = {
  owner: '8e3af657-a8ff-443c-a75c-2fe8c4bcb635',
  contributor: 'b24988ac-6180-42a0-ab88-20f7382dd24c',
  userAccessAdministrator: '18d7d88d-d35e-4fb5-a5c3-7773c20a72d9',
} as const;

export const LEVEL_ORDER: RiskLevel[] = ['low', 'medium', 'high', 'critical'];
export function maxLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  return LEVEL_ORDER.indexOf(a) >= LEVEL_ORDER.indexOf(b) ? a : b;
}
/** Severity floor: a finding of this severity forces at least this overall level. */
export const SEVERITY_FLOOR: Record<Severity, RiskLevel | null> = {
  info: null,
  low: null,
  medium: 'medium',
  high: 'high',
  critical: 'critical',
};
