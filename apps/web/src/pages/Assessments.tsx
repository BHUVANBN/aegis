import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import SampleDialog from '../components/SampleDialog';
import { DataTable, ErrorBox, Loading, PageHeader, gateBadge, levelBadge, statusBadge, useLoad } from '../components/ui';
import { fmtDate } from '../lib/format';

const PAGE = 25;
export default function Assessments() {
  const { me } = useAuth();
  const canSample = !!me && (me.tokenRoles.includes('assessor') || me.tokenRoles.includes('admin'));
  const [offset, setOffset] = useState(0);
  const [env, setEnv] = useState('');
  const [risk, setRisk] = useState('');
  const [gate, setGate] = useState('');
  const [q, setQ] = useState('');
  const [sampleOpen, setSampleOpen] = useState(false);
  const envs = useLoad(() => api.environments(), []);
  const { data, error, loading, reload } = useLoad(
    () => api.assessments({ environment: env || undefined, limit: PAGE, offset }),
    [offset, env],
  );
  const envNames = [...new Set((envs.data?.items ?? []).map((e) => e.name))];
  const rows = useMemo(
    () =>
      (data?.items ?? []).filter(
        (r) =>
          (!risk || r.risk_level === risk) &&
          (!gate || r.gate_decision === gate) &&
          (!q || `${r.commit_sha} ${r.pipeline_run_id} ${r.id}`.toLowerCase().includes(q.toLowerCase())),
      ),
    [data, risk, gate, q],
  );
  const filtered = !!(risk || gate || q);

  return (
    <>
      <PageHeader
        title="Change assessments"
        subtitle="Every infrastructure change a pipeline has asked AEGIS about, newest first."
        actions={
          canSample && (
            <button type="button" className="secondary" onClick={() => setSampleOpen(true)}>
              Generate sample assessments
            </button>
          )
        }
      />
      <form className="filters" role="search" aria-label="Filter assessments" onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label htmlFor="f-env">Environment</label>
          <select
            id="f-env"
            value={env}
            onChange={(e) => {
              setOffset(0);
              setEnv(e.target.value);
            }}
          >
            <option value="">All environments</option>
            {envNames.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-risk">Risk level</label>
          <select id="f-risk" value={risk} onChange={(e) => setRisk(e.target.value)}>
            <option value="">Any</option>
            {['low', 'medium', 'high', 'critical'].map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-gate">Outcome</label>
          <select id="f-gate" value={gate} onChange={(e) => setGate(e.target.value)}>
            <option value="">Any</option>
            <option value="allow">Allowed</option>
            <option value="require_approval">Approval required</option>
            <option value="block">Blocked</option>
          </select>
        </div>
        <div className="field grow">
          <label htmlFor="f-q">Search commit or run id</label>
          <input id="f-q" type="search" value={q} maxLength={60} onChange={(e) => setQ(e.target.value)} />
        </div>
      </form>
      {filtered && <p className="muted small">Risk, outcome and search filter the {data?.items.length ?? 0} rows on this page.</p>}
      {loading && !data && <Loading />}
      {error ? <ErrorBox error={error} /> : null}
      {data && (
        <>
          <DataTable
            caption="Assessments"
            rows={rows as never}
            columns={[
              { key: 'created_at', label: 'Created', render: (v) => fmtDate(String(v)) },
              { key: 'environment', label: 'Environment', render: (v, r) => `${String(v)} (${String(r.environment_kind)})` },
              { key: 'risk_level', label: 'Risk', render: (v) => levelBadge(v as string | null) },
              { key: 'risk_score', label: 'Score' },
              { key: 'gate_decision', label: 'Outcome', render: (v) => gateBadge(v as string | null) },
              { key: 'status', label: 'Status', render: (v) => statusBadge(String(v)) },
              {
                key: 'commit_sha',
                label: 'Commit and run',
                render: (v, r) => (
                  <>
                    <code>{String(v).slice(0, 7)}</code>
                    {String(r.pipeline_run_id).startsWith('ui-sample-') && <span className="chip">sample</span>}
                  </>
                ),
              },
              {
                key: 'id',
                label: 'Details',
                render: (v) => (
                  <Link to={`/assessments/${String(v)}`} aria-label={`Open assessment ${String(v).slice(0, 8)}`}>
                    Open
                  </Link>
                ),
              },
            ]}
          />
          <nav aria-label="Pagination" className="row">
            <button type="button" className="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
              Previous
            </button>
            <span aria-live="polite">
              {data.total === 0 ? 0 : offset + 1}-{Math.min(offset + PAGE, data.total)} of {data.total}
            </span>
            <button type="button" className="secondary" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>
              Next
            </button>
          </nav>
        </>
      )}
      {sampleOpen && (
        <SampleDialog
          onClose={() => setSampleOpen(false)}
          onDone={() => {
            window.setTimeout(reload, 2500);
            reload();
          }}
        />
      )}
    </>
  );
}
