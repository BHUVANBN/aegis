import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

// ---------- status badges: colour is never the only signal (each tone has its own shape and a text label)
export type Tone = 'ok' | 'info' | 'warn' | 'high' | 'bad' | 'none';
const TONES: Record<string, Tone> = {
  low: 'ok',
  allow: 'ok',
  complete: 'ok',
  approved: 'ok',
  passed: 'ok',
  succeeded: 'ok',
  consumed: 'info',
  medium: 'warn',
  require_approval: 'warn',
  partial: 'warn',
  pending: 'warn',
  running: 'info',
  authorized: 'info',
  inconclusive: 'warn',
  partially_verified: 'warn',
  high: 'high',
  critical: 'bad',
  block: 'bad',
  failed: 'bad',
  rejected: 'bad',
  revoked: 'bad',
  expired: 'bad',
};
export const toneOf = (kind: string): Tone => TONES[kind] ?? 'none';

export function Glyph({ tone }: { tone: Tone }) {
  return (
    <svg className="glyph" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
      {tone === 'ok' && <path d="M2 6.5l2.6 2.6L10 3.4" fill="none" stroke="currentColor" strokeWidth="2" />}
      {tone === 'info' && <circle cx="6" cy="6" r="3.6" fill="currentColor" />}
      {tone === 'warn' && <path d="M6 1.5l5 9H1z" fill="currentColor" />}
      {tone === 'high' && <path d="M6 1l5 5-5 5-5-5z" fill="currentColor" />}
      {tone === 'bad' && <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" fill="none" stroke="currentColor" strokeWidth="2" />}
      {tone === 'none' && <path d="M2.5 6h7" fill="none" stroke="currentColor" strokeWidth="2" />}
    </svg>
  );
}
export function Badge({ kind, children }: { kind: string; children: ReactNode }) {
  const tone = toneOf(kind);
  return (
    <span className={`badge tone-${tone} badge-${kind}`}>
      <Glyph tone={tone} />
      {children}
    </span>
  );
}
export const levelBadge = (l: string | null) =>
  l ? <Badge kind={l}>{l.toUpperCase()}</Badge> : <Badge kind="none">n/a</Badge>;
export const gateLabel: Record<string, string> = {
  allow: 'Allowed',
  require_approval: 'Approval required',
  block: 'Blocked',
};
export const gateBadge = (d: string | null) =>
  d ? <Badge kind={d}>{gateLabel[d] ?? d}</Badge> : <Badge kind="none">Pending</Badge>;
export const statusBadge = (s: string) => <Badge kind={s}>{s.replace(/_/g, ' ')}</Badge>;

// ---------- feedback
export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <p role="status" aria-live="polite" className="muted loading">
      <span className="spinner" aria-hidden="true" />
      {label}…
    </p>
  );
}
export function ErrorBox({ error }: { error: unknown }) {
  const e = error as { status?: number; message?: string } | null;
  const missing = e?.status === 404 && /route not found/i.test(e.message ?? '');
  return (
    <div role="alert" className="error">
      {missing
        ? 'This screen needs the updated AEGIS API (it adds the metrics, status and setup endpoints). Apply api-additions/ from the upgrade package, rebuild the API image and redeploy.'
        : (e?.message ?? 'Something went wrong')}
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'ok' | 'warn' | 'error';
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {title && <strong>{title}</strong>}
      <div>{children}</div>
    </div>
  );
}

/** Small data-loading hook: loading / error / data with manual reload. */
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

// ---------- structure
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · AEGIS`;
  }, [title]);
  return (
    <div className="page-head">
      <div>
        <h1 id="page-title" tabIndex={-1}>
          {title}
        </h1>
        {subtitle && <p className="lead">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
export function Section({
  title,
  actions,
  children,
  className,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section className={`card ${className ?? ''}`} aria-labelledby={id}>
      <div className="card-head">
        <h2 id={id}>{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
export function KpiCard({
  label,
  value,
  hint,
  basis,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  basis: 'measured' | 'estimated' | 'status';
}) {
  return (
    <div className="kpi" role="group" aria-label={label}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {hint && <div className="kpi-hint">{hint}</div>}
      <span className={`basis basis-${basis}`}>
        {basis === 'measured' ? 'Measured' : basis === 'estimated' ? 'Estimate' : 'Status'}
      </span>
    </div>
  );
}

// ---------- tabs (arrow keys, Home/End)
export function Tabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
}: {
  label: string;
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    let n = i;
    if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = tabs.length - 1;
    else return;
    e.preventDefault();
    const t = tabs[n]!;
    onChange(t.id);
    refs.current[t.id]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="tablist">
      {tabs.map((t, i) => (
        <button
          key={t.id}
          type="button"
          ref={(el) => {
            refs.current[t.id] = el;
          }}
          role="tab"
          id={`tab-${t.id}`}
          aria-selected={value === t.id}
          aria-controls={`panel-${t.id}`}
          tabIndex={value === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
export const tabPanelProps = (id: string) => ({
  role: 'tabpanel' as const,
  id: `panel-${id}`,
  'aria-labelledby': `tab-${id}`,
  tabIndex: 0,
});

// ---------- modal dialog with focus trap, Escape to close, focus returned to the opener
export function Dialog({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const el = ref.current!;
    const focusables = (): HTMLElement[] =>
      Array.from(
        el.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ),
      );
    (focusables()[0] ?? el).focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'Tab') {
        const f = focusables();
        if (f.length === 0) return;
        const first = f[0]!;
        const last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
      opener?.focus();
    };
  }, []);
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <h2 id={titleId}>{title}</h2>
        {children}
        {footer && <div className="dialog-actions">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- forms
export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && (
        <div id={`${id}-hint`} className="hint">
          {hint}
        </div>
      )}
      {children}
      {error && (
        <div id={`${id}-err`} className="field-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
export const describedBy = (id: string, hint: boolean, err: boolean): string | undefined =>
  [hint ? `${id}-hint` : '', err ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      window.setTimeout(() => setDone(false), 2000);
    } catch {
      window.prompt('Copy this text:', text);
    }
  };
  return (
    <>
      <button type="button" className="secondary" onClick={() => void copy()}>
        {done ? 'Copied' : label}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {done ? 'Copied to clipboard' : ''}
      </span>
    </>
  );
}

// ---------- tables
export function DataTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: { key: string; label: string; render?: (v: unknown, row: Record<string, unknown>) => ReactNode }[];
  rows: Record<string, unknown>[];
}) {
  if (rows.length === 0) return <Empty>No {caption.toLowerCase()} recorded.</Empty>;
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label={caption}>
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={String(r.id ?? i)}>
              {columns.map((c) => (
                <td key={c.key}>{c.render ? c.render(r[c.key], r) : String(r[c.key] ?? '')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
