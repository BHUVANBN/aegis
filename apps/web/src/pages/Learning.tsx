import { useState, useMemo } from 'react';
import { api } from '../api';
import {
  Card,
  StatCard,
  PageHeader,
  Badge,
  Loading,
  ErrorBox,
  useLoad,
} from '../components/ui';

export default function Learning() {
  const r = useLoad(() => api.learning(), []);
  const [severityFilter, setSeverityFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [onlySuggestions, setOnlySuggestions] = useState(false);

  // Aggregate stats
  const stats = useMemo(() => {
    if (!r.data?.rules) return null;
    const rules = r.data.rules;
    const totalAssessments = rules.reduce((acc, x) => acc + (x.assessments || 0), 0);
    const totalDeployed = rules.reduce((acc, x) => acc + (x.deployed || 0), 0);
    const totalPassed = rules.reduce((acc, x) => acc + (x.verifiedPassed || 0), 0);
    const totalFailed = rules.reduce((acc, x) => acc + (x.verifiedFailed || 0), 0);
    const totalSuggestions = rules.filter((x) => Boolean(x.suggestion)).length;
    const passRate =
      totalPassed + totalFailed > 0
        ? Math.round((totalPassed / (totalPassed + totalFailed)) * 100)
        : 100;

    return {
      ruleCount: rules.length,
      totalAssessments,
      totalDeployed,
      totalPassed,
      totalFailed,
      totalSuggestions,
      passRate,
    };
  }, [r.data]);

  // Filtered rules
  const filteredRules = useMemo(() => {
    if (!r.data?.rules) return [];
    return r.data.rules.filter((rule) => {
      const matchesSeverity =
        severityFilter === 'all' || rule.severity.toLowerCase() === severityFilter.toLowerCase();
      const matchesSearch =
        !searchTerm ||
        rule.ruleId.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (rule.suggestion && rule.suggestion.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesSuggestion = !onlySuggestions || Boolean(rule.suggestion);
      return matchesSeverity && matchesSearch && matchesSuggestion;
    });
  }, [r.data, severityFilter, searchTerm, onlySuggestions]);

  const rulesWithSuggestions = useMemo(() => {
    return (r.data?.rules ?? []).filter((x) => Boolean(x.suggestion));
  }, [r.data]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        title="Learning & Outcome Analytics"
        subtitle="Closed-loop telemetry correlating infrastructure change risk predictions with post-deployment verification outcomes."
        actions={
          <button
            onClick={() => r.reload()}
            className="btn-secondary"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            <span>🔄</span>
            <span>Refresh Analytics</span>
          </button>
        }
      />

      {/* ── Governance Alert Banner ── */}
      <div
        style={{
          background: 'linear-gradient(90deg, #eff6fc 0%, #f3f9fd 100%)',
          border: '1px solid #c7e0f4',
          borderLeft: '4px solid #0078d4',
          borderRadius: 4,
          padding: '14px 18px',
          display: 'flex',
          gap: 14,
          alignItems: 'flex-start',
        }}
      >
        <span style={{ fontSize: 20, color: '#0078d4' }} aria-hidden="true">
          🛡️
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#004578', marginBottom: 2 }}>
            Human-in-the-Loop Governance Notice
          </div>
          <p style={{ margin: 0, fontSize: 13, color: '#201f1e', lineHeight: 1.5 }}>
            All insights and calibration suggestions are <strong>advisory only</strong>. AEGIS strictly maintains immutable risk rules in production—never modifying thresholds or weights autonomously. Any rule adjustment requires standard pull request review, team consensus, and deployment of an incremented rules version.
          </p>
        </div>
      </div>

      {r.loading && <Loading label="Compiling learning outcomes" />}
      {r.error ? <ErrorBox error={r.error} onRetry={r.reload} /> : null}

      {/* ── KPI Stat Cards ── */}
      {stats && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 14,
          }}
        >
          <StatCard
            label="Rules Tracked"
            value={stats.ruleCount}
            sub="Active risk assessment rules"
            icon="📐"
          />
          <StatCard
            label="Total Evaluations"
            value={stats.totalAssessments.toLocaleString()}
            sub="Changes evaluated"
            icon="🔍"
          />
          <StatCard
            label="Verified Deployments"
            value={stats.totalDeployed.toLocaleString()}
            sub={`${stats.totalPassed} passed, ${stats.totalFailed} failed`}
            icon="🚀"
          />
          <StatCard
            label="Outcome Pass Rate"
            value={`${stats.passRate}%`}
            sub="Clean post-deploy verification"
            trendDir={stats.passRate >= 95 ? 'up' : 'down'}
            trend={stats.passRate >= 95 ? '✓ Optimal' : 'Needs attention'}
            icon="📈"
          />
          <StatCard
            label="Review Suggestions"
            value={stats.totalSuggestions}
            sub={stats.totalSuggestions > 0 ? 'Pending human review' : 'All rules calibrated'}
            icon="💡"
          />
        </div>
      )}

      {/* ── Active Calibration Suggestions (if any) ── */}
      {rulesWithSuggestions.length > 0 && (
        <Card elevated style={{ padding: 20, borderLeft: '4px solid #ca5010' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 18 }}>💡</span>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#ca5010' }}>
              Pending Human Calibration Recommendations ({rulesWithSuggestions.length})
            </h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
            {rulesWithSuggestions.map((rule) => (
              <div
                key={rule.ruleId}
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 4,
                  padding: 14,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <code style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>
                    {rule.ruleId}
                  </code>
                  <Badge kind={rule.severity}>{rule.severity.toUpperCase()}</Badge>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                  {rule.suggestion}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 'auto', paddingTop: 6, borderTop: '1px solid var(--border-default)' }}>
                  Evaluated: {rule.assessments} | Deployed: {rule.deployed} | Passed: {rule.verifiedPassed} | Failed: {rule.verifiedFailed}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Filter Bar ── */}
      {r.data && (
        <Card style={{ padding: '12px 16px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <label htmlFor="learning-search" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                Search Rules:
              </label>
              <input
                id="learning-search"
                type="text"
                placeholder="Rule ID or suggestion..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  padding: '5px 12px',
                  border: '1px solid var(--border-default)',
                  borderRadius: 4,
                  fontSize: 13,
                  minWidth: 220,
                  outline: 'none',
                }}
              />

              <label htmlFor="learning-severity" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginLeft: 8 }}>
                Severity:
              </label>
              <select
                id="learning-severity"
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
                style={{
                  padding: '5px 10px',
                  border: '1px solid var(--border-default)',
                  borderRadius: 4,
                  fontSize: 13,
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                }}
              >
                <option value="all">All Severities</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>

              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', marginLeft: 8 }}>
                <input
                  type="checkbox"
                  checked={onlySuggestions}
                  onChange={(e) => setOnlySuggestions(e.target.checked)}
                />
                <span>Only rules with suggestions</span>
              </label>
            </div>

            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Min sample requirement: {r.data.minSample} deployed changes
            </div>
          </div>
        </Card>
      )}

      {/* ── Rules Outcome Table ── */}
      {r.data && !r.loading && (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-default)' }}>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600 }}>
                    Rule Identifier
                  </th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, width: 100 }}>
                    Severity
                  </th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontSize: 12, fontWeight: 600, width: 110 }}>
                    Evaluations
                  </th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontSize: 12, fontWeight: 600, width: 100 }}>
                    Deployed
                  </th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, width: 220 }}>
                    Verification Ratio (Pass / Fail / Other)
                  </th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600 }}>
                    Suggestion for Review
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRules.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 36, textAlign: 'center', color: 'var(--text-secondary)' }}>
                      No rules match your filters.
                    </td>
                  </tr>
                ) : (
                  filteredRules.map((rule) => {
                    const totalVerified = (rule.verifiedPassed || 0) + (rule.verifiedFailed || 0) + (rule.verifiedOther || 0);
                    const passPct = totalVerified > 0 ? ((rule.verifiedPassed || 0) / totalVerified) * 100 : 0;
                    const failPct = totalVerified > 0 ? ((rule.verifiedFailed || 0) / totalVerified) * 100 : 0;
                    const otherPct = totalVerified > 0 ? ((rule.verifiedOther || 0) / totalVerified) * 100 : 0;

                    return (
                      <tr
                        key={rule.ruleId}
                        style={{ borderBottom: '1px solid var(--border-default)' }}
                        className="table-row-hover"
                      >
                        <td style={{ padding: '10px 14px', fontSize: 13, fontFamily: 'monospace', fontWeight: 600 }}>
                          {rule.ruleId}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <Badge kind={rule.severity}>{rule.severity.toUpperCase()}</Badge>
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13, fontWeight: 600 }}>
                          {(rule.assessments || 0).toLocaleString()}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13, color: 'var(--text-secondary)' }}>
                          {(rule.deployed || 0).toLocaleString()}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          {totalVerified === 0 ? (
                            <span style={{ fontSize: 12, color: 'var(--text-secondary)', opacity: 0.6 }}>
                              Awaiting deployments
                            </span>
                          ) : (
                            <div>
                              <div
                                style={{
                                  display: 'flex',
                                  height: 8,
                                  borderRadius: 4,
                                  overflow: 'hidden',
                                  background: 'var(--bg-tertiary)',
                                  marginBottom: 4,
                                }}
                              >
                                <div
                                  style={{ width: `${passPct}%`, background: '#107c10' }}
                                  title={`Passed: ${rule.verifiedPassed}`}
                                />
                                <div
                                  style={{ width: `${failPct}%`, background: '#c50f1f' }}
                                  title={`Failed: ${rule.verifiedFailed}`}
                                />
                                <div
                                  style={{ width: `${otherPct}%`, background: '#8a8886' }}
                                  title={`Other: ${rule.verifiedOther}`}
                                />
                              </div>
                              <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--text-secondary)' }}>
                                <span style={{ color: '#107c10', fontWeight: 600 }}>
                                  ✓ {rule.verifiedPassed}
                                </span>
                                {rule.verifiedFailed > 0 && (
                                  <span style={{ color: '#c50f1f', fontWeight: 600 }}>
                                    ✕ {rule.verifiedFailed}
                                  </span>
                                )}
                                {rule.verifiedOther > 0 && (
                                  <span>○ {rule.verifiedOther}</span>
                                )}
                              </div>
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '10px 14px', fontSize: 13 }}>
                          {rule.suggestion ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#ca5010', fontWeight: 600 }}>
                              <span>💡</span>
                              <span>{rule.suggestion}</span>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-secondary)', opacity: 0.5 }}>
                              Calibrated (no action required)
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
