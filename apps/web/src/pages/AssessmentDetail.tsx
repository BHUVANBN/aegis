import { useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { z } from 'zod';
import { api } from '../api';
import { useAuth } from '../auth';
import DependencyGraph from '../components/DependencyGraph';
import {
  Badge,
  DataTable,
  Empty,
  ErrorBox,
  Loading,
  Tabs,
  gateLabel,
  levelBadge,
  tabPanelProps,
  useLoad,
} from '../components/ui';

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

export default function AssessmentDetail() {
  const { id = '' } = useParams();
  const [tab, setTab] = useState<Tab>('summary');
  const a = useLoad(() => api.assessment(id), [id]);
  const g = useLoad(() => api.gate(id), [id]);
  if (a.loading) return <Loading />;
  if (a.error) return <ErrorBox error={a.error} />;
  const x = a.data!;
  const d = x.risk_detail;
  return (
    <article aria-labelledby="page-title">
      <h1 id="page-title" tabIndex={-1}>
        Assessment <code>{x.id.slice(0, 8)}</code> - {x.environment}
      </h1>
      <p>
        {levelBadge(x.risk_level)} score <strong>{x.risk_score ?? 'n/a'}</strong>, confidence{' '}
        <strong>{x.confidence ?? 'n/a'}</strong>, status <Badge kind={x.status}>{x.status}</Badge>
      </p>
      <Tabs
        label="Assessment sections"
        tabs={TABS.map((t) => ({ id: t, label: t.replace('-', ' ') }))}
        value={tab}
        onChange={setTab}
      />
      <div {...tabPanelProps(tab)}>
        {tab === 'summary' && (
          <>
            <h2>Deployment gate</h2>
            {g.data ? (
              <GatePanel id={id} gate={g.data} onChange={g.reload} />
            ) : g.loading ? (
              <Loading />
            ) : (
              <ErrorBox error={g.error} />
            )}
            {x.status !== 'complete' && (
              <div role="alert" className="warn">
                This assessment is <strong>{x.status}</strong>. It is not a statement that the change is safe.
              </div>
            )}
            {d?.missingEvidence && d.missingEvidence.length > 0 && (
              <>
                <h3>Missing evidence</h3>
                <ul>
                  {d.missingEvidence.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </>
            )}
            {d?.blastRadius && (
              <>
                <h3>Blast radius</h3>
                <dl className="grid">
                  {Object.entries(d.blastRadius).map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
            {x.narrative && (
              <>
                <h3>AI-generated summary (advisory only)</h3>
                <p>{x.narrative}</p>
              </>
            )}
            <p className="muted">
              Artifact <code>{x.artifact_digest}</code> - rules {x.rules_version ?? 'n/a'} - parser{' '}
              {x.parser_version ?? 'n/a'}
            </p>
          </>
        )}
        {tab === 'risk' && <RiskTab id={id} />}
        {tab === 'review' && <ReviewTab id={id} />}
        {tab === 'graph' && <GraphTab id={id} />}
        {!['summary', 'risk', 'review', 'graph'].includes(tab) && <ListTab id={id} part={tab} />}
      </div>
    </article>
  );
}

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
  const canRequest = me?.tokenRoles.some((r) => ['assessor', 'approver', 'admin'].includes(r));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = justification.safeParse(text);
    if (!v.success) {
      setErr(v.error.issues[0]!.message);
      return;
    }
    try {
      await api.requestApproval(id, v.data);
      setText('');
      setErr(null);
      onChange();
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  };
  return (
    <div className="card">
      <p>
        <strong>{gateLabel[gate.decision]}</strong>
      </p>
      <ul>
        {gate.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      {gate.approval ? (
        <p>
          Approval request: <Badge kind={gate.approval.status}>{gate.approval.status}</Badge>
          {gate.approval.expires_at && <> expires {new Date(gate.approval.expires_at).toLocaleString()}</>}
        </p>
      ) : null}
      {gate.decision === 'require_approval' && !gate.approval && canRequest && (
        <form onSubmit={(e) => void submit(e)} noValidate>
          <label htmlFor="just">Justification for approvers</label>
          <textarea
            id="just"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            aria-invalid={!!err}
            aria-describedby={err ? 'just-err' : undefined}
          />
          {err && (
            <p id="just-err" role="alert" className="error">
              {err}
            </p>
          )}
          <button type="submit">Request approval</button>
        </form>
      )}
      {gate.decision === 'block' && (
        <p className="muted">Blocked changes cannot be approved. Modify the change and resubmit.</p>
      )}
    </div>
  );
}

function RiskTab({ id }: { id: string }) {
  const r = useLoad(() => api.risk(id), [id]);
  if (r.loading) return <Loading />;
  if (r.error) return <ErrorBox error={r.error} />;
  return (
    <>
      <h2>Score contributions</h2>
      <DataTable
        caption="Score contributions"
        rows={r.data!.contributions as never}
        columns={[
          { key: 'factor', label: 'Factor' },
          { key: 'points', label: 'Points' },
          { key: 'explanation', label: 'Explanation' },
        ]}
      />
    </>
  );
}

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
  hypotheses: [
    { key: 'resourceClass', label: 'Class' },
    { key: 'statement', label: 'Hypothesis' },
    { key: 'whatWouldConfirm', label: 'What would confirm it' },
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
              {(v as string[]).map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          )
        : c.key === 'prohibited'
          ? (v: unknown) => (v ? 'Yes' : 'No')
          : undefined,
  }));
  return (
    <>
      <h2>{part.replace('-', ' ')}</h2>
      {part === 'dependencies' && (
        <p className="muted">
          Confirmed = referenced in resource properties. Inferred = same resource group only. Runtime
          dependencies are not visible.
        </p>
      )}
      {part === 'scenarios' && (
        <p className="muted">"heuristic" scenarios are AEGIS inferences, not Azure simulations.</p>
      )}
      {r.data!.items.length === 0 ? (
        <Empty>Nothing recorded.</Empty>
      ) : (
        <DataTable caption={part} rows={r.data!.items as never} columns={cols} />
      )}
    </>
  );
}

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
      <h2>Review brief</h2>
      <p>
        <strong>{b.headline}</strong>
      </p>
      <p className="muted">
        Prepared deterministically by the Reviewer agent. The decision itself is made by the gate and, where
        required, by a human approver.
      </p>
      <h3>Checklist for the reviewer</h3>
      <ol>
        {b.checklist.map((c) => (
          <li key={c.item}>
            {c.item} <span className="muted">({c.evidenceRef})</span>
          </li>
        ))}
      </ol>
      {b.openQuestions.length > 0 && (
        <>
          <h3>Open questions (missing evidence)</h3>
          <ul>
            {b.openQuestions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function GraphTab({ id }: { id: string }) {
  const res = useLoad(() => api.items(id, 'resources'), [id]);
  const dep = useLoad(() => api.items(id, 'dependencies'), [id]);
  if (res.loading || dep.loading) return <Loading />;
  if (res.error || dep.error) return <ErrorBox error={res.error ?? dep.error} />;
  return (
    <>
      <h2>Dependency graph</h2>
      <DependencyGraph resources={res.data!.items} edges={dep.data!.items} />
    </>
  );
}
