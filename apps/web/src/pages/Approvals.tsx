import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { DataTable, Dialog, ErrorBox, Field, Loading, Notice, PageHeader, describedBy, levelBadge, statusBadge, useLoad } from '../components/ui';
import { fmtAge, fmtDate } from '../lib/format';

interface Pending {
  id: string;
  decision: 'approve' | 'reject';
  env: string;
}

export default function Approvals() {
  const { me } = useAuth();
  const canDecide = !!me && (me.tokenRoles.includes('approver') || me.tokenRoles.includes('admin'));
  const [status, setStatus] = useState('pending');
  const r = useLoad(() => api.approvals(status), [status]);
  const [msg, setMsg] = useState<string | null>(null);
  const [dlg, setDlg] = useState<Pending | null>(null);
  const [comment, setComment] = useState('');
  const [fieldErr, setFieldErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = (id: string, decision: 'approve' | 'reject', env: string) => {
    setComment('');
    setFieldErr(null);
    setDlg({ id, decision, env });
  };
  const submit = async () => {
    if (!dlg) return;
    if (comment.trim().length < 3) {
      setFieldErr('Write at least 3 characters so the audit trail explains the decision.');
      return;
    }
    setBusy(true);
    try {
      await api.decide(dlg.id, dlg.decision, comment.trim());
      setMsg(`Request ${dlg.decision === 'approve' ? 'approved' : 'rejected'}.`);
      setDlg(null);
      r.reload();
    } catch (e) {
      setFieldErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Approval requests"
        subtitle="Changes AEGIS will not let through on its own. The person who asked can never approve their own request."
      />
      <div className="field narrow-field">
        <label htmlFor="st">Show requests that are</label>
        <select id="st" value={status} onChange={(e) => setStatus(e.target.value)}>
          {['pending', 'approved', 'rejected', 'revoked', 'expired', 'consumed'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <p role="status" aria-live="polite" className={msg ? 'notice notice-ok' : 'sr-only'}>
        {msg}
      </p>
      {!canDecide && (
        <Notice tone="info">You can read approval requests, but only people with the approver or admin role can decide them.</Notice>
      )}
      {r.loading && !r.data && <Loading />}
      {r.error ? <ErrorBox error={r.error} /> : null}
      {r.data && (
        <DataTable
          caption="Approval requests"
          rows={r.data.items as never}
          columns={[
            { key: 'environment', label: 'Environment' },
            { key: 'risk_level', label: 'Risk', render: (v) => levelBadge(v as string) },
            { key: 'justification', label: 'Why it is needed' },
            { key: 'created_at', label: 'Requested', render: (v) => fmtAge(String(v)) },
            { key: 'expires_at', label: 'Expires', render: (v) => (v ? fmtDate(String(v)) : '—') },
            {
              key: 'assessment_id',
              label: 'Evidence',
              render: (v) => <Link to={`/assessments/${String(v)}`}>Review evidence</Link>,
            },
            {
              key: 'id',
              label: 'Decision',
              render: (v, row) => {
                if (row.status !== 'pending') return statusBadge(String(row.status));
                if (!canDecide) return statusBadge('pending');
                if (row.requested_by === me?.oid) return <span className="muted">You asked for this, so someone else must decide.</span>;
                return (
                  <span className="row tight">
                    <button type="button" onClick={() => open(String(v), 'approve', String(row.environment))}>
                      Approve
                    </button>
                    <button type="button" className="secondary" onClick={() => open(String(v), 'reject', String(row.environment))}>
                      Reject
                    </button>
                  </span>
                );
              },
            },
          ]}
        />
      )}
      {dlg && (
        <Dialog
          title={`${dlg.decision === 'approve' ? 'Approve' : 'Reject'} the change for ${dlg.env}`}
          onClose={() => setDlg(null)}
          footer={
            <>
              <button type="button" className="secondary" onClick={() => setDlg(null)}>
                Cancel
              </button>
              <button type="button" className={dlg.decision === 'reject' ? 'danger' : undefined} disabled={busy} onClick={() => void submit()}>
                {busy ? 'Saving…' : dlg.decision === 'approve' ? 'Approve' : 'Reject'}
              </button>
            </>
          }
        >
          <p>
            {dlg.decision === 'approve'
              ? 'Approving lets the pipeline deploy exactly this artifact, once. Review the evidence first.'
              : 'Rejecting stops this change. The requester can submit a new version.'}
          </p>
          <Field id="d-comment" label="Your comment (recorded in the audit trail)" error={fieldErr}>
            <textarea
              id="d-comment"
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              aria-invalid={fieldErr ? true : undefined}
              aria-describedby={describedBy('d-comment', false, !!fieldErr)}
            />
          </Field>
        </Dialog>
      )}
    </>
  );
}
