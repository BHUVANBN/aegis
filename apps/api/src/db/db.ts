import pg from 'pg';

export type Db = pg.Pool;
export type Tx = pg.PoolClient;
export type Queryable = Pick<pg.Pool, 'query'>;

export function createPool(url: string, ssl: boolean): Db {
  return new pg.Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30000,
    ssl: ssl ? { rejectUnauthorized: true } : undefined,
  });
}

/** Runs fn inside a transaction; commits on success, rolls back on any error. */
export async function withTx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
