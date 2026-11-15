import { useState } from 'react';
import { api } from '../api';
import { DataTable, ErrorBox, Field, Loading, Notice, PageHeader, statusBadge, useLoad } from '../components/ui';

/** Detective control for pipeline bypass: lists Azure changes made outside any AEGIS-authorized deployment window. */
export default function Reconcile() {
  const envs = useLoad(() => api.environments(), []);
  const [envId, setEnvId] = useState('');
  const [hours, setHours] = useState(24);
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.reconcile>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      setResult(await api.reconcile(envId, hours));
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        title="Drift checks"
        subtitle="Finds changes made in Azure outside any authorized deployment, for example in the portal. It reports them; it cannot block them, and it can be noisy."
      />
      {envs.loading && <Loading />}
      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <Field id="rec-env" label="Environment">
          <select id="rec-env" value={envId} onChange={(e) => setEnvId(e.target.value)}>
            <option value="">Select…</option>
            {envs.data?.items.map((e) => (
              <option key={e.id} value={e.id}>
                {e.project_key} / {e.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="rec-h" label="Look back">
          <select id="rec-h" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            <option value={24}>24 hours</option>
            <option value={72}>3 days</option>
            <option value={168}>7 days</option>
            <option value={336}>14 days (the maximum Azure keeps)</option>
          </select>
        </Field>
        <div className="field">
          <span className="label-spacer" aria-hidden="true">
            &nbsp;
          </span>
          <button type="submit" disabled={!envId || busy}>
            {busy ? 'Checking…' : 'Run drift check'}
          </button>
        </div>
      </form>
      {err ? <ErrorBox error={err} /> : null}
      <div role="status" aria-live="polite">
        {result && (
          <>
            <p>
              Status: {statusBadge(result.status === 'ok' ? 'complete' : result.status === 'unavailable' ? 'failed' : 'partial')}{' '}
              <strong>{result.status}</strong>
              {result.reason ? ` (${result.reason})` : ''}. Authorized windows checked: {result.windowsChecked}. Changes seen: {result.changesSeen}.
              Suspected out-of-band: <strong>{result.findings.length}</strong>.
            </p>
            {result.status === 'unavailable' && <Notice tone="warn" title="Not a clean result">Evidence was unavailable, so nothing can be concluded.</Notice>}
            {result.findings.length > 0 && (
              <DataTable
                caption="Suspected out-of-band changes"
                rows={result.findings as never}
                columns={[
                  { key: 'at', label: 'When' },
                  { key: 'changeType', label: 'Change' },
                  { key: 'resourceId', label: 'Resource' },
                  { key: 'changedBy', label: 'By' },
                  { key: 'clientType', label: 'Client' },
                ]}
              />
            )}
            <ul className="plain">
              {result.limitations.map((l) => (
                <li key={l} className="muted">
                  {l}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}
