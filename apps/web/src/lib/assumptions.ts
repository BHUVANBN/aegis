import type { MetricsSummary } from '../api';

/**
 * The "estimated value" numbers are NOT measurements. They multiply measured counts by assumptions the reader can see and change.
 * Defaults are placeholders, not benchmarks: replace them with your own team's figures (or measure them in a pilot).
 */
export interface Assumptions {
  /** Minutes a person would spend reviewing one change without AEGIS, by risk level. */
  manualMinutes: Record<'low' | 'medium' | 'high' | 'critical', number>;
  /** Minutes a person still spends per change WITH AEGIS, by gate decision. */
  assistedMinutes: Record<'allow' | 'require_approval' | 'block', number>;
  hourlyRate: number;
  currency: string;
  /** Optional: what one serious incident would cost. 0 hides the avoided-incident line. */
  incidentCost: number;
}
export const DEFAULT_ASSUMPTIONS: Assumptions = {
  manualMinutes: { low: 15, medium: 45, high: 90, critical: 120 },
  assistedMinutes: { allow: 0, require_approval: 20, block: 10 },
  hourlyRate: 50,
  currency: 'USD',
  incidentCost: 0,
};
const KEY = 'aegis.assumptions';

export function loadAssumptions(): Assumptions {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_ASSUMPTIONS;
    const p = JSON.parse(raw) as Partial<Assumptions>;
    return {
      manualMinutes: { ...DEFAULT_ASSUMPTIONS.manualMinutes, ...p.manualMinutes },
      assistedMinutes: { ...DEFAULT_ASSUMPTIONS.assistedMinutes, ...p.assistedMinutes },
      hourlyRate: Number.isFinite(p.hourlyRate) ? Number(p.hourlyRate) : DEFAULT_ASSUMPTIONS.hourlyRate,
      currency: typeof p.currency === 'string' && p.currency.length === 3 ? p.currency.toUpperCase() : DEFAULT_ASSUMPTIONS.currency,
      incidentCost: Number.isFinite(p.incidentCost) ? Number(p.incidentCost) : 0,
    };
  } catch {
    return DEFAULT_ASSUMPTIONS;
  }
}
export function saveAssumptions(a: Assumptions): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    /* kept for this visit only */
  }
}
export function resetAssumptions(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}

export interface ValueRow {
  level: string;
  decision: string;
  count: number;
  manualMin: number;
  assistedMin: number;
  savedHours: number;
}
export interface ValueEstimate {
  rows: ValueRow[];
  hoursSaved: number;
  moneySaved: number;
  incidentAvoided: number;
  changesCounted: number;
}
export function estimateValue(m: MetricsSummary, a: Assumptions): ValueEstimate {
  const rows: ValueRow[] = [];
  let hours = 0;
  let counted = 0;
  for (const r of m.byLevelDecision) {
    const manual = (a.manualMinutes as Record<string, number>)[r.level];
    const assisted = (a.assistedMinutes as Record<string, number>)[r.decision];
    if (manual === undefined || assisted === undefined) continue;
    const savedHours = (r.count * Math.max(0, manual - assisted)) / 60;
    rows.push({ level: r.level, decision: r.decision, count: r.count, manualMin: manual, assistedMin: assisted, savedHours });
    hours += savedHours;
    counted += r.count;
  }
  return {
    rows,
    hoursSaved: hours,
    moneySaved: hours * a.hourlyRate,
    incidentAvoided: m.totals.block * a.incidentCost,
    changesCounted: counted,
  };
}
