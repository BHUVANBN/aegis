import type { Queryable, Tx } from './db/db.js';
import { canonicalJson, sha256Hex } from './util.js';

const GENESIS = 'GENESIS';
const LOCK_KEY = 727001;
const SENSITIVE_KEY_RE = /(secret|password|token|authorization|api[-_]?key|connectionstring)/i;

/** Removes obviously sensitive keys before anything is written to audit details or logs. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SENSITIVE_KEY_RE.test(k) ? '[redacted]' : redact(v, depth + 1),
      ]),
    );
  if (typeof value === 'string' && value.length > 2000) return value.slice(0, 2000) + '...[truncated]';
  return value;
}

export interface AuditInput {
  actor: string;
  action: string;
  assessmentId?: string | null;
  environment?: string | null;
  details?: Record<string, unknown>;
}

/** Appends a hash-chained audit event. MUST be called with the same tx as the state change it records. */
export async function audit(tx: Tx, e: AuditInput): Promise<void> {
  await tx.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
  const last = await tx.query<{ hash: string }>('SELECT hash FROM audit_events ORDER BY id DESC LIMIT 1');
  const prev = last.rows[0]?.hash ?? GENESIS;
  const at = new Date();
  // JSON round-trip drops `undefined` so the hashed form equals what jsonb returns on verification
  const details = JSON.parse(JSON.stringify(redact(e.details ?? {}))) as Record<string, unknown>;
  const hash = sha256Hex(
    prev +
      canonicalJson({
        at: at.toISOString(),
        actor: e.actor,
        action: e.action,
        assessmentId: e.assessmentId ?? null,
        environment: e.environment ?? null,
        details,
      }),
  );
  await tx.query(
    `INSERT INTO audit_events(at, actor, action, assessment_id, environment, details, prev_hash, hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      at,
      e.actor,
      e.action,
      e.assessmentId ?? null,
      e.environment ?? null,
      JSON.stringify(details),
      prev,
      hash,
    ],
  );
}

/** Recomputes the whole chain. Detects edits made by someone who bypassed the triggers, unless they also rewrote every later hash. */
export async function verifyAuditChain(
  db: Queryable,
): Promise<{ ok: boolean; checked: number; brokenAtId?: number }> {
  const rows = await db.query<{
    id: string;
    at: Date;
    actor: string;
    action: string;
    assessment_id: string | null;
    environment: string | null;
    details: Record<string, unknown>;
    prev_hash: string;
    hash: string;
  }>('SELECT * FROM audit_events ORDER BY id ASC');
  let prev = GENESIS;
  for (const r of rows.rows) {
    const expected = sha256Hex(
      prev +
        canonicalJson({
          at: new Date(r.at).toISOString(),
          actor: r.actor,
          action: r.action,
          assessmentId: r.assessment_id,
          environment: r.environment,
          details: r.details,
        }),
    );
    if (r.prev_hash !== prev || r.hash !== expected)
      return { ok: false, checked: rows.rows.length, brokenAtId: Number(r.id) };
    prev = r.hash;
  }
  return { ok: true, checked: rows.rows.length };
}
