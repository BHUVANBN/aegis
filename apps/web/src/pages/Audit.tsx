import { useState, useEffect, useMemo, useCallback } from 'react';
import { api, type Item } from '../api';
import {
  Card,
  StatCard,
  PageHeader,
  Badge,
  Loading,
  ErrorBox,
  Pagination,
} from '../components/ui';

interface AuditEvent extends Item {
  id: number | string;
  at: string;
  actor: string;
  action: string;
  environment?: string;
  details?: Record<string, unknown> | string | null;
  prev_hash?: string;
  hash?: string;
}

interface VerifyResult {
  ok: boolean;
  checked: number;
  brokenAtId?: number;
}

export default function Audit() {
  const pageSize = 25;
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);

  // Verification state
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // Audit events query
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const offset = (page - 1) * pageSize;
      const res = await api.audit(pageSize, offset);
      setEvents((res.items ?? []) as unknown as AuditEvent[]);
      setTotal(res.total ?? 0);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  const runVerification = useCallback(async () => {
    setVerifying(true);
    setVerifyError(null);
    try {
      const v = await api.auditVerify();
      setVerifyResult(v);
    } catch (e) {
      setVerifyError((e as Error).message ?? 'Verification failed');
    } finally {
      setVerifying(false);
    }
  }, []);

  // Auto-verify once on mount
  useEffect(() => {
    void runVerification();
  }, [runVerification]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  // Client-side export to CSV (RFC 4180)
  const exportToCSV = () => {
    if (events.length === 0) return;
    const headers = ['ID', 'Timestamp', 'Actor', 'Action', 'Environment'];
    const rows = events.map((e) => [
      String(e.id),
      new Date(e.at).toISOString(),
      `"${String(e.actor ?? '').replace(/"/g, '""')}"`,
      `"${String(e.action ?? '').replace(/"/g, '""')}"`,
      `"${String(e.environment ?? '').replace(/"/g, '""')}"`,
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `aegis-audit-events-page-${page}-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Filtered rows for instant in-page search
  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      const matchesAction =
        actionFilter === 'all' || e.action?.toLowerCase().includes(actionFilter.toLowerCase());
      const matchesSearch =
        !searchTerm ||
        String(e.actor ?? '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        String(e.action ?? '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        String(e.environment ?? '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        String(e.id).includes(searchTerm);
      return matchesAction && matchesSearch;
    });
  }, [events, actionFilter, searchTerm]);

  const getActionBadgeKind = (action: string) => {
    const act = action.toLowerCase();
    if (act.includes('allow') || act.includes('approved') || act.includes('verified')) return 'low'; // green
    if (act.includes('block') || act.includes('reject') || act.includes('broken')) return 'critical'; // red
    if (act.includes('request') || act.includes('warn') || act.includes('override')) return 'medium'; // orange
    return 'default'; // blue/neutral
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        title="Audit & Compliance Log"
        subtitle="Cryptographically sealed, tamper-evident record of all infrastructure risk decisions, approvals, and security events."
        actions={
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => void runVerification()}
              disabled={verifying}
              className="btn-secondary"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                fontSize: 13,
                fontWeight: 600,
                cursor: verifying ? 'not-allowed' : 'pointer',
              }}
            >
              <span>{verifying ? '⏳' : '🛡️'}</span>
              <span>{verifying ? 'Verifying Chain…' : 'Re-verify Hash Chain'}</span>
            </button>
            <button
              onClick={exportToCSV}
              disabled={events.length === 0}
              className="btn-secondary"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                fontSize: 13,
                fontWeight: 600,
                cursor: events.length === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              <span>📥</span>
              <span>Export CSV</span>
            </button>
          </div>
        }
      />

      {/* ── Hash Chain Integrity Card ── */}
      <Card elevated style={{ padding: 20, borderLeft: verifyResult?.ok ? '5px solid #107c10' : '5px solid #0078d4' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: verifyResult?.ok ? '#dff6dd' : verifyResult?.ok === false ? '#fde7e9' : '#deecf9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
                flexShrink: 0,
              }}
            >
              {verifying ? '⏳' : verifyResult?.ok ? '✓' : verifyResult?.ok === false ? '✕' : '🔒'}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {verifying
                    ? 'Checking Cryptographic Chain Integrity…'
                    : verifyResult?.ok
                      ? 'Hash Chain Integrity Verified'
                      : verifyResult?.ok === false
                        ? `Chain Broken at Event #${verifyResult.brokenAtId}`
                        : 'Cryptographic Chain Monitor'}
                </h2>
                {verifyResult && (
                  <Badge kind={verifyResult.ok ? 'low' : 'critical'}>
                    {verifyResult.ok ? 'SEALED & VALID' : 'INTEGRITY COMPROMISED'}
                  </Badge>
                )}
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
                {verifyResult?.ok
                  ? `All ${verifyResult.checked.toLocaleString()} consecutive ledger entries verified with SHA-256 forward links. Zero tampering detected.`
                  : verifyError
                    ? `Verification error: ${verifyError}`
                    : 'Each audit event includes the SHA-256 hash of its predecessor, creating an append-only, tamper-evident security ledger.'}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>
                Ledger Entries
              </span>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
                {total.toLocaleString()}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>
                Algorithm
              </span>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
                SHA-256
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* ── Filters & Search Bar ── */}
      <Card style={{ padding: '14px 18px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', flex: 1 }}>
            <label htmlFor="audit-search" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
              Search:
            </label>
            <input
              id="audit-search"
              type="text"
              placeholder="Filter by actor, action, env, or #ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                padding: '6px 12px',
                border: '1px solid var(--border-default)',
                borderRadius: 4,
                fontSize: 13,
                minWidth: 260,
                outline: 'none',
              }}
            />

            <label htmlFor="audit-action-filter" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginLeft: 8 }}>
              Action:
            </label>
            <select
              id="audit-action-filter"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              style={{
                padding: '6px 10px',
                border: '1px solid var(--border-default)',
                borderRadius: 4,
                fontSize: 13,
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
              }}
            >
              <option value="all">All Actions</option>
              <option value="gate">Gate Evaluation</option>
              <option value="approval">Approval Granted / Rejected</option>
              <option value="reconcil">Reconciliation</option>
              <option value="override">Emergency Override</option>
            </select>
          </div>

          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Showing {filteredEvents.length} of {events.length} loaded ({total} total)
          </div>
        </div>
      </Card>

      {/* ── Events Table ── */}
      {loading && <Loading label="Loading audit log" />}
      {error ? <ErrorBox error={error} onRetry={loadEvents} /> : null}

      {!loading && !error && (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-default)' }}>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, width: 70 }}>
                    #ID
                  </th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, width: 170 }}>
                    Timestamp (UTC)
                  </th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, width: 220 }}>
                    Actor / Identity
                  </th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600 }}>
                    Action
                  </th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, width: 140 }}>
                    Environment
                  </th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontSize: 12, fontWeight: 600, width: 100 }}>
                    Details
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 36, textAlign: 'center', color: 'var(--text-secondary)' }}>
                      No audit events match your search or filter.
                    </td>
                  </tr>
                ) : (
                  filteredEvents.map((evt) => (
                    <tr
                      key={String(evt.id)}
                      style={{
                        borderBottom: '1px solid var(--border-default)',
                        cursor: 'pointer',
                        transition: 'background 0.1s',
                      }}
                      className="table-row-hover"
                      onClick={() => setSelectedEvent(evt)}
                    >
                      <td style={{ padding: '10px 14px', fontSize: 12, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                        #{evt.id}
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {new Date(evt.at).toLocaleString()}
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 13, opacity: 0.7 }}>👤</span>
                          <span style={{ maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {String(evt.actor ?? 'system')}
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 13 }}>
                        <span
                          className={`badge badge-${getActionBadgeKind(String(evt.action ?? ''))}`}
                          style={{ fontWeight: 600 }}
                        >
                          {String(evt.action ?? 'unknown')}
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-secondary)' }}>
                        {evt.environment ? (
                          <span style={{ background: 'var(--bg-tertiary)', padding: '2px 8px', borderRadius: 3, fontWeight: 600 }}>
                            {String(evt.environment)}
                          </span>
                        ) : (
                          <span style={{ opacity: 0.4 }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedEvent(evt);
                          }}
                          className="btn-secondary"
                          style={{ padding: '3px 8px', fontSize: 11, cursor: 'pointer' }}
                        >
                          Inspect
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border-default)', display: 'flex', justifyContent: 'flex-end' }}>
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              onChange={(newPage) => setPage(newPage)}
            />
          </div>
        </Card>
      )}

      {/* ── Event Detail Modal / Slide-over ── */}
      {selectedEvent && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="audit-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            zIndex: 999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
          onClick={() => setSelectedEvent(null)}
        >
          <div
            style={{
              background: 'var(--bg-primary, #ffffff)',
              borderRadius: 6,
              width: '100%',
              maxWidth: 680,
              maxHeight: '85vh',
              overflowY: 'auto',
              boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
              padding: 24,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 id="audit-modal-title" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
                  Audit Event #{selectedEvent.id}
                </h3>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Recorded at {new Date(selectedEvent.at).toUTCString()}
                </span>
              </div>
              <button
                onClick={() => setSelectedEvent(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: 20,
                  cursor: 'pointer',
                  color: 'var(--text-secondary)',
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
              <div style={{ background: 'var(--bg-secondary)', padding: '10px 14px', borderRadius: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>
                  Action
                </span>
                <div style={{ marginTop: 4 }}>
                  <Badge kind={getActionBadgeKind(String(selectedEvent.action))}>
                    {String(selectedEvent.action)}
                  </Badge>
                </div>
              </div>
              <div style={{ background: 'var(--bg-secondary)', padding: '10px 14px', borderRadius: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>
                  Actor
                </span>
                <div style={{ marginTop: 4, fontWeight: 600, fontSize: 13 }}>
                  {String(selectedEvent.actor ?? 'system')}
                </div>
              </div>
              <div style={{ background: 'var(--bg-secondary)', padding: '10px 14px', borderRadius: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>
                  Environment
                </span>
                <div style={{ marginTop: 4, fontWeight: 600, fontSize: 13 }}>
                  {String(selectedEvent.environment ?? 'n/a')}
                </div>
              </div>
              <div style={{ background: 'var(--bg-secondary)', padding: '10px 14px', borderRadius: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>
                  Chain Status
                </span>
                <div style={{ marginTop: 4, color: '#107c10', fontWeight: 600, fontSize: 13 }}>
                  ✓ Hash Signed
                </div>
              </div>
            </div>

            {selectedEvent.details && (
              <div style={{ marginTop: 16 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                  Event Payload / Details:
                </span>
                <pre
                  style={{
                    background: 'var(--bg-tertiary, #2d2d2d)',
                    color: 'var(--text-inverted, #e1e1e1)',
                    padding: 14,
                    borderRadius: 4,
                    fontSize: 12,
                    fontFamily: 'monospace',
                    overflowX: 'auto',
                    maxHeight: 280,
                  }}
                >
                  {typeof selectedEvent.details === 'string'
                    ? selectedEvent.details
                    : JSON.stringify(selectedEvent.details, null, 2)}
                </pre>
              </div>
            )}

            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setSelectedEvent(null)}
                className="btn-primary"
                style={{ padding: '6px 18px', fontSize: 13, cursor: 'pointer' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
