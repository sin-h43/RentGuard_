import { Pool, PoolClient, QueryResultRow, types } from 'pg';
import { env } from './env';

// numeric / bigint -> JS numbers, DATE -> 'YYYY-MM-DD' string (no timezone shifts)
types.setTypeParser(1700, (v) => parseFloat(v));
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1082, (v) => v);

const g = globalThis as unknown as { __rgPool?: Pool };

export function pool(): Pool {
  if (!g.__rgPool) {
    g.__rgPool = new Pool({ connectionString: env.databaseUrl, max: 10 });
  }
  return g.__rgPool;
}

export async function query<T extends QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool().query<T>(text, params as any[]);
  return res.rows;
}

export async function one<T extends QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** Run fn inside one ACID transaction (BEGIN ... COMMIT, ROLLBACK on error). */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore rollback failure */
    }
    throw e;
  } finally {
    client.release();
  }
}
