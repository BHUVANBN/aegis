export const fmtDate = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const fmtDay = (day: string): string =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** 45 -> "45 s", 190 -> "3 min 10 s", 7300 -> "2 h 2 min". Null -> an em dash. */
export function fmtDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || Number.isNaN(sec)) return '—';
  if (sec < 1) return '< 1 s';
  if (sec < 60) return `${Math.round(sec)} s`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return s ? `${m} min ${s} s` : `${m} min`;
  }
  if (sec < 86400) {
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  const d = Math.floor(sec / 86400);
  const h = Math.round((sec % 86400) / 3600);
  return h ? `${d} d ${h} h` : `${d} d`;
}

export function fmtAge(iso: string | null | undefined): string {
  if (!iso) return '—';
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  return sec < 60 ? 'just now' : `${fmtDuration(sec)} ago`;
}

export const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((100 * n) / d) : null);
export const fmtPct = (v: number | null): string => (v === null ? '—' : `${v}%`);
export const fmtNum = (n: number): string => new Intl.NumberFormat().format(n);
export const fmtHours = (h: number): string => (h < 10 ? h.toFixed(1) : Math.round(h).toString());
export function fmtMoney(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${currency} ${Math.round(n)}`;
  }
}

export const ACTION_LABELS: Record<string, string> = {
  'assessment.created': 'Assessment submitted',
  'assessment.completed': 'Assessment completed',
  'assessment.failed': 'Assessment failed',
  'approval.requested': 'Approval requested',
  'approval.approved': 'Approval granted',
  'approval.rejected': 'Approval rejected',
  'approval.revoked': 'Approval revoked',
  'deployment.authorized': 'Deployment authorized',
  'deployment.authorize.denied': 'Deployment denied',
  'verification.recorded': 'Deployment verified',
  'reconciliation.run': 'Drift check run',
  'access.granted': 'Access granted',
  'access.revoked': 'Access revoked',
  'project.created': 'Project created',
  'environment.created': 'Environment created',
};
export const actionLabel = (a: string): string => ACTION_LABELS[a] ?? a;
