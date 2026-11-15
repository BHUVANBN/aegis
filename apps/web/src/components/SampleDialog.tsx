import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { SAMPLE_SCENARIOS, sha256Digest } from '../lib/samples';
import { Dialog, ErrorBox, Field, Loading, Notice, describedBy, useLoad } from './ui';

interface Result {
  title: string;
  expected: string;
  id?: string;
  error?: string;
}

/** Creates three clearly marked sample assessments (critical, medium, low) so dashboards can be demonstrated without a pipeline. */
export default function SampleDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const envs = useLoad(() => api.environments(), []);
  const [prod, setProd] = useState('');
  const [dev, setDev] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const list = envs.data?.items ?? [];
  const prodEnvs = list.filter((e) => e.kind === 'prod' || e.kind === 'staging');
  const devEnvs = list.filter((e) => e.kind === 'dev');

  const run = async () => {
    const pe = list.find((e) => e.id === prod);
    const de = list.find((e) => e.id === dev);
    if (!pe || !de) return;
    setBusy(true);
    const stamp = Date.now();
    const out: Result[] = [];
    for (const sc of SAMPLE_SCENARIOS) {
      const env = sc.kind === 'prod' ? pe : de;
      const runId = `ui-sample-${stamp}-${sc.tag}`;
      try {
        const r = await api.createAssessment({
          projectKey: env.project_key,
          environment: env.name,
          commitSha: '0abc123',
          pipelineRunId: runId,
          artifactDigest: await sha256Digest(runId),
          templatePath: 'sample/main.bicep',
          whatIf: sc.whatIf,
        });
        out.push({ title: sc.title, expected: sc.expected, id: r.id });
      } catch (e) {
        out.push({ title: sc.title, expected: sc.expected, error: (e as Error).message });
      }
    }
    setResults(out);
    setBusy(false);
    onDone();
  };

  const ready = prod !== '' && dev !== '';
  return (
    <Dialog
      title="Generate sample assessments"
      onClose={onClose}
      footer={
        results ? (
          <button type="button" onClick={onClose}>
            Close
          </button>
        ) : (
          <>
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="button" disabled={!ready || busy} onClick={() => void run()}>
              {busy ? 'Submitting…' : 'Create 3 sample assessments'}
            </button>
          </>
        )
      }
    >
      {results ? (
        <>
          <Notice tone="ok" title="Submitted">
            Each assessment takes a few seconds to finish. They are marked as samples and hidden from the Business value numbers
            unless you choose to include them.
          </Notice>
          <ul className="plain">
            {results.map((r) => (
              <li key={r.title}>
                {r.title} (expect: {r.expected}):{' '}
                {r.id ? <Link to={`/assessments/${r.id}`} onClick={onClose}>open it</Link> : <span className="field-error">{r.error}</span>}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p>
            This sends three realistic What-If previews through the normal assessment pipeline: a firewall change that must be
            blocked, a virtual machine resize that needs approval, and a harmless tag change. Nothing is deployed to Azure.
          </p>
          {envs.loading && <Loading />}
          {envs.error ? <ErrorBox error={envs.error} /> : null}
          {envs.data && list.length === 0 && (
            <Notice tone="warn" title="No environments yet">
              Create a project and environments first on the <Link to="/setup" onClick={onClose}>Setup</Link> page.
            </Notice>
          )}
          {list.length > 0 && (
            <>
              <Field id="s-prod" label="Production-like environment" hint="Used for the blocked and the approval-required samples." error={prodEnvs.length === 0 ? 'No production or staging environment is available to you.' : null}>
                <select id="s-prod" value={prod} onChange={(e) => setProd(e.target.value)} aria-describedby={describedBy('s-prod', true, prodEnvs.length === 0)}>
                  <option value="">Choose…</option>
                  {prodEnvs.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.project_key} / {e.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="s-dev" label="Development environment" hint="Used for the low-risk sample." error={devEnvs.length === 0 ? 'No development environment is available to you.' : null}>
                <select id="s-dev" value={dev} onChange={(e) => setDev(e.target.value)} aria-describedby={describedBy('s-dev', true, devEnvs.length === 0)}>
                  <option value="">Choose…</option>
                  {devEnvs.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.project_key} / {e.name}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
        </>
      )}
    </Dialog>
  );
}
