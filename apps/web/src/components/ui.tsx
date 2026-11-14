import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
  type KeyboardEvent,
} from 'react';

/* ============================================================
   BADGE
   ============================================================ */
export interface BadgeProps {
  kind: string;
  children: ReactNode;
}

export function Badge({ kind, children }: BadgeProps) {
  return <span className={`badge badge-${kind}`}>{children}</span>;
}

/* ============================================================
   RISK BADGE  (larger, dot + text)
   ============================================================ */
export interface RiskBadgeProps {
  level: string | null;
}

const RISK_DOT_COLORS: Record<string, string> = {
  low: 'var(--risk-low)',
  medium: 'var(--risk-medium)',
  high: 'var(--risk-high)',
  critical: 'var(--risk-critical)',
};

export function RiskBadge({ level }: RiskBadgeProps) {
  if (!level) return <Badge kind="none">n/a</Badge>;
  const color = RISK_DOT_COLORS[level] ?? 'var(--text-secondary)';
  return (
    <span
      className={`risk-badge badge-${level}`}
      role="status"
      aria-label={`Risk level: ${level}`}
    >
      <span
        className="risk-dot"
        style={{ background: color }}
        aria-hidden="true"
      />
      {level.toUpperCase()}
    </span>
  );
}

/* ============================================================
   GATE BADGE  (prominent allow / require_approval / block)
   ============================================================ */
export interface GateBadgeProps {
  gate?: string | null;
  decision?: string | null;
  value?: string | null;
  compact?: boolean;
}

const GATE_ICONS: Record<string, string> = {
  allow: '✓',
  require_approval: '⏳',
  block: '✕',
};

const GATE_LABELS_DISPLAY: Record<string, string> = {
  allow: 'ALLOW',
  require_approval: 'REQUIRE APPROVAL',
  block: 'BLOCK',
};

export function GateBadge({ gate, decision, value, compact }: GateBadgeProps) {
  const g = gate ?? decision ?? value ?? null;
  if (!g) return <Badge kind="none">n/a</Badge>;
  const icon = GATE_ICONS[g] ?? '';
  const label = compact
    ? (g === 'require_approval' ? 'APPROVAL' : g.toUpperCase())
    : (GATE_LABELS_DISPLAY[g] ?? g.toUpperCase());
  return (
    <span
      className={`gate-badge gate-badge-${g}${compact ? ' gate-badge-compact' : ''}`}
      role="status"
      aria-label={`Gate decision: ${label}`}
    >
      <span aria-hidden="true">{icon}</span>
      {label}
    </span>
  );
}

/* ============================================================
   HELPER EXPORTS for API compat
   ============================================================ */
export const levelBadge = (l: string | null) =>
  l ? <Badge kind={l}>{l.toUpperCase()}</Badge> : <Badge kind="none">n/a</Badge>;

export const gateLabel: Record<string, string> = {
  allow: 'Allowed',
  require_approval: 'Approval required',
  block: 'Blocked',
};

/* ============================================================
   LOADING  (pure-CSS spinner + optional label)
   ============================================================ */
export interface LoadingProps {
  label?: string;
  size?: 'sm' | 'md';
}

export function Loading({ label = 'Loading', size = 'md' }: LoadingProps) {
  return (
    <div
      className="spinner-wrap"
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className={`spinner${size === 'sm' ? ' spinner-sm' : ''}`} aria-hidden="true" />
      {size !== 'sm' && (
        <span className="muted" style={{ fontSize: 13 }}>
          {label}…
        </span>
      )}
    </div>
  );
}

/* ============================================================
   ERROR BOX
   ============================================================ */
export interface ErrorBoxProps {
  error?: unknown;
  message?: string;
  onRetry?: () => void;
}

export function ErrorBox({ error, message, onRetry }: ErrorBoxProps) {
  const msg =
    message ??
    (error as Error)?.message ??
    (typeof error === 'string' ? error : 'Something went wrong.');
  return (
    <div
      role="alert"
      className="error-box"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span aria-hidden="true" style={{ fontSize: 16 }}>⚠</span>
        <span>{msg}</span>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="btn-secondary"
          style={{ padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}
        >
          Retry
        </button>
      )}
    </div>
  );
}

/* ============================================================
   ALERT BANNER  (info / warning / error / success)
   ============================================================ */
export interface AlertProps {
  kind: 'info' | 'warning' | 'error' | 'success';
  children: ReactNode;
  onClose?: () => void;
}

const ALERT_ICONS: Record<AlertProps['kind'], string> = {
  info: 'ℹ',
  warning: '⚠',
  error: '✕',
  success: '✓',
};

export function Alert({ kind, children, onClose }: AlertProps) {
  return (
    <div role="alert" className={`alert alert-${kind}`}>
      <span aria-hidden="true" style={{ fontSize: 16, flexShrink: 0, fontStyle: 'normal' }}>
        {ALERT_ICONS[kind]}
      </span>
      <span style={{ flex: 1 }}>{children}</span>
      {onClose && (
        <button
          onClick={onClose}
          aria-label="Dismiss"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '0 2px',
            color: 'inherit',
            fontSize: 16,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

/* ============================================================
   EMPTY STATE
   ============================================================ */
export interface EmptyProps {
  children: ReactNode;
  icon?: string;
}

export function Empty({ children, icon }: EmptyProps) {
  return (
    <div className="empty-state">
      {icon && <span className="empty-state-icon" aria-hidden="true">{icon}</span>}
      <p className="empty-state-text">{children}</p>
    </div>
  );
}

/* ============================================================
   CARD
   ============================================================ */
export interface CardProps {
  children: ReactNode;
  className?: string;
  elevated?: boolean;
  style?: React.CSSProperties;
  onClick?: () => void;
}

export function Card({ children, className = '', elevated = false, style, onClick }: CardProps) {
  return (
    <div
      className={`card${elevated ? ' card-elevated' : ''}${className ? ' ' + className : ''}`}
      style={style}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

/* ============================================================
   PAGE HEADER
   ============================================================ */
export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  action?: ReactNode;
  id?: string;
}

export function PageHeader({ title, subtitle, actions, action, id }: PageHeaderProps) {
  const acts = actions ?? action;
  return (
    <div className="page-header" id={id}>
      <div className="page-header-text">
        <h1>{title}</h1>
        {subtitle && <p className="page-header-sub">{subtitle}</p>}
      </div>
      {acts && <div className="page-header-actions">{acts}</div>}
    </div>
  );
}

/* ============================================================
   STAT CARD  (metric number + label + optional trend)
   ============================================================ */
export interface StatCardProps {
  value: ReactNode;
  label: string;
  trend?: string;
  trendDir?: 'up' | 'down' | 'neutral';
  accent?: string;
  sub?: string;
  icon?: string;
}

export function StatCard({
  value,
  label,
  trend,
  trendDir = 'neutral',
  accent,
  sub,
  icon,
}: StatCardProps) {
  return (
    <div className="stat-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div
          className="stat-value"
          style={accent ? { color: accent } : undefined}
        >
          {value}
        </div>
        {icon && <span style={{ fontSize: 18, opacity: 0.8 }} aria-hidden="true">{icon}</span>}
      </div>
      <div className="stat-label">{label}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{sub}</div>}
      {trend && (
        <div
          className={`stat-trend${trendDir === 'up' ? ' stat-trend-up' : trendDir === 'down' ? ' stat-trend-down' : ''}`}
        >
          {trend}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   DATA TABLE  (sortable, hover rows, sticky header)
   ============================================================ */
export interface Column {
  key: string;
  label: string;
  sortable?: boolean;
  render?: (value: unknown, row: Record<string, unknown>) => ReactNode;
}

export interface DataTableProps {
  caption: string;
  columns: Column[];
  rows: Record<string, unknown>[];
  rowKey?: (row: Record<string, unknown>, i: number) => string;
}

type SortDir = 'asc' | 'desc';

export function DataTable({ caption, columns, rows, rowKey }: DataTableProps) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  if (rows.length === 0) {
    return <Empty>No {caption.toLowerCase()} recorded.</Empty>;
  }

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sorted = sortKey
    ? [...rows].sort((a, b) => {
        const av = a[sortKey] ?? '';
        const bv = b[sortKey] ?? '';
        const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
        return sortDir === 'asc' ? cmp : -cmp;
      })
    : rows;

  return (
    <div
      className="table-wrap"
      tabIndex={0}
      role="region"
      aria-label={caption}
    >
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={
                  c.sortable
                    ? `sortable${sortKey === c.key ? ` sort-${sortDir}` : ''}`
                    : undefined
                }
                aria-sort={
                  c.sortable && sortKey === c.key
                    ? sortDir === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : c.sortable
                    ? 'none'
                    : undefined
                }
                onClick={c.sortable ? () => handleSort(c.key) : undefined}
                onKeyDown={
                  c.sortable
                    ? (e: KeyboardEvent<HTMLTableCellElement>) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleSort(c.key);
                        }
                      }
                    : undefined
                }
                tabIndex={c.sortable ? 0 : undefined}
              >
                {c.label}
                {c.sortable && (
                  <i className="sort-icon" aria-hidden="true">
                    {sortKey === c.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ↕'}
                  </i>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={rowKey ? rowKey(r, i) : String(r.id ?? i)}>
              {columns.map((c) => (
                <td key={c.key}>
                  {c.render ? c.render(r[c.key], r) : String(r[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ============================================================
   TABS  (Fluent bottom-border style, keyboard nav)
   ============================================================ */
export interface Tab {
  id?: string;
  key?: string;
  label: string;
  count?: number;
}

export interface TabsProps {
  tabs: Tab[];
  active: string;
  onChange: (id: string) => void;
}

export function Tabs({ tabs, active, onChange }: TabsProps) {
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const getTabId = (t?: Tab) => t?.id ?? t?.key ?? '';

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    if (tabs.length === 0) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = tabs[(idx + 1) % tabs.length];
      const tid = getTabId(next);
      if (tid) {
        tabRefs.current.get(tid)?.focus();
        onChange(tid);
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
      const tid = getTabId(prev);
      if (tid) {
        tabRefs.current.get(tid)?.focus();
        onChange(tid);
      }
    } else if (e.key === 'Home') {
      e.preventDefault();
      const first = tabs[0];
      const tid = getTabId(first);
      if (tid) {
        tabRefs.current.get(tid)?.focus();
        onChange(tid);
      }
    } else if (e.key === 'End') {
      e.preventDefault();
      const last = tabs[tabs.length - 1];
      const tid = getTabId(last);
      if (tid) {
        tabRefs.current.get(tid)?.focus();
        onChange(tid);
      }
    }
  };

  return (
    <div className="tabs" role="tablist" aria-label="Tabs">
      {tabs.map((t, idx) => {
        const tid = getTabId(t);
        return (
          <button
            key={tid}
            role="tab"
            aria-selected={active === tid}
            id={`tab-${tid}`}
            aria-controls={`tabpanel-${tid}`}
            tabIndex={active === tid ? 0 : -1}
            ref={(el) => {
              if (el) tabRefs.current.set(tid, el);
            }}
            onClick={() => onChange(tid)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
          >
            {t.label}
            {t.count !== undefined && (
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 11,
                  padding: '1px 6px',
                  borderRadius: 10,
                  background: active === tid ? 'var(--ms-blue-light, #deecf9)' : 'var(--bg-tertiary, #edebe9)',
                  color: active === tid ? 'var(--ms-blue, #0078d4)' : 'inherit',
                  fontWeight: 600,
                }}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ============================================================
   PAGINATION  (prev / page N of M / next)
   ============================================================ */
export interface PaginationProps {
  page: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
}

export function Pagination({ page, total, pageSize, onChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pagination" aria-label="Pagination">
      <button
        className="secondary"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
      >
        ← Previous
      </button>
      <span className="pagination-info" aria-current="page">
        Page {page} of {totalPages}
      </span>
      <button
        className="secondary"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        aria-label="Next page"
      >
        Next →
      </button>
    </div>
  );
}

/* ============================================================
   MODAL  (accessible dialog with backdrop)
   ============================================================ */
export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({ open, title, onClose, children, footer }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    // Focus dialog on open
    dialogRef.current?.focus();
    return () => {
      prev?.focus();
    };
  }, [open]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className="modal-card"
        tabIndex={-1}
      >
        <div className="modal-header">
          <h2 id="modal-title">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              fontSize: 20,
              padding: '0 4px',
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

/* ============================================================
   useLoad  (data-fetching hook — unchanged API)
   ============================================================ */
export function useLoad<T>(
  fn: () => Promise<T>,
  deps: unknown[],
): { data: T | null; error: unknown; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    fn()
      .then((d) => {
        if (live) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (live) setError(e);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [...deps, tick]);

  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}
