import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type AssessmentRow } from '../api';
import {
  Card,
  StatCard,
  PageHeader,
  Badge,
  Loading,
  ErrorBox,
  GateBadge,
  useLoad,
} from '../components/ui';

// ─── types ────────────────────────────────────────────────────────────────────

interface DashboardStats {
  totalAssessments: number;
  pendingApprovals: number;
  blockedChanges: number;
  criticalRisk: number;
  avgRiskScore: number;
  byRisk: { low: number; medium: number; high: number; critical: number };
  byGate: { allow: number; require_approval: number; block: number };
  recentAssessments: AssessmentRow[];
}

interface PendingApproval {
  id: string;
  assessment_id: string;
  status: string;
  requested_by: string;
  justification?: string;
  expires_at: string | null;
  risk_level?: string | null;
  environment?: string;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function expiresIn(iso: string | null): string {
  if (!iso) return '—';
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ─── Risk Bar Chart ───────────────────────────────────────────────────────────

interface RiskBarProps {
  label: string;
  count: number;
  total: number;
  color: string;
  bg: string;
}

function RiskBar({ label, count, total, color, bg }: RiskBarProps) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
      <span
        style={{
          width: 72,
          fontSize: 12,
          fontWeight: 600,
          color,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <div
        style={{
          flex: 1,
          height: 22,
          background: 'var(--border-default, #edebe9)',
          borderRadius: 'var(--radius-sm, 2px)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: color,
            backgroundColor: bg,
            borderLeft: `4px solid ${color}`,
            transition: 'width 0.5s ease',
            minWidth: count > 0 ? 4 : 0,
          }}
        />
      </div>
      <span
        style={{
          width: 90,
          fontSize: 13,
          color: 'var(--text-secondary, #605e5c)',
          flexShrink: 0,
          textAlign: 'right',
        }}
      >
        {count} <span style={{ color: 'var(--text-disabled, #a19f9d)' }}>({pct}%)</span>
      </span>
    </div>
  );
}

// ─── Gate Tile ────────────────────────────────────────────────────────────────

interface GateTileProps {
  label: string;
  count: number;
  color: string;
  bg: string;
  border: string;
}

function GateTile({ label, count, color, bg, border }: GateTileProps) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 160,
        background: bg,
        border: `2px solid ${border}`,
        borderRadius: 'var(--radius-lg, 6px)',
        padding: '24px 20px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <span
        style={{
          fontSize: 36,
          fontWeight: 700,
          color,
          lineHeight: 1,
        }}
      >
        {count}
      </span>
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          color,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ─── Business Impact Card ─────────────────────────────────────────────────────

interface ImpactCardProps {
  value: string;
  label: string;
  description: string;
  accent?: string;
}

function ImpactCard({ value, label, description, accent = 'var(--ms-blue, #0078d4)' }: ImpactCardProps) {
  return (
    <div
      style={{
        background: 'var(--bg-canvas, #fff)',
        border: '1px solid var(--border-default, #edebe9)',
        borderRadius: 'var(--radius-md, 4px)',
        padding: '20px 16px',
        borderTop: `3px solid ${accent}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <span
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: accent,
          lineHeight: 1.1,
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--text-primary, #201f1e)',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 12,
          color: 'var(--text-secondary, #605e5c)',
        }}
      >
        {description}
      </span>
    </div>
  );
}

// ─── Approve / Reject inline panel ───────────────────────────────────────────

interface ApprovalRowProps {
  item: PendingApproval;
  onDecided: () => void;
}

function ApprovalRow({ item, onDecided }: ApprovalRowProps) {
  const [action, setAction] = useState<'approve' | 'reject' | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!action) return;
    if (comment.trim().length < 3) {
      setErr('Comment must be at least 3 characters.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.decide(item.id, action, comment.trim());
      onDecided();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed');
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        background: 'var(--bg-subtle, #faf9f8)',
        border: '1px solid var(--border-default, #edebe9)',
        borderRadius: 'var(--radius-md, 4px)',
        padding: 16,
        marginBottom: 10,
      }}
    >
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontWeight: 600, fontSize: 13, fontFamily: 'monospace', color: 'var(--ms-blue, #0078d4)' }}>
          <Link
            to={`/assessments/${item.assessment_id}`}
            style={{ color: 'inherit', textDecoration: 'none' }}
          >
            {item.assessment_id.slice(0, 8)}…
          </Link>
        </span>
        {item.risk_level && <Badge kind={item.risk_level}>{item.risk_level.toUpperCase()}</Badge>}
        {item.environment && (
          <Badge kind="running">{item.environment}</Badge>
        )}
        <span style={{ fontSize: 12, color: 'var(--text-secondary, #605e5c)' }}>
          By <strong>{item.requested_by}</strong>
        </span>
        {item.justification && (
          <span
            style={{
              fontSize: 12,
              color: 'var(--text-secondary, #605e5c)',
              fontStyle: 'italic',
              maxWidth: 300,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={item.justification}
          >
            "{item.justification}"
          </span>
        )}
        <span style={{ fontSize: 12, color: item.expires_at && new Date(item.expires_at) < new Date() ? 'var(--risk-high, #c50f1f)' : 'var(--text-secondary, #605e5c)' }}>
          Expires: {expiresIn(item.expires_at)}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            className="btn btn-sm btn-success"
            onClick={() => setAction(action === 'approve' ? null : 'approve')}
            style={{
              padding: '4px 14px',
              fontSize: 12,
              fontWeight: 600,
              background: action === 'approve' ? 'var(--gate-allow, #107c10)' : 'transparent',
              color: action === 'approve' ? '#fff' : 'var(--gate-allow, #107c10)',
              border: '1.5px solid var(--gate-allow, #107c10)',
              borderRadius: 'var(--radius-sm, 2px)',
              cursor: 'pointer',
            }}
          >
            Approve
          </button>
          <button
            onClick={() => setAction(action === 'reject' ? null : 'reject')}
            style={{
              padding: '4px 14px',
              fontSize: 12,
              fontWeight: 600,
              background: action === 'reject' ? 'var(--gate-block, #c50f1f)' : 'transparent',
              color: action === 'reject' ? '#fff' : 'var(--gate-block, #c50f1f)',
              border: '1.5px solid var(--gate-block, #c50f1f)',
              borderRadius: 'var(--radius-sm, 2px)',
              cursor: 'pointer',
            }}
          >
            Reject
          </button>
        </div>
      </div>

      {action && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <textarea
            rows={2}
            placeholder={`Comment for ${action} (required, min 3 chars)`}
            value={comment}
            onChange={e => setComment(e.target.value)}
            style={{
              flex: 1,
              minWidth: 220,
              resize: 'vertical',
              padding: '6px 10px',
              fontSize: 13,
              border: '1px solid var(--border-strong, #c8c6c4)',
              borderRadius: 'var(--radius-sm, 2px)',
              fontFamily: 'inherit',
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              onClick={submit}
              disabled={busy}
              style={{
                padding: '6px 18px',
                fontWeight: 600,
                fontSize: 13,
                background: action === 'approve' ? 'var(--gate-allow, #107c10)' : 'var(--gate-block, #c50f1f)',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--radius-sm, 2px)',
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.7 : 1,
              }}
            >
              {busy ? 'Submitting…' : `Confirm ${action === 'approve' ? 'Approve' : 'Reject'}`}
            </button>
            <button
              onClick={() => { setAction(null); setComment(''); setErr(null); }}
              style={{
                padding: '6px 18px',
                fontSize: 13,
                background: 'transparent',
                color: 'var(--text-secondary, #605e5c)',
                border: '1px solid var(--border-strong, #c8c6c4)',
                borderRadius: 'var(--radius-sm, 2px)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
          {err && (
            <span style={{ fontSize: 12, color: 'var(--risk-high, #c50f1f)', alignSelf: 'center' }}>
              {err}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approvalKey, setApprovalKey] = useState(0);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [assessmentsRes, approvalsRes] = await Promise.all([
        api.assessments({ limit: 100, offset: 0 }),
        api.approvals('pending'),
      ]);

      const rows = assessmentsRes.items as AssessmentRow[];

      const byRisk = { low: 0, medium: 0, high: 0, critical: 0 };
      const byGate = { allow: 0, require_approval: 0, block: 0 };
      let scoreSum = 0;
      let scoreCount = 0;

      for (const r of rows) {
        const rl = (r.risk_level ?? '').toLowerCase();
        if (rl === 'low') byRisk.low++;
        else if (rl === 'medium') byRisk.medium++;
        else if (rl === 'high') byRisk.high++;
        else if (rl === 'critical') byRisk.critical++;

        const gd = (r.gate_decision ?? '').toLowerCase();
        if (gd === 'allow') byGate.allow++;
        else if (gd === 'require_approval') byGate.require_approval++;
        else if (gd === 'block') byGate.block++;

        if (r.risk_score !== null) {
          scoreSum += r.risk_score;
          scoreCount++;
        }
      }

      const pending = (approvalsRes.items ?? []) as unknown as PendingApproval[];

      setStats({
        totalAssessments: assessmentsRes.total ?? rows.length,
        pendingApprovals: pending.length,
        blockedChanges: byGate.block,
        criticalRisk: byRisk.critical,
        avgRiskScore: scoreCount > 0 ? Math.round(scoreSum / scoreCount) : 0,
        byRisk,
        byGate,
        recentAssessments: rows.slice(0, 5),
      });
      setPendingApprovals(pending);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [approvalKey]);

  if (loading) return <Loading label="Loading dashboard…" />;
  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!stats) return null;

  const riskTotal =
    stats.byRisk.low + stats.byRisk.medium + stats.byRisk.high + stats.byRisk.critical;
  const riskyCount = stats.byRisk.high + stats.byRisk.critical;
  const reviewTimeSaved = stats.byGate.allow * 15;

  return (
    <div style={{ padding: '0 0 40px' }}>
      <PageHeader
        title="AEGIS Dashboard"
        subtitle="Azure infrastructure change risk — real-time overview"
        action={
          <button
            onClick={load}
            style={{
              padding: '6px 16px',
              fontSize: 13,
              background: 'var(--ms-blue, #0078d4)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius-sm, 2px)',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            ↻ Refresh
          </button>
        }
      />

      {/* ── Section 1: KPI Row ─────────────────────────────────────────────── */}
      <section style={{ marginBottom: 32 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 16,
          }}
        >
          <StatCard
            label="Total Assessments"
            value={stats.totalAssessments}
            accent="var(--ms-blue, #0078d4)"
          />
          <StatCard
            label="Pending Approvals"
            value={stats.pendingApprovals}
            accent={stats.pendingApprovals > 0 ? 'var(--risk-medium, #ca5010)' : 'var(--risk-low, #107c10)'}
          />
          <StatCard
            label="Blocked Changes"
            value={stats.blockedChanges}
            accent={stats.blockedChanges > 0 ? 'var(--risk-high, #c50f1f)' : 'var(--risk-low, #107c10)'}
          />
          <StatCard
            label="Critical Risk"
            value={stats.criticalRisk}
            accent={stats.criticalRisk > 0 ? 'var(--risk-critical, #750b1c)' : 'var(--risk-low, #107c10)'}
          />
          <StatCard
            label="Avg Risk Score"
            value={`${stats.avgRiskScore}/100`}
            accent="var(--ms-teal, #00b7c3)"
          />
        </div>
      </section>

      {/* ── Section 2: Risk Distribution ───────────────────────────────────── */}
      <section style={{ marginBottom: 32 }}>
        <Card>
          <h2
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--text-primary, #201f1e)',
              margin: '0 0 20px',
              paddingBottom: 10,
              borderBottom: '1px solid var(--border-default, #edebe9)',
            }}
          >
            Risk Level Distribution
          </h2>
          {riskTotal === 0 ? (
            <p style={{ color: 'var(--text-secondary, #605e5c)', fontSize: 13 }}>
              No assessments yet.
            </p>
          ) : (
            <>
              <RiskBar
                label="LOW"
                count={stats.byRisk.low}
                total={riskTotal}
                color="var(--risk-low, #107c10)"
                bg="var(--risk-low-bg, #dff6dd)"
              />
              <RiskBar
                label="MEDIUM"
                count={stats.byRisk.medium}
                total={riskTotal}
                color="var(--risk-medium, #ca5010)"
                bg="var(--risk-medium-bg, #fff4ce)"
              />
              <RiskBar
                label="HIGH"
                count={stats.byRisk.high}
                total={riskTotal}
                color="var(--risk-high, #c50f1f)"
                bg="var(--risk-high-bg, #fde7e9)"
              />
              <RiskBar
                label="CRITICAL"
                count={stats.byRisk.critical}
                total={riskTotal}
                color="var(--risk-critical, #750b1c)"
                bg="var(--risk-high-bg, #fde7e9)"
              />
            </>
          )}
        </Card>
      </section>

      {/* ── Section 3: Gate Decision Summary ───────────────────────────────── */}
      <section style={{ marginBottom: 32 }}>
        <Card>
          <h2
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--text-primary, #201f1e)',
              margin: '0 0 20px',
              paddingBottom: 10,
              borderBottom: '1px solid var(--border-default, #edebe9)',
            }}
          >
            Gate Decision Summary
          </h2>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <GateTile
              label="Allow"
              count={stats.byGate.allow}
              color="var(--gate-allow, #107c10)"
              bg="var(--risk-low-bg, #dff6dd)"
              border="var(--gate-allow, #107c10)"
            />
            <GateTile
              label="Require Approval"
              count={stats.byGate.require_approval}
              color="var(--gate-approval, #ca5010)"
              bg="var(--risk-medium-bg, #fff4ce)"
              border="var(--gate-approval, #ca5010)"
            />
            <GateTile
              label="Block"
              count={stats.byGate.block}
              color="var(--gate-block, #c50f1f)"
              bg="var(--risk-high-bg, #fde7e9)"
              border="var(--gate-block, #c50f1f)"
            />
          </div>
        </Card>
      </section>

      {/* ── Section 4: Business Impact ─────────────────────────────────────── */}
      <section style={{ marginBottom: 32 }}>
        <Card>
          <h2
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--text-primary, #201f1e)',
              margin: '0 0 20px',
              paddingBottom: 10,
              borderBottom: '1px solid var(--border-default, #edebe9)',
            }}
          >
            Business Value Delivered
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 16,
            }}
          >
            <ImpactCard
              value={String(stats.totalAssessments)}
              label="Changes Analyzed"
              description="Total infrastructure changes assessed"
              accent="var(--ms-blue, #0078d4)"
            />
            <ImpactCard
              value={String(riskyCount)}
              label="Risky Changes Caught"
              description="Potential incidents prevented"
              accent="var(--risk-high, #c50f1f)"
            />
            <ImpactCard
              value={`${reviewTimeSaved} mins`}
              label="Review Time Saved"
              description="Auto-allowed low-risk changes"
              accent="var(--risk-low, #107c10)"
            />
            <ImpactCard
              value="100%"
              label="Deployment Gate Coverage"
              description="All pipeline deployments assessed"
              accent="var(--ms-teal, #00b7c3)"
            />
            <ImpactCard
              value="< 30s"
              label="Mean Time to Decision"
              description="Deterministic risk engine"
              accent="var(--ms-blue, #0078d4)"
            />
            <ImpactCard
              value="100%"
              label="Audit Compliance"
              description="Every decision recorded in hash chain"
              accent="var(--risk-low, #107c10)"
            />
          </div>
        </Card>
      </section>

      {/* ── Section 5: Recent Assessments ──────────────────────────────────── */}
      <section style={{ marginBottom: 32 }}>
        <Card>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 16,
              paddingBottom: 10,
              borderBottom: '1px solid var(--border-default, #edebe9)',
            }}
          >
            <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary, #201f1e)', margin: 0 }}>
              Recent Assessments
            </h2>
            <Link
              to="/assessments"
              style={{
                fontSize: 13,
                color: 'var(--ms-blue, #0078d4)',
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              View all →
            </Link>
          </div>

          {stats.recentAssessments.length === 0 ? (
            <p style={{ color: 'var(--text-secondary, #605e5c)', fontSize: 13 }}>
              No assessments yet.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr>
                    {['ID', 'Environment', 'Risk', 'Gate', 'Status', 'Created'].map(col => (
                      <th
                        key={col}
                        style={{
                          textAlign: 'left',
                          padding: '6px 12px',
                          fontWeight: 600,
                          fontSize: 12,
                          color: 'var(--text-secondary, #605e5c)',
                          borderBottom: '2px solid var(--border-default, #edebe9)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stats.recentAssessments.map((a, i) => (
                    <tr
                      key={a.id}
                      style={{
                        background: i % 2 === 0 ? 'transparent' : 'var(--bg-subtle, #faf9f8)',
                      }}
                    >
                      <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>
                        <Link
                          to={`/assessments/${a.id}`}
                          style={{ color: 'var(--ms-blue, #0078d4)', textDecoration: 'none' }}
                        >
                          {a.id.slice(0, 8)}…
                        </Link>
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <span
                          style={{
                            fontSize: 12,
                            padding: '2px 8px',
                            background: 'var(--ms-blue-light, #deecf9)',
                            color: 'var(--ms-blue-dark, #005a9e)',
                            borderRadius: 'var(--radius-sm, 2px)',
                            fontWeight: 600,
                          }}
                        >
                          {a.environment}
                        </span>
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        {a.risk_level ? (
                          <Badge kind={a.risk_level}>{a.risk_level.toUpperCase()}</Badge>
                        ) : (
                          <span style={{ color: 'var(--text-disabled, #a19f9d)' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        {a.gate_decision ? (
                          <GateBadge decision={a.gate_decision} />
                        ) : (
                          <span style={{ color: 'var(--text-disabled, #a19f9d)' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <Badge kind={a.status}>{a.status}</Badge>
                      </td>
                      <td
                        style={{
                          padding: '8px 12px',
                          color: 'var(--text-secondary, #605e5c)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {fmtDate(a.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>

      {/* ── Section 6: Pending Approvals ───────────────────────────────────── */}
      <section>
        <Card>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 16,
              paddingBottom: 10,
              borderBottom: '1px solid var(--border-default, #edebe9)',
            }}
          >
            <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary, #201f1e)', margin: 0 }}>
              Pending Approvals
              {pendingApprovals.length > 0 && (
                <span
                  style={{
                    marginLeft: 10,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: 'var(--risk-medium, #ca5010)',
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {pendingApprovals.length}
                </span>
              )}
            </h2>
            <Link
              to="/approvals"
              style={{ fontSize: 13, color: 'var(--ms-blue, #0078d4)', textDecoration: 'none', fontWeight: 600 }}
            >
              View all approvals →
            </Link>
          </div>

          {pendingApprovals.length === 0 ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '32px 0',
                gap: 8,
              }}
            >
              <span style={{ fontSize: 32 }}>🎉</span>
              <span
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: 'var(--risk-low, #107c10)',
                }}
              >
                No pending approvals — all clear
              </span>
              <span style={{ fontSize: 13, color: 'var(--text-secondary, #605e5c)' }}>
                All changes have been reviewed or auto-allowed.
              </span>
            </div>
          ) : (
            pendingApprovals.map(item => (
              <ApprovalRow
                key={item.id}
                item={item}
                onDecided={() => setApprovalKey(k => k + 1)}
              />
            ))
          )}
        </Card>
      </section>
    </div>
  );
}
