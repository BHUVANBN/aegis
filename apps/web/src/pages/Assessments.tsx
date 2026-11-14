import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Badge, Card, ErrorBox, GateBadge, Loading, PageHeader, useLoad } from '../components/ui';

const PAGE = 15;

const RISK_LEVELS = ['ALL', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const GATE_DECISIONS = ['ALL', 'allow', 'require_approval', 'block'] as const;
type RiskFilter = (typeof RISK_LEVELS)[number];
type GateFilter = (typeof GATE_DECISIONS)[number];

export default function Assessments() {
  const navigate = useNavigate();
  const [offset, setOffset] = useState(0);
  const [env, setEnv] = useState('');
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('ALL');
  const [gateFilter, setGateFilter] = useState<GateFilter>('ALL');

  const envs = useLoad(() => api.environments(), []);
  const { data, error, loading } = useLoad(
    () => api.assessments({ environment: env || undefined, limit: PAGE, offset }),
    [offset, env],
  );

  // Client-side filtering for risk/gate (server supports env filter already)
  const filtered = data
    ? data.items.filter((row) => {
        if (riskFilter !== 'ALL' && (row.risk_level ?? '').toUpperCase() !== riskFilter) return false;
        if (gateFilter !== 'ALL' && row.gate_decision !== gateFilter) return false;
        return true;
      })
    : [];

  const totalPages = data ? Math.ceil(data.total / PAGE) : 0;
  const currentPage = Math.floor(offset / PAGE) + 1;

  const handleEnvChange = (v: string) => { setOffset(0); setEnv(v); };
  const handleRiskChange = (v: RiskFilter) => { setOffset(0); setRiskFilter(v); };
  const handleGateChange = (v: GateFilter) => { setOffset(0); setGateFilter(v); };
  const clearFilters = () => { setEnv(''); setRiskFilter('ALL'); setGateFilter('ALL'); setOffset(0); };

  return (
    <section aria-labelledby="h-assess">
      <PageHeader
        id="h-assess"
        title="Change Assessments"
        subtitle={data ? `${data.total} assessment${data.total !== 1 ? 's' : ''}` : undefined}
      />

      {/* Filters card */}
      <Card style={{ marginBottom: '1.25rem', padding: '1rem 1.25rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 180 }}>
            <label htmlFor="env-filter" style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Environment
            </label>
            <select id="env-filter" value={env} onChange={(e) => handleEnvChange(e.target.value)}>
              <option value="">All environments</option>
              {envs.data?.items.map((e) => (
                <option key={e.id} value={e.name}>
                  {e.project_key} / {e.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label htmlFor="risk-filter" style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Risk level
            </label>
            <select id="risk-filter" value={riskFilter} onChange={(e) => handleRiskChange(e.target.value as RiskFilter)}>
              {RISK_LEVELS.map((l) => (
                <option key={l} value={l}>{l === 'ALL' ? 'All levels' : l}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label htmlFor="gate-filter" style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Gate decision
            </label>
            <select id="gate-filter" value={gateFilter} onChange={(e) => handleGateChange(e.target.value as GateFilter)}>
              <option value="ALL">All decisions</option>
              <option value="allow">Allow</option>
              <option value="require_approval">Require approval</option>
              <option value="block">Block</option>
            </select>
          </div>

          {(env || riskFilter !== 'ALL' || gateFilter !== 'ALL') && (
            <button onClick={clearFilters} style={{ alignSelf: 'flex-end', background: 'none', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', padding: '6px 12px', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              Clear filters
            </button>
          )}
        </div>
      </Card>

      {loading && <Loading />}
      {error ? <ErrorBox error={error} /> : null}

      {data && (
        <>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Showing <strong>{filtered.length}</strong> of <strong>{data.total}</strong> assessment{data.total !== 1 ? 's' : ''}
            {(riskFilter !== 'ALL' || gateFilter !== 'ALL') && ' (filtered)'}
          </p>

          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Assessments">
              <table>
                <caption className="sr-only">Assessments list</caption>
                <thead>
                  <tr>
                    <th scope="col">Created</th>
                    <th scope="col">Environment</th>
                    <th scope="col">Risk</th>
                    <th scope="col">Score</th>
                    <th scope="col">Gate decision</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem' }}>
                        No assessments match the current filters.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((row) => (
                      <tr
                        key={row.id}
                        onClick={() => navigate(`/assessments/${row.id}`)}
                        style={{ cursor: 'pointer' }}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            navigate(`/assessments/${row.id}`);
                          }
                        }}
                        aria-label={`Assessment ${row.id.slice(0, 8)} — ${row.environment}`}
                      >
                        <td style={{ whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                          {new Date(row.created_at).toLocaleString()}
                        </td>
                        <td>
                          <span style={{ fontWeight: 500 }}>{row.environment}</span>
                          {row.environment_kind && (
                            <span style={{ marginLeft: '0.4rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                              ({row.environment_kind})
                            </span>
                          )}
                        </td>
                        <td>
                          {row.risk_level
                            ? <Badge kind={row.risk_level.toLowerCase()}>{row.risk_level.toUpperCase()}</Badge>
                            : <Badge kind="none">n/a</Badge>
                          }
                        </td>
                        <td>
                          {row.risk_score !== null
                            ? <span style={{ fontWeight: 600 }}>{row.risk_score}</span>
                            : <span style={{ color: 'var(--text-secondary)' }}>—</span>
                          }
                        </td>
                        <td>
                          <GateBadge decision={row.gate_decision} compact />
                        </td>
                        <td>
                          <Badge kind={row.status}>{row.status}</Badge>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {data.total > PAGE && (
            <nav
              aria-label="Pagination"
              style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '1rem', justifyContent: 'center' }}
            >
              <button
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE))}
                aria-label="Previous page"
                style={{ padding: '6px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-strong)', background: 'var(--bg-canvas)', cursor: offset === 0 ? 'not-allowed' : 'pointer', opacity: offset === 0 ? 0.5 : 1 }}
              >
                ← Previous
              </button>
              <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                Page {currentPage} of {totalPages}
              </span>
              <button
                disabled={offset + PAGE >= data.total}
                onClick={() => setOffset(offset + PAGE)}
                aria-label="Next page"
                style={{ padding: '6px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-strong)', background: 'var(--bg-canvas)', cursor: offset + PAGE >= data.total ? 'not-allowed' : 'pointer', opacity: offset + PAGE >= data.total ? 0.5 : 1 }}
              >
                Next →
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
