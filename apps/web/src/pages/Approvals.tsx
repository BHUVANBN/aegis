import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Badge, Loading, ErrorBox, Card, useLoad } from '../components/ui';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ApprovalItem {
  id: string;
  status: string;
  environment: string;
  risk_level: string | null;
  requested_by: string;
  justification: string | null;
  assessment_id: string;
  expires_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_comment: string | null;
  created_at: string;
  [k: string]: unknown;
}

type TabKey = 'pending' | 'approved' | 'rejected' | 'all';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'pending',  label: 'Pending'  },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all',      label: 'All'      },
];

// ─── Helper: expiry countdown ────────────────────────────────────────────────

function expiryLabel(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const hours = Math.floor(ms / 3_600_000);
  const mins  = Math.floor((ms % 3_600_000) / 60_000);
  return hours > 0 ? `Expires in ${hours}h ${mins}m` : `Expires in ${mins}m`;
}

function RiskBadge({ level }: { level: string | null }) {
  if (!level) return <Badge kind="none">n/a</Badge>;
  const colorMap: Record<string, string> = {
    low:      '#107c10',
    medium:   '#ca5010',
    high:     '#c50f1f',
    critical: '#750b1c',
  };
  const bgMap: Record<string, string> = {
    low:      '#dff6dd',
    medium:   '#fff4ce',
    high:     '#fde7e9',
    critical: '#fde7e9',
  };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 12,
      background: bgMap[level] ?? '#f3f2f1',
      color: colorMap[level] ?? '#201f1e',
      fontWeight: 700, fontSize: 12, letterSpacing: '0.04em',
      textTransform: 'uppercase',
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: colorMap[level] ?? '#a19f9d',
        display: 'inline-block',
      }} />
      {level}
    </span>
  );
}

function EnvBadge({ env }: { env: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 4,
      background: '#deecf9', color: '#0078d4',
      fontSize: 11, fontWeight: 600, letterSpacing: '0.03em',
    }}>
      {env}
    </span>
  );
}

// ─── Inline Approval Form ────────────────────────────────────────────────────

interface InlineFormProps {
  id: string;
  action: 'approve' | 'reject';
  onConfirm: (id: string, action: 'approve' | 'reject', comment: string) => Promise<void>;
  onCancel: () => void;
}

function InlineDecisionForm({ id, action, onConfirm, onCancel }: InlineFormProps) {
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (comment.trim().length < 3) {
      setErr('Comment must be at least 3 characters.');
      return;
    }
    setErr(null);
    setSubmitting(true);
    try {
      await onConfirm(id, action, comment.trim());
    } catch (e) {
      setErr((e as Error).message);
      setSubmitting(false);
    }
  };

  const isApprove = action === 'approve';
  const accentColor = isApprove ? '#107c10' : '#c50f1f';

  return (
    <div style={{
      marginTop: 12, padding: '14px 16px', borderRadius: 6,
      border: `1.5px solid ${accentColor}`,
      background: isApprove ? '#f1faf1' : '#fff8f8',
    }}>
      <p style={{ margin: '0 0 8px', fontWeight: 600, color: accentColor, fontSize: 13 }}>
        {isApprove ? '✓ Approve this request' : '✕ Reject this request'}
      </p>
      <label
        htmlFor={`comment-${id}`}
        style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#605e5c', marginBottom: 4 }}
      >
        Comment <span style={{ color: '#c50f1f' }}>*</span>
      </label>
      <textarea
        id={`comment-${id}`}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={3}
        placeholder="Provide a reason for your decision…"
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: '8px 10px', borderRadius: 4,
          border: err ? '1.5px solid #c50f1f' : '1px solid #c8c6c4',
          fontFamily: 'inherit', fontSize: 13, resize: 'vertical',
        }}
        autoFocus
        disabled={submitting}
      />
      {err && (
        <p role="alert" style={{ margin: '4px 0 0', color: '#c50f1f', fontSize: 12 }}>{err}</p>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button
          onClick={() => void handleSubmit()}
          disabled={submitting}
          style={{
            background: accentColor, color: '#fff',
            border: 'none', borderRadius: 4,
            padding: '7px 18px', cursor: submitting ? 'not-allowed' : 'pointer',
            fontWeight: 600, fontSize: 13,
          }}
        >
          {submitting ? 'Submitting…' : (isApprove ? 'Confirm Approval' : 'Confirm Rejection')}
        </button>
        <button
          onClick={onCancel}
          disabled={submitting}
          style={{
            background: 'transparent', color: '#605e5c',
            border: '1px solid #c8c6c4', borderRadius: 4,
            padding: '7px 14px', cursor: 'pointer', fontSize: 13,
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Justification (truncated with expand) ───────────────────────────────────

function JustificationText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const LIMIT = 160;
  const isLong = text.length > LIMIT;
  return (
    <p style={{ margin: '6px 0 0', fontSize: 13, color: '#605e5c', lineHeight: 1.5 }}>
      {isLong && !expanded ? text.slice(0, LIMIT) + '…' : text}
      {isLong && (
        <button
          onClick={() => setExpanded((x) => !x)}
          style={{
            background: 'none', border: 'none', color: '#0078d4',
            cursor: 'pointer', padding: '0 4px', fontSize: 12,
          }}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </p>
  );
}

// ─── Pending Approval Card ────────────────────────────────────────────────────

interface PendingRowProps {
  item: ApprovalItem;
  onDecide: (id: string, action: 'approve' | 'reject', comment: string) => Promise<void>;
}

function PendingRow({ item, onDecide }: PendingRowProps) {
  const [action, setAction] = useState<'approve' | 'reject' | null>(null);

  const expiry = expiryLabel(item.expires_at);
  const isExpired = expiry === 'Expired';

  const handleConfirm = async (id: string, act: 'approve' | 'reject', comment: string) => {
    await onDecide(id, act, comment);
    setAction(null);
  };

  return (
    <div style={{
      border: '1px solid #edebe9',
      borderRadius: 6,
      background: '#fff',
      boxShadow: '0 1.6px 3.6px 0 rgba(0,0,0,.13)',
      padding: '16px 20px',
      marginBottom: 12,
    }}>
      {/* Top row: badges + action buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <RiskBadge level={item.risk_level} />
        <EnvBadge env={item.environment} />
        {expiry && (
          <span style={{
            fontSize: 12, fontWeight: 600,
            color: isExpired ? '#c50f1f' : '#605e5c',
            background: isExpired ? '#fde7e9' : '#faf9f8',
            padding: '2px 8px', borderRadius: 4,
          }}>
            ⏱ {expiry}
          </span>
        )}

        <div style={{ flex: 1 }} />

        {!isExpired && action === null && (
          <span style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setAction('approve')}
              style={{
                background: '#107c10', color: '#fff',
                border: 'none', borderRadius: 4, padding: '6px 14px',
                cursor: 'pointer', fontWeight: 600, fontSize: 13,
              }}
            >
              ✓ Approve
            </button>
            <button
              onClick={() => setAction('reject')}
              style={{
                background: '#fff', color: '#c50f1f',
                border: '1.5px solid #c50f1f',
                borderRadius: 4, padding: '6px 14px',
                cursor: 'pointer', fontWeight: 600, fontSize: 13,
              }}
            >
              ✕ Reject
            </button>
          </span>
        )}
        {action !== null && (
          <button
            onClick={() => setAction(null)}
            style={{
              background: 'transparent', color: '#605e5c',
              border: '1px solid #c8c6c4', borderRadius: 4,
              padding: '5px 12px', cursor: 'pointer', fontSize: 12,
            }}
          >
            Cancel
          </button>
        )}
      </div>

      {/* Requester */}
      <div style={{ marginTop: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: '#201f1e' }}>
          {item.requested_by}
        </span>
        <span style={{ color: '#605e5c', fontSize: 12, marginLeft: 6 }}>
          requested approval
        </span>
      </div>

      {item.justification ? <JustificationText text={String(item.justification)} /> : null}

      {item.assessment_id ? (
        <div style={{ marginTop: 8 }}>
          <Link
            to={`/assessments/${item.assessment_id}`}
            style={{ fontSize: 12, color: '#0078d4', textDecoration: 'none' }}
          >
            → Review assessment evidence
          </Link>
        </div>
      ) : null}

      {/* Inline decision form */}
      {action !== null && (
        <InlineDecisionForm
          id={item.id}
          action={action}
          onConfirm={handleConfirm}
          onCancel={() => setAction(null)}
        />
      )}
    </div>
  );
}

// ─── History Table ────────────────────────────────────────────────────────────

const TH: React.CSSProperties = {
  padding: '10px 12px', fontWeight: 600, color: '#605e5c',
  fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.03em',
  whiteSpace: 'nowrap', textAlign: 'left',
};
const TD: React.CSSProperties = {
  padding: '10px 12px', verticalAlign: 'top',
};

function HistoryTable({ items }: { items: ApprovalItem[] }) {
  if (items.length === 0) {
    return (
      <p style={{ color: '#605e5c', fontSize: 14, padding: '24px 0', margin: 0 }}>
        No records found.
      </p>
    );
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #edebe9' }}>
            <th style={TH}>Environment</th>
            <th style={TH}>Risk</th>
            <th style={TH}>Requested by</th>
            <th style={TH}>Status</th>
            <th style={TH}>Decided by</th>
            <th style={TH}>Decided at</th>
            <th style={TH}>Comment</th>
            <th style={TH}>Assessment</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={item.id ?? i} style={{
              borderBottom: '1px solid #edebe9',
              background: i % 2 === 0 ? '#fff' : '#faf9f8',
            }}>
              <td style={TD}><EnvBadge env={item.environment} /></td>
              <td style={TD}><RiskBadge level={item.risk_level} /></td>
              <td style={TD}>{item.requested_by}</td>
              <td style={TD}><Badge kind={item.status}>{item.status}</Badge></td>
              <td style={TD}>{item.decided_by ?? '—'}</td>
              <td style={TD}>
                {item.decided_at ? new Date(item.decided_at).toLocaleString() : '—'}
              </td>
              <td style={{ ...TD, maxWidth: 240 }}>
                <span
                  title={item.decision_comment ?? ''}
                  style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {item.decision_comment ?? '—'}
                </span>
              </td>
              <td style={TD}>
                {item.assessment_id ? (
                  <Link
                    to={`/assessments/${item.assessment_id}`}
                    style={{ color: '#0078d4', textDecoration: 'none', fontSize: 12 }}
                  >
                    View →
                  </Link>
                ) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Empty State ─────────────────────────────────────────────────────────────

function PendingEmptyState() {
  return (
    <div style={{
      textAlign: 'center', padding: '48px 24px',
      border: '1px dashed #edebe9',
      borderRadius: 8, background: '#f1faf1',
    }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
      <p style={{ fontWeight: 700, fontSize: 18, color: '#107c10', margin: '0 0 6px' }}>
        No pending approvals — all clear!
      </p>
      <p style={{ color: '#605e5c', fontSize: 14, margin: 0 }}>
        All approval requests have been handled.
      </p>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Approvals() {
  const [activeTab, setActiveTab] = useState<TabKey>('pending');
  const [flashMsg, setFlashMsg] = useState<{ text: string; kind: 'success' | 'error' } | null>(null);

  const statusParam = activeTab === 'all' ? undefined : activeTab;
  const r = useLoad(() => api.approvals(statusParam), [activeTab]);

  const handleDecide = useCallback(
    async (id: string, decision: 'approve' | 'reject', comment: string) => {
      await api.decide(id, decision, comment);
      setFlashMsg({
        text: `Request ${decision === 'approve' ? 'approved ✓' : 'rejected ✕'} successfully.`,
        kind: decision === 'approve' ? 'success' : 'error',
      });
      r.reload();
      setTimeout(() => setFlashMsg(null), 5000);
    },
    [r],
  );

  const items = (r.data?.items ?? []) as ApprovalItem[];
  const pendingItems = items.filter((x) => x.status === 'pending');
  const historyItems = items.filter((x) => x.status !== 'pending');

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px' }}>
      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#201f1e' }}>
          Approval Requests
        </h1>
        <p style={{ margin: '4px 0 0', color: '#605e5c', fontSize: 14 }}>
          Review and action infrastructure change approvals.
        </p>
      </div>

      {/* Flash message */}
      {flashMsg && (
        <div
          role="status"
          aria-live="polite"
          style={{
            padding: '10px 16px', borderRadius: 4, marginBottom: 16,
            background: flashMsg.kind === 'success' ? '#dff6dd' : '#fde7e9',
            color: flashMsg.kind === 'success' ? '#107c10' : '#c50f1f',
            border: `1px solid ${flashMsg.kind === 'success' ? '#107c10' : '#c50f1f'}`,
            fontWeight: 600, fontSize: 13,
          }}
        >
          {flashMsg.text}
        </div>
      )}

      {/* Fluent-style Tab bar */}
      <div
        role="tablist"
        aria-label="Filter approvals by status"
        style={{
          display: 'flex', borderBottom: '2px solid #edebe9',
          marginBottom: 20,
        }}
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.key)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '10px 20px', fontSize: 14, fontWeight: isActive ? 600 : 400,
                color: isActive ? '#0078d4' : '#605e5c',
                borderBottom: isActive ? '2px solid #0078d4' : '2px solid transparent',
                marginBottom: -2,
                transition: 'color 0.15s',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Loading / Error */}
      {r.loading && <Loading label="Loading approvals" />}
      {r.error ? <ErrorBox error={r.error} /> : null}

      {/* Content */}
      {r.data && !r.loading && (
        <div>
          {/* Pending tab */}
          {activeTab === 'pending' && (
            pendingItems.length === 0
              ? <PendingEmptyState />
              : (
                <>
                  <p style={{ color: '#605e5c', fontSize: 13, marginBottom: 16 }}>
                    {pendingItems.length} request{pendingItems.length !== 1 ? 's' : ''} awaiting decision
                  </p>
                  {pendingItems.map((item) => (
                    <PendingRow key={item.id} item={item} onDecide={handleDecide} />
                  ))}
                </>
              )
          )}

          {/* Approved / Rejected tabs — history table */}
          {(activeTab === 'approved' || activeTab === 'rejected') && (
            <Card>
              <HistoryTable items={items} />
            </Card>
          )}

          {/* All tab */}
          {activeTab === 'all' && (
            <>
              {pendingItems.length > 0 && (
                <section style={{ marginBottom: 32 }}>
                  <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, color: '#201f1e' }}>
                    Pending ({pendingItems.length})
                  </h2>
                  {pendingItems.map((item) => (
                    <PendingRow key={item.id} item={item} onDecide={handleDecide} />
                  ))}
                </section>
              )}
              {historyItems.length > 0 && (
                <section>
                  <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, color: '#201f1e' }}>
                    History ({historyItems.length})
                  </h2>
                  <Card>
                    <HistoryTable items={historyItems} />
                  </Card>
                </section>
              )}
              {items.length === 0 && <PendingEmptyState />}
            </>
          )}
        </div>
      )}
    </div>
  );
}
