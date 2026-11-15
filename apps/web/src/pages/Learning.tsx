import { api } from '../api';
import { DataTable, ErrorBox, Loading, Notice, PageHeader, useLoad } from '../components/ui';

export default function Learning() {
  const r = useLoad(() => api.learning(), []);
  return (
    <>
      <PageHeader title="Learning from outcomes" subtitle="Which rules prove useful once changes are actually deployed and verified." />
      <Notice tone="warn" title="Advisory only">
        AEGIS never changes its own rules or weights. Suggestions go through code review and a new rules version.
      </Notice>
      {r.loading && !r.data && <Loading />}
      {r.error ? <ErrorBox error={r.error} /> : null}
      {r.data && (
        <>
          <p className="muted">
            Suggestions appear only after {r.data.minSample} deployed changes per rule. {r.data.note}
          </p>
          <DataTable
            caption="Rule outcomes"
            rows={r.data.rules as never}
            columns={[
              { key: 'ruleId', label: 'Rule' },
              { key: 'severity', label: 'Severity' },
              { key: 'assessments', label: 'Assessments' },
              { key: 'deployed', label: 'Deployed' },
              { key: 'verifiedPassed', label: 'Verified passed' },
              { key: 'verifiedFailed', label: 'Verified failed' },
              { key: 'suggestion', label: 'Suggestion for human review', render: (v) => (v ? String(v) : '—') },
            ]}
          />
        </>
      )}
    </>
  );
}
