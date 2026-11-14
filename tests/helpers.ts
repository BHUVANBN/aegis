import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import { loadConfig, type Config } from '../apps/api/src/config.js';
import { createApp, type AegisApp } from '../apps/api/src/app.js';
import { seed } from '../apps/api/src/db/seed.js';
import { NullProvider } from '../apps/api/src/llm/provider.js';
import type { ResourceGraphClient } from '../apps/api/src/azure/resourceGraph.js';

export const TEST_DB =
  process.env.TEST_DATABASE_URL ?? 'postgres://aegis:aegis_dev_pw@localhost:5432/aegis_test';

export function fixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
}
export const digestOf = (s: string): string =>
  'sha256:' + crypto.createHash('sha256').update(s).digest('hex');
export const tok = (oid: string, roles: string): string => `Bearer dev:${oid}:${roles}`;
export const ALICE = tok('alice@example.test', 'assessor,viewer');
export const BOB = tok('bob@example.test', 'approver,viewer');
export const CAROL = tok('carol@example.test', 'admin,viewer');
export const PIPE = tok('pipeline@example.test', 'pipeline');

export class MockArg implements ResourceGraphClient {
  calls: string[] = [];
  constructor(private handler: (kql: string) => Record<string, unknown>[] | Error = () => []) {}
  async query(kql: string): Promise<Record<string, unknown>[]> {
    this.calls.push(kql);
    const r = this.handler(kql);
    if (r instanceof Error) throw r;
    return r;
  }
}

export function testConfig(over: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DB,
    AUTH_MODE: 'dev',
    RATE_LIMIT_PER_MINUTE: '10000',
    ...over,
  } as NodeJS.ProcessEnv);
}

export async function freshDb(): Promise<pg.Pool> {
  const pool = new pg.Pool({ connectionString: TEST_DB });
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await seed(pool);
  return pool;
}

export async function makeApp(
  arg: ResourceGraphClient | null,
  over: Record<string, string> = {},
): Promise<{ app: AegisApp; db: pg.Pool; cfg: Config }> {
  const db = await freshDb();
  const cfg = testConfig(over);
  const app = createApp({ db, cfg, arg, llm: new NullProvider() });
  return { app, db, cfg };
}
