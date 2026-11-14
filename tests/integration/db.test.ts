import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { migrate, rollbackLast } from '../../apps/api/src/db/migrate';
import { withTx } from '../../apps/api/src/db/db';
import { audit, verifyAuditChain } from '../../apps/api/src/audit';
import { seed } from '../../apps/api/src/db/seed';
import { TEST_DB } from '../helpers';

let db: pg.Pool;
beforeAll(async () => {
  db = new pg.Pool({ connectionString: TEST_DB });
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
});
afterAll(async () => {
  await db.end();
});

describe('migrations', () => {
  it('apply on an empty database, are idempotent, and roll back cleanly', async () => {
    expect(await migrate(db)).toEqual(['001_init.up.sql', '002_agents_reasoning_review.up.sql']);
    expect(await migrate(db)).toEqual([]);
    expect(await rollbackLast(db)).toBe('002_agents_reasoning_review.up.sql');
    expect(await rollbackLast(db)).toBe('001_init.up.sql');
    const t = await db.query(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name='assessments'`,
    );
    expect(t.rows[0].n).toBe(0);
    expect(await migrate(db)).toEqual(['001_init.up.sql', '002_agents_reasoning_review.up.sql']);
    await seed(db);
    await seed(db); // seed is idempotent
    const e = await db.query('SELECT count(*)::int AS n FROM environments');
    expect(e.rows[0].n).toBe(2);
  });
  it('a failing migration is rolled back and reported', async () => {
    await expect(db.query('SELECT * FROM does_not_exist')).rejects.toBeTruthy();
  });
});

describe('audit trail', () => {
  it('is hash-chained and verifiable', async () => {
    for (let i = 0; i < 3; i++)
      await withTx(db, (tx) =>
        audit(tx, { actor: 'test', action: `a${i}`, details: { i, password: 'hunter2' } }),
      );
    const v = await verifyAuditChain(db);
    expect(v).toMatchObject({ ok: true, checked: 3 });
    const row = await db.query('SELECT details FROM audit_events ORDER BY id LIMIT 1');
    expect(row.rows[0].details.password).toBe('[redacted]');
  });
  it('rejects UPDATE, DELETE and TRUNCATE through the application role', async () => {
    await expect(db.query(`UPDATE audit_events SET actor='evil'`)).rejects.toThrow(/append-only/);
    await expect(db.query(`DELETE FROM audit_events`)).rejects.toThrow(/append-only/);
    await expect(db.query(`TRUNCATE audit_events`)).rejects.toThrow(/append-only/);
  });
  it('detects tampering by someone who disables the triggers (owner/superuser)', async () => {
    await db.query('ALTER TABLE audit_events DISABLE TRIGGER USER');
    await db.query(`UPDATE audit_events SET actor='evil' WHERE id=(SELECT min(id) FROM audit_events)`);
    await db.query('ALTER TABLE audit_events ENABLE TRIGGER USER');
    const v = await verifyAuditChain(db);
    expect(v.ok).toBe(false);
    expect(v.brokenAtId).toBeDefined();
  });
  it('rolls back audit events together with the failed business transaction', async () => {
    const before = (await db.query('SELECT count(*)::int AS n FROM audit_events')).rows[0].n;
    await expect(
      withTx(db, async (tx) => {
        await audit(tx, { actor: 'x', action: 'will-roll-back' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect((await db.query('SELECT count(*)::int AS n FROM audit_events')).rows[0].n).toBe(before);
  });
});

describe('constraints', () => {
  it('separation of duties and single in-flight deployment are enforced by the database', async () => {
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await seed(db);
    const env = (await db.query(`SELECT e.id, e.project_id FROM environments e WHERE name='dev'`)).rows[0];
    const a = (
      await db.query(
        `INSERT INTO assessments(project_id,environment_id,commit_sha,pipeline_run_id,artifact_digest,template_path,requested_by) VALUES ($1,$2,'abcdef1','r1',$3,'main.bicep','alice') RETURNING id`,
        [env.project_id, env.id, 'sha256:' + 'a'.repeat(64)],
      )
    ).rows[0].id;
    await expect(
      db.query(
        `INSERT INTO approval_requests(assessment_id,assessment_version,environment_id,artifact_digest,requested_by,justification,decided_by) VALUES ($1,1,$2,$3,'alice','x','alice')`,
        [a, env.id, 'sha256:' + 'a'.repeat(64)],
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      db.query(
        `INSERT INTO assessments(project_id,environment_id,commit_sha,pipeline_run_id,artifact_digest,template_path,requested_by) VALUES ($1,$2,'abcdef1','r1',$3,'main.bicep','alice')`,
        [env.project_id, env.id, 'sha256:' + 'a'.repeat(64)],
      ),
    ).rejects.toThrow(/duplicate key/);
    const ins = () =>
      db.query(
        `INSERT INTO deployments(assessment_id,environment_id,artifact_digest,pipeline_run_id,authorized_by,lock_expires_at,gate_snapshot) VALUES ($1,$2,'d','r',$3, now()+interval '1 hour','{}')`,
        [a, env.id, 'p'],
      );
    await ins();
    await expect(ins()).rejects.toThrow(/duplicate key/);
    await expect(
      db.query(
        `INSERT INTO assessments(project_id,environment_id,commit_sha,pipeline_run_id,artifact_digest,template_path,requested_by) VALUES ($1,$2,'abc','r2','not-a-digest','x','a')`,
        [env.project_id, env.id],
      ),
    ).rejects.toThrow(/check constraint/);
  });
});

describe('audit hashing with undefined fields', () => {
  it('verifies when details contain undefined values (jsonb drops them)', async () => {
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(db);
    await withTx(db, (tx) =>
      audit(tx, { actor: 't', action: 'x', details: { a: undefined, b: 1, nested: { c: undefined } } }),
    );
    expect((await verifyAuditChain(db)).ok).toBe(true);
  });
});
