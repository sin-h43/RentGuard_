import { env } from './env';
import { pool, tx } from './db';
import { HttpError } from './http';
import { neo4jRunner } from './neo4j';
import type { Db } from './graph/types';

export const pgDb: Db = { query: async (t, p) => (await pool().query(t, p as any[])).rows };
export const withTx = <T>(fn: (db: Db) => Promise<T>) => tx((c) => fn({ query: async (t, p) => (await c.query(t, p as any[])).rows }));

export function graphRunner() {
  if (!env.neo4jConfigured) throw new HttpError(503, 'Neo4j is not configured (set NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD).');
  return neo4jRunner();
}

/** Neo4j being down must not look like an application bug. */
export function graphUnavailable(e: unknown): never {
  if (e instanceof HttpError) throw e;
  const msg = (e as Error)?.message ?? 'unknown error';
  if (/ECONNREFUSED|ServiceUnavailable|Could not perform discovery|authentication|Neo\.ClientError\.Security/i.test(msg)) {
    throw new HttpError(503, `Cannot reach Neo4j: ${msg}`);
  }
  throw e;
}
