import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { Db } from './db.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Applies *.up.sql files in name order, each in its own transaction, recorded in schema_migrations. */
export async function migrate(db: Db): Promise<string[]> {
  await db.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  const applied = new Set(
    (await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
  );
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.up.sql'))
    .sort();
  const ran: string[] = [];
  for (const f of files) {
    if (applied.has(f)) continue;
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
      await client.query('COMMIT');
      ran.push(f);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
    } finally {
      client.release();
    }
  }
  return ran;
}

/** Applies the matching *.down.sql for the most recent migration (dev/test only). */
export async function rollbackLast(db: Db): Promise<string | null> {
  const last = (
    await db.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1')
  ).rows[0];
  if (!last) return null;
  const downFile = last.name.replace('.up.sql', '.down.sql');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(fs.readFileSync(path.join(dir, downFile), 'utf8'));
    await client.query('DELETE FROM schema_migrations WHERE name=$1', [last.name]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
  return last.name;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const pool = new pg.Pool({
    connectionString: url,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  });
  const down = process.argv.includes('--down');
  (down
    ? rollbackLast(pool).then((n) => console.log('rolled back', n))
    : migrate(pool).then((r) => console.log('applied', r))
  )
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
