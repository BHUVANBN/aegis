import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { DataTable, ErrorBox, Loading, Notice, PageHeader, useLoad } from '../components/ui';
import { actionLabel, fmtDate } from '../lib/format';

const PAGE = 25;
export default function Audit() {
  const [offset, setOffset] = useState(0);
  const [q, setQ] = useState('');
  const r = useLoad(() => api.audit(PAGE, offset), [offset]);
  const [verify, setVerify] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    try {
      const v = await api.auditVerify();
      setVerify({ ok: v.ok, text: v.ok ? `The hash chain is intact (${v.checked} events checked).` : `The hash chain is BROKEN at event #${v.brokenAtId}.` });
    } catch (e) {
      setVerify({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const rows = (r.data?.items ?? []).filter((x) => !q || `${x.action} ${actionLabel(String(x.action))} ${x.actor} ${x.environment ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = ['id,at,actor,action,environment,assessment_id,hash', ...rows.map((x) => [x.id, x.at, x.actor, x.action, x.environment, x.assessment_id, x.hash].map(esc).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `aegis-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <>
      <PageHeader
        title="Audit trail"
        subtitle="A tamper-evident record of who did what. Each event includes the hash of the one before it, so edits to history are detectable."
        actions={
          <div className="row">
            <button type="button" disabled={busy} onClick={() => void check()}>
              {busy ? 'Checking…' : 'Verify the hash chain'}
            </button>
            <button type="button" className="secondary" disabled={rows.length === 0} onClick={exportCsv}>
              Export this page (CSV)
            </button>
          </div>
        }
      />
      <div role="status" aria-live="polite">
        {verify && (
          <Notice tone={verify.ok ? 'ok' : 'error'} title={verify.ok ? 'Verified' : 'Problem found'}>
            {verify.text}
          </Notice>
        )}
      </div>
      <div className="field narrow-field">
        <label htmlFor="a-q">Filter this page</label>
        <input id="a-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} maxLength={60} />
      </div>
      {r.loading && !r.data && <Loading />}
      {r.error ? <ErrorBox error={r.error} /> : null}
      {r.data && (
        <>
          <DataTable
            caption="Audit events"
            rows={rows as never}
            columns={[
              { key: 'id', label: '#' },
              { key: 'at', label: 'When', render: (v) => fmtDate(String(v)) },
              { key: 'action', label: 'What happened', render: (v) => (<>{actionLabel(String(v))} <code className="muted">{String(v)}</code></>) },
              { key: 'actor', label: 'Who', render: (v) => <code>{String(v).slice(0, 8)}</code> },
              { key: 'environment', label: 'Environment' },
              { key: 'assessment_id', label: 'Assessment', render: (v) => (v ? <Link to={`/assessments/${String(v)}`}>Open</Link> : '—') },
              { key: 'hash', label: 'Hash', render: (v) => <code>{String(v).slice(0, 10)}</code> },
            ]}
          />
          <nav aria-label="Pagination" className="row">
            <button type="button" className="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
              Newer
            </button>
            <span aria-live="polite">
              {r.data.total === 0 ? 0 : offset + 1}-{Math.min(offset + PAGE, r.data.total)} of {r.data.total}
            </span>
            <button type="button" className="secondary" disabled={offset + PAGE >= r.data.total} onClick={() => setOffset(offset + PAGE)}>
              Older
            </button>
          </nav>
        </>
      )}
    </>
  );
}
