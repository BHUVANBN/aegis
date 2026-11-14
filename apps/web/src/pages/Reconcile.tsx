import { useState, useMemo } from 'react';
import { api, type Item } from '../api';
import {
  Card,
  StatCard,
  PageHeader,
  Badge,
  Loading,
  ErrorBox,
  useLoad,
} from '../components/ui';

interface DriftFinding extends Item {
  at?: string;
  changeType?: string;
  resourceId?: string;
  changedBy?: string;
  clientType?: string;
  [k: string]: unknown;
}

export default function Reconcile() {
  const envs = useLoad(() => api.environments(), []);
  const [envId, setEnvId] = useState('');
  const [sinceHours, setSinceHours] = useState(24);
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.reconcile>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const selectedEnv = useMemo(() => {
    return envs.data?.items.find((e) => e.id === envId);
  }, [envs.data, envId]);

  const runReconciliation = async () => {
    if (!envId) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await api.reconcile(envId, sinceHours);
      setResult(res);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const filteredFindings = useMemo(() => {
    if (!result?.findings) return [];
    const list = result.findings as unknown as DriftFinding[];
    if (!searchQuery) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(
      (f) =>
        String(f.resourceId ?? '').toLowerCase().includes(q) ||
        String(f.changedBy ?? '').toLowerCase().includes(q) ||
        String(f.changeType ?? '').toLowerCase().includes(q) ||
        String(f.clientType ?? '').toLowerCase().includes(q),
    );
  }, [result, searchQuery]);

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'clean':
      case 'ok':
        return '#107c10';
      case 'drift_detected':
      case 'violations_found':
        return '#c50f1f';
      case 'unavailable':
        return '#ca5010';
      default:
        return '#0078d4';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        title="Drift & Reconciliation Monitor"
        subtitle="Detective control that correlates cloud changes with AEGIS gate records to detect out-of-band portal or CLI edits."
        actions={
          <button
            onClick={() => void runReconciliation()}
            disabled={!envId || busy}
            className="btn-primary"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 18px',
              fontSize: 13,
              fontWeight: 600,
              cursor: !envId || busy ? 'not-allowed' : 'pointer',
              opacity: !envId || busy ? 0.6 : 1,
            }}
          >
            <span>{busy ? '⏳' : '🔄'}</span>
            <span>{busy ? 'Scanning Azure Activity Logs…' : 'Run Reconciliation Scan'}</span>
          </button>
        }
      />

      {/* ── Guidance Banner ── */}
      <div
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-default)',
          borderRadius: 4,
          padding: '14px 18px',
          display: 'flex',
          gap: 14,
          alignItems: 'center',
        }}
      >
        <span style={{ fontSize: 22, color: 'var(--ms-blue)' }}>⚡</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>
            Zero-CLI Cloud Monitoring
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            AEGIS queries the cloud control plane directly via Azure Resource Graph and Azure Monitor REST APIs, eliminating the need to construct manual <code>az resource</code> or <code>az activity-log</code> CLI scripts.
          </div>
        </div>
      </div>

      {/* ── Scan Configuration Card ── */}
      <Card elevated style={{ padding: 20 }}>
        <h2 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
          Scan Configuration
        </h2>

        {envs.loading && <Loading label="Loading environments" />}
        {envs.error ? <ErrorBox error={envs.error} /> : null}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          <div>
            <label
              htmlFor="reconcile-env"
              style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--text-primary)' }}
            >
              Target Environment
            </label>
            <select
              id="reconcile-env"
              value={envId}
              onChange={(e) => setEnvId(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 4,
                border: '1px solid var(--border-default)',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                fontSize: 13,
              }}
            >
              <option value="">Choose an environment...</option>
              {envs.data?.items.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.project_key} / {e.name} ({e.kind})
                </option>
              ))}
            </select>
            {selectedEnv && (
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
                Kind: <strong>{selectedEnv.kind}</strong> | Project: <strong>{selectedEnv.project_key}</strong>
              </div>
            )}
          </div>

          <div>
            <label
              htmlFor="reconcile-hours"
              style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--text-primary)' }}
            >
              Lookback Window
            </label>
            <select
              id="reconcile-hours"
              value={sinceHours}
              onChange={(e) => setSinceHours(Number(e.target.value))}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 4,
                border: '1px solid var(--border-default)',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                fontSize: 13,
              }}
            >
              <option value={6}>Last 6 hours</option>
              <option value={12}>Last 12 hours</option>
              <option value={24}>Last 24 hours (Standard)</option>
              <option value={48}>Last 48 hours</option>
              <option value={168}>Last 7 days (Weekly Audit)</option>
            </select>
          </div>
        </div>
      </Card>

      {err ? <ErrorBox error={err} /> : null}

      {/* ── Scan Results Summary ── */}
      {result && (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 14,
            }}
          >
            <Card elevated style={{ padding: 18, borderLeft: `5px solid ${getStatusColor(result.status)}` }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                Scan Verdict
              </span>
              <div style={{ fontSize: 20, fontWeight: 700, color: getStatusColor(result.status), marginTop: 4 }}>
                {result.status.toUpperCase()}
              </div>
              {result.reason && (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                  {result.reason}
                </div>
              )}
            </Card>

            <StatCard
              label="Authorized Windows"
              value={result.windowsChecked}
              sub="Matching CI/CD deployment runs"
              icon="🚪"
            />
            <StatCard
              label="Cloud Changes Seen"
              value={result.changesSeen}
              sub={`In last ${sinceHours} hours`}
              icon="☁️"
            />
            <StatCard
              label="Suspected Out-of-Band"
              value={result.findings.length}
              sub={result.findings.length === 0 ? 'No pipeline bypasses detected' : 'Uncorrelated mutations'}
              icon="🚨"
              trendDir={result.findings.length === 0 ? 'up' : 'down'}
              trend={result.findings.length === 0 ? '✓ In Sync' : 'Drift detected'}
            />
          </div>

          {result.status === 'unavailable' && (
            <div
              style={{
                background: '#fff4ce',
                border: '1px solid #ffb900',
                borderRadius: 4,
                padding: '12px 16px',
                color: '#323130',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              ⚠️ Evidence unavailable: Cloud logs for this window were not fully queryable. This is NOT a clean result.
            </div>
          )}

          {/* ── Findings Table ── */}
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-default)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                  Detected Out-of-Band Changes ({filteredFindings.length})
                </h3>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Cloud resource changes with no corresponding AEGIS gate approval window
                </span>
              </div>

              {result.findings.length > 0 && (
                <input
                  type="text"
                  placeholder="Filter findings by resource or user..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 4,
                    border: '1px solid var(--border-default)',
                    fontSize: 12,
                    minWidth: 240,
                  }}
                />
              )}
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-default)' }}>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, width: 160 }}>
                      Timestamp (UTC)
                    </th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, width: 110 }}>
                      Change Type
                    </th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600 }}>
                      Target Resource ID
                    </th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, width: 190 }}>
                      Changed By
                    </th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, width: 130 }}>
                      Client Type
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.findings.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: 40, textAlign: 'center', color: '#107c10' }}>
                        <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>No Out-of-Band Changes Detected</div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                          All cloud mutations during this window were authorized through AEGIS deployment gates.
                        </div>
                      </td>
                    </tr>
                  ) : filteredFindings.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
                        No findings match your search filter.
                      </td>
                    </tr>
                  ) : (
                    filteredFindings.map((f, idx) => (
                      <tr
                        key={idx}
                        style={{ borderBottom: '1px solid var(--border-default)' }}
                        className="table-row-hover"
                      >
                        <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          {f.at ? new Date(String(f.at)).toLocaleString() : '—'}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <span
                            className={`badge ${
                              String(f.changeType).toLowerCase().includes('delete')
                                ? 'badge-critical'
                                : String(f.changeType).toLowerCase().includes('write') || String(f.changeType).toLowerCase().includes('create')
                                  ? 'badge-medium'
                                  : 'badge-default'
                            }`}
                            style={{ fontWeight: 600 }}
                          >
                            {String(f.changeType ?? 'MUTATION')}
                          </span>
                        </td>
                        <td style={{ padding: '10px 14px', fontSize: 12, fontFamily: 'monospace' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span
                              style={{
                                maxWidth: 420,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                              title={String(f.resourceId)}
                            >
                              {String(f.resourceId ?? 'unknown')}
                            </span>
                            {f.resourceId && (
                              <button
                                onClick={() => copyToClipboard(String(f.resourceId))}
                                className="btn-secondary"
                                style={{ padding: '2px 6px', fontSize: 10, cursor: 'pointer', flexShrink: 0 }}
                              >
                                {copiedId === String(f.resourceId) ? 'Copied ✓' : 'Copy'}
                              </button>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                          <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', whiteSpace: 'nowrap' }}>
                            {String(f.changedBy ?? 'unknown')}
                          </span>
                        </td>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-secondary)' }}>
                          <span style={{ background: 'var(--bg-tertiary)', padding: '2px 8px', borderRadius: 3, fontWeight: 600 }}>
                            {String(f.clientType ?? 'Azure Control Plane')}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* ── Limitations & Governance Notes ── */}
          {result.limitations && result.limitations.length > 0 && (
            <Card style={{ padding: '14px 18px', background: 'var(--bg-secondary)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 8 }}>
                Telemetry Limitations & Cloud Propagation Notes
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                {result.limitations.map((lim, idx) => (
                  <li key={idx}>{lim}</li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
