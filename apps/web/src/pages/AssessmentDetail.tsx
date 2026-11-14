import { useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { z } from 'zod';
import { api } from '../api';
import { useAuth } from '../auth';
import DependencyGraph from '../components/DependencyGraph';
import { Badge, Card, Empty, ErrorBox, GateBadge, Loading, Tabs, useLoad } from '../components/ui';

const TABS = [
  'summary',
  'review',
  'graph',
  'hypotheses',
  'resources',
  'dependencies',
  'policy-findings',
  'risk',
  'scenarios',
  'recommendations',
  'audit',
] as const;
type Tab = (typeof TABS)[number];
const justification = z.string().min(10, 'Justification must be at least 10 characters').max(2000);

// ── helpers ──────────────────────────────────────────────────────────────────

function getRiskColor(level: string | null): string {
  switch ((level ?? '').toLowerCase()) {
    case 'low': return 'var(--risk-low)';
    case 'medium': return 'var(--risk-medium)';
    case 'high': return 'var(--risk-high)';
    case 'critical': return 'var(--risk-critical)';
    default: return 'var(--border-strong)';
  }
}

/** Visual progress bar for a 0–100 risk score */
function RiskScoreBar({ score, level }: { score: number | null; level: string | null }) {
  const pct = Math.min(100, Math.max(0, score ?? 0));
  const color = getRiskColor(level);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
      <div
        style={{
          flex: 1,
          height: 10,
          borderRadius: 5,
          background: 'var(--border-default)',
          overflow: 'hidden',
        }}
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Risk score ${pct} out of 100`}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: color,
            borderRadius: 5,
            transition: 'width 0.4s ease',
          }}
        />
      </div>
      <span style={{ fontWeight: 700, fontSize: '1.25rem', color, minWidth: 36, textAlign: 'right' }}>
        {score ?? 'n/a'}
      </span>
    </div>
  );
}

/** Horizontal stacked bar for blast radius */
const BLAST_COLORS = [
  '#0078d4', '#00b7c3', '#107c10', '#ca5010', '#c50f1f', '#750b1c',
  '#8764b8', '#038387', '#005a9e', '#a4262c',
];
function BlastRadiusBar({ blastRadius }: { blastRadius: Record<string, number> }) {
  const entries = Object.entries(blastRadius);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total === 0) return <p style={{ color: 'var(--text-secondary)' }}>No blast radius data.</p>;
  return (
    <div>
      <div
        style={{ display: 'flex', height: 24, borderRadius: 'var(--radius-sm)', overflow: 'hidden', marginBottom: '0.6rem' }}
        role="img"
        aria-label="Blast radius by resource type"
      >
        {entries.map(([k, v], i) => (
          <div
            key={k}
            title={`${k}: ${v}`}
            style={{
              width: `${(v / total) * 100}%`,
              background: BLAST_COLORS[i % BLAST_COLORS.length],
              minWidth: v > 0 ? 2 : 0,
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem' }}>
        {entries.map(([k, v], i) => (
          <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.8rem' }}>
            <span
              style={{ width: 10, height: 10, borderRadius: 2, background: BLAST_COLORS[i % BLAST_COLORS.length], display: 'inline-block' }}
            />
            <span style={{ color: 'var(--text-secondary)' }}>{k}</span>
            <strong>{v}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AssessmentDetail() {
  const { id = '' } = useParams();
  const [tab, setTab] = useState<Tab>('summary');
  const [copied, setCopied] = useState(false);
  const a = useLoad(() => api.assessment(id), [id]);
  const g = useLoad(() => api.gate(id), [id]);
  if (a.loading) return <Loading />;
  if (a.error) return <ErrorBox error={a.error} />;
  const x = a.data!;
  const d = x.risk_detail;

  const copyId = () => {
    void navigator.clipboard.writeText(x.id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <article aria-labelledby="h-detail">
      {/* Page header */}
      <div style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <h1 id="h-detail" style={{ margin: 0, fontSize: '1.4rem' }}>
            Assessment <code style={{ fontSize: '1rem' }}>{x.id.slice(0, 8)}</code>
          </h1>
          <button
            onClick={copyId}
            aria-label="Copy full assessment ID"
            title="Copy full assessment ID"
            style={{
              background: 'none',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-sm)',
              padding: '2px 8px',
              cursor: 'pointer',
              fontSize: '0.75rem',
              color: copied ? 'var(--risk-low)' : 'var(--text-secondary)',
              transition: 'color 0.2s',
            }}
          >
            {copied ? '✓ Copied' : 'Copy ID'}
          </button>
          <span style={{ color: 'var(--text-secondary)' }}>—</span>
          <span style={{ fontWeight: 500 }}>{x.environment}</span>
          <Badge kind={x.status}>{x.status}</Badge>
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        tabs={TABS.map((t) => ({ id: t, key: t, label: t.replace('-', ' ') }))}
        active={tab}
        onChange={(k) => setTab(k as Tab)}
      />

      <div role="tabpanel" style={{ paddingTop: '1.25rem' }}>
        {tab === 'summary' && (
          <SummaryTab id={id} x={x} d={d} g={g} />
        )}
        {tab === 'risk' && <RiskTab id={id} />}
        {tab === 'review' && <ReviewTab id={id} />}
        {tab === 'graph' && <GraphTab id={id} />}
        {tab === 'hypotheses' && <HypothesesTab id={id} />}
        {!['summary', 'risk', 'review', 'graph', 'hypotheses'].includes(tab) && (
          <ListTab id={id} part={tab} />
        )}
      </div>
    </article>
  );
}

// ── Summary tab ───────────────────────────────────────────────────────────────

function SummaryTab({
  id,
  x,
  d,
  g,
}: {
  id: string;
  x: Awaited<ReturnType<typeof api.assessment>>;
  d: Awaited<ReturnType<typeof api.assessment>>['risk_detail'];
  g: ReturnType<typeof useLoad<Awaited<ReturnType<typeof api.gate>>>>;
}) {
  // Determine gate decision for the banner
  const decision = g.data?.decision ?? null;

  const bannerStyle: React.CSSProperties = {
    padding: '1rem 1.25rem',
    borderRadius: 'var(--radius-md)',
    marginBottom: '1.25rem',
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    ...(decision === 'allow'
      ? { background: 'var(--risk-low-bg)', borderLeft: '4px solid var(--gate-allow)', color: '#0a5a0a' }
      : decision === 'require_approval'
        ? { background: '#fff4ce', borderLeft: '4px solid var(--gate-approval)', color: '#7a3800' }
        : decision === 'block'
          ? { background: 'var(--risk-high-bg)', borderLeft: '4px solid var(--gate-block)', color: '#7a0000' }
          : { background: 'var(--bg-subtle)', borderLeft: '4px solid var(--border-strong)', color: 'var(--text-secondary)' }),
  };

  return (
    <>
      {/* Gate decision banner */}
      {g.loading ? (
        <Loading label="Loading gate decision" />
      ) : g.error ? (
        <ErrorBox error={g.error} />
      ) : g.data ? (
        <div style={bannerStyle} role="status" aria-live="polite">
          <span style={{ fontSize: '1.4rem' }}>
            {decision === 'allow' ? '✅' : decision === 'require_approval' ? '⚠️' : decision === 'block' ? '🚫' : '❓'}
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '1rem', letterSpacing: '0.03em', textTransform: 'uppercase' }}>
              Gate decision: <GateBadge decision={decision} />
            </div>
            {g.data.reasons.length > 0 && (
              <ul style={{ margin: '0.4rem 0 0 1.2rem', padding: 0, fontSize: '0.875rem' }}>
                {g.data.reasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
            )}
          </div>
          {g.data.approval && (
            <div style={{ textAlign: 'right', fontSize: '0.8rem' }}>
              <div>Approval: <Badge kind={g.data.approval.status}>{g.data.approval.status}</Badge></div>
              {g.data.approval.expires_at && (
                <div style={{ marginTop: 2, color: 'inherit', opacity: 0.75 }}>
                  Expires {new Date(g.data.approval.expires_at).toLocaleString()}
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}

      {/* Approval request form (require_approval gate, no existing approval) */}
      {g.data?.decision === 'require_approval' && !g.data.approval && (
        <GatePanel id={id} gate={g.data} onChange={g.reload} />
      )}

      {x.status !== 'complete' && (
        <div role="alert" style={{
          background: '#fff4ce',
          border: '1px solid #ca5010',
          borderRadius: 'var(--radius-md)',
          padding: '0.75rem 1rem',
          marginBottom: '1rem',
          color: '#7a3800',
          fontSize: '0.875rem',
        }}>
          This assessment is <strong>{x.status}</strong>. It is not a statement that the change is safe.
        </div>
      )}

      {/* Risk score */}
      <Card style={{ marginBottom: '1rem', padding: '1rem 1.25rem' }}>
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
          Risk score
        </h3>
        <RiskScoreBar score={x.risk_score} level={x.risk_level} />
        <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          {x.risk_level && (
            <span>Level: <Badge kind={x.risk_level.toLowerCase()}>{x.risk_level.toUpperCase()}</Badge></span>
          )}
          {x.confidence && <span>Confidence: <strong>{x.confidence}</strong></span>}
        </div>
      </Card>

      {/* Blast radius */}
      {d?.blastRadius && Object.keys(d.blastRadius).length > 0 && (
        <Card style={{ marginBottom: '1rem', padding: '1rem 1.25rem' }}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
            Blast radius
          </h3>
          <BlastRadiusBar blastRadius={d.blastRadius} />
        </Card>
      )}

      {/* Missing evidence */}
      {d?.missingEvidence && d.missingEvidence.length > 0 && (
        <Card style={{ marginBottom: '1rem', padding: '1rem 1.25rem', background: '#fff4ce', border: '1px solid var(--risk-medium)' }}>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem', color: 'var(--risk-medium)' }}>⚠ Missing evidence</h3>
          <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.875rem' }}>
            {d.missingEvidence.map((m) => <li key={m}>{m}</li>)}
          </ul>
        </Card>
      )}

      {/* AI narrative */}
      {x.narrative && (
        <Card style={{ marginBottom: '1rem', padding: '1rem 1.25rem' }}>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
            AI-generated summary <span style={{ textTransform: 'none', fontStyle: 'italic', fontSize: '0.8rem' }}>(advisory only)</span>
          </h3>
          <p style={{ margin: 0 }}>{x.narrative}</p>
        </Card>
      )}

      {/* Meta */}
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', marginTop: '1rem' }}>
        Artifact <code>{x.artifact_digest}</code> · rules {x.rules_version ?? 'n/a'} · parser {x.parser_version ?? 'n/a'}
      </p>
    </>
  );
}

// ── Gate panel (approval request form) ────────────────────────────────────────

function GatePanel({
  id,
  gate,
  onChange,
}: {
  id: string;
  gate: NonNullable<ReturnType<typeof useLoad<Awaited<ReturnType<typeof api.gate>>>>['data']>;
  onChange: () => void;
}) {
  const { me } = useAuth();
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const canRequest = me?.tokenRoles.some((r) => ['assessor', 'approver', 'admin'].includes(r));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = justification.safeParse(text);
    if (!v.success) { setErr(v.error.issues[0]!.message); return; }
    setSubmitting(true);
    try {
      await api.requestApproval(id, v.data);
      setText('');
      setErr(null);
      onChange();
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!canRequest) return null;

  return (
    <Card style={{ marginBottom: '1rem', padding: '1rem 1.25rem' }}>
      <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.9rem' }}>Request approval</h3>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <label htmlFor="just" style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.4rem' }}>
          Justification for approvers
        </label>
        <textarea
          id="just"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          aria-invalid={!!err}
          aria-describedby={err ? 'just-err' : undefined}
          style={{ width: '100%', boxSizing: 'border-box' }}
        />
        {err && <p id="just-err" role="alert" style={{ color: 'var(--risk-high)', fontSize: '0.85rem', margin: '0.25rem 0' }}>{err}</p>}
        <button type="submit" disabled={submitting} style={{ marginTop: '0.5rem' }}>
          {submitting ? 'Submitting…' : 'Request approval'}
        </button>
      </form>
    </Card>
  );
}

// ── Risk tab ──────────────────────────────────────────────────────────────────

function RiskTab({ id }: { id: string }) {
  const r = useLoad(() => api.risk(id), [id]);
  if (r.loading) return <Loading />;
  if (r.error) return <ErrorBox error={r.error} />;
  const contribs = r.data!.contributions;
  const maxPoints = Math.max(...contribs.map((c) => Number(c.points) || 0), 1);

  return (
    <>
      <h2 style={{ fontSize: '1rem', marginBottom: '1rem' }}>Score contributions</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {contribs.map((c) => {
          const pts = Number(c.points) || 0;
          const pct = (pts / maxPoints) * 100;
          return (
            <Card key={c.factor} style={{ padding: '0.75rem 1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.4rem' }}>
                <span style={{ fontWeight: 600, minWidth: 140, fontSize: '0.875rem' }}>{c.factor}</span>
                <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--border-default)', overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: 'var(--ms-blue)', borderRadius: 4, transition: 'width 0.3s' }} />
                </div>
                <span style={{ fontWeight: 700, minWidth: 36, textAlign: 'right', color: 'var(--ms-blue)' }}>
                  {c.points}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{c.explanation}</p>
            </Card>
          );
        })}
      </div>
    </>
  );
}

// ── Hypotheses tab (expandable cards) ─────────────────────────────────────────

type Hypothesis = { resourceClass: string; statement: string; whatWouldConfirm: string; [k: string]: unknown };

function HypothesisCard({ h }: { h: Hypothesis }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Card
      style={{ padding: '0.9rem 1.1rem', cursor: 'pointer', border: expanded ? '1px solid var(--ms-blue)' : '1px solid var(--border-default)' }}
      onClick={() => setExpanded((x) => !x)}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
        <span
          aria-hidden
          style={{
            marginTop: 2,
            fontSize: '0.7rem',
            color: 'var(--ms-blue)',
            transition: 'transform 0.2s',
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            userSelect: 'none',
          }}
        >
          ▶
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.3rem' }}>
            <Badge kind="pending">{h.resourceClass}</Badge>
          </div>
          <p style={{ margin: 0, fontWeight: 500, fontSize: '0.9rem' }}>{h.statement}</p>
          {expanded && (
            <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-default)' }}>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                <strong>What would confirm it:</strong> {h.whatWouldConfirm}
              </p>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function HypothesesTab({ id }: { id: string }) {
  const r = useLoad(() => api.items(id, 'hypotheses'), [id]);
  if (r.loading) return <Loading />;
  if (r.error) return <ErrorBox error={r.error} />;
  const items = r.data!.items as Hypothesis[];
  if (items.length === 0) return <Empty>No hypotheses recorded.</Empty>;
  return (
    <>
      <h2 style={{ fontSize: '1rem', marginBottom: '1rem' }}>Hypotheses ({items.length})</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {items.map((h, i) => <HypothesisCard key={i} h={h} />)}
      </div>
    </>
  );
}

// ── Generic list tab ──────────────────────────────────────────────────────────

const COLS: Record<string, { key: string; label: string; render?: (v: unknown) => ReactNode }[]> = {
  resources: [
    { key: 'change_type', label: 'Change' },
    { key: 'type', label: 'Type' },
    { key: 'name', label: 'Name' },
    { key: 'resource_group', label: 'Resource group' },
  ],
  dependencies: [
    { key: 'kind', label: 'Kind' },
    { key: 'from_resource_id', label: 'Consumer' },
    { key: 'to_resource_id', label: 'Affected resource' },
    { key: 'evidence', label: 'Evidence' },
  ],
  'policy-findings': [
    { key: 'severity', label: 'Severity' },
    { key: 'rule_id', label: 'Rule' },
    { key: 'title', label: 'Finding' },
    { key: 'prohibited', label: 'Prohibited' },
  ],
  scenarios: [
    { key: 'basis', label: 'Basis' },
    { key: 'title', label: 'Scenario' },
    { key: 'description', label: 'Description' },
  ],
  recommendations: [
    { key: 'kind', label: 'Type' },
    { key: 'title', label: 'Recommendation' },
    { key: 'steps', label: 'Steps' },
  ],
  audit: [
    { key: 'at', label: 'When' },
    { key: 'actor', label: 'Actor' },
    { key: 'action', label: 'Action' },
  ],
};

function ListTab({ id, part }: { id: string; part: string }) {
  const r = useLoad(() => api.items(id, part), [id, part]);
  if (r.loading) return <Loading />;
  if (r.error) return <ErrorBox error={r.error} />;
  const cols = (COLS[part] ?? []).map((c) => ({
    ...c,
    render:
      c.key === 'steps'
        ? (v: unknown) => (
            <ol>
              {(v as string[]).map((s) => <li key={s}>{s}</li>)}
            </ol>
          )
        : c.key === 'prohibited'
          ? (v: unknown) => (v ? 'Yes' : 'No')
          : undefined,
  }));
  return (
    <>
      <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>{part.replace('-', ' ')}</h2>
      {part === 'dependencies' && (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
          Confirmed = referenced in resource properties. Inferred = same resource group only. Runtime dependencies are not visible.
        </p>
      )}
      {part === 'scenarios' && (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
          "heuristic" scenarios are AEGIS inferences, not Azure simulations.
        </p>
      )}
      {r.data!.items.length === 0 ? (
        <Empty>Nothing recorded.</Empty>
      ) : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label={part}>
          <table>
            <caption className="sr-only">{part}</caption>
            <thead>
              <tr>
                {cols.map((c) => <th key={c.key} scope="col">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {r.data!.items.map((row, i) => (
                <tr key={i}>
                  {cols.map((c) => (
                    <td key={c.key}>
                      {c.render ? c.render((row as Record<string, unknown>)[c.key]) : String((row as Record<string, unknown>)[c.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ── Review tab ────────────────────────────────────────────────────────────────

function ReviewTab({ id }: { id: string }) {
  const r = useLoad(() => api.brief(id), [id]);
  if (r.loading) return <Loading />;
  if (r.error) return <ErrorBox error={r.error} />;
  const b = r.data!.brief;
  if (!b)
    return (
      <Empty>No review brief was generated for this assessment (the Reviewer agent did not complete).</Empty>
    );
  return (
    <>
      <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Review brief</h2>
      <Card style={{ marginBottom: '1rem', padding: '1rem 1.25rem' }}>
        <p style={{ margin: '0 0 0.5rem', fontWeight: 600, fontSize: '1.05rem' }}>{b.headline}</p>
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          Prepared deterministically by the Reviewer agent. The decision itself is made by the gate and, where required, by a human approver.
        </p>
      </Card>
      <h3 style={{ fontSize: '0.9rem' }}>Checklist for the reviewer</h3>
      <ol>
        {b.checklist.map((c) => (
          <li key={c.item}>
            {c.item} <span style={{ color: 'var(--text-secondary)' }}>({c.evidenceRef})</span>
          </li>
        ))}
      </ol>
      {b.openQuestions.length > 0 && (
        <>
          <h3 style={{ fontSize: '0.9rem' }}>Open questions (missing evidence)</h3>
          <ul>
            {b.openQuestions.map((q) => <li key={q}>{q}</li>)}
          </ul>
        </>
      )}
    </>
  );
}

// ── Graph tab ─────────────────────────────────────────────────────────────────

function GraphTab({ id }: { id: string }) {
  const res = useLoad(() => api.items(id, 'resources'), [id]);
  const dep = useLoad(() => api.items(id, 'dependencies'), [id]);
  if (res.loading || dep.loading) return <Loading />;
  if (res.error || dep.error) return <ErrorBox error={res.error ?? dep.error} />;
  return (
    <>
      <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Dependency graph</h2>
      <DependencyGraph resources={res.data!.items} edges={dep.data!.items} />
    </>
  );
}
