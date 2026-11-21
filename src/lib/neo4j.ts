import neo4j, { Driver } from 'neo4j-driver';
import { env } from './env';
import type { CypherRunner } from './graph/types';

const g = globalThis as unknown as { __rgNeo?: Driver };

export function driver(): Driver {
  if (!g.__rgNeo) {
    g.__rgNeo = neo4j.driver(env.neo4jUri, neo4j.auth.basic(env.neo4jUser, env.neo4jPassword), {
      disableLosslessIntegers: true, // return plain JS numbers
    });
  }
  return g.__rgNeo;
}

export function neo4jRunner(): CypherRunner {
  return {
    async read(cypher, params = {}) {
      const s = driver().session();
      try {
        const r = await s.executeRead((tx) => tx.run(cypher, params));
        return r.records.map((rec) => rec.toObject());
      } finally {
        await s.close();
      }
    },
    async write(cypher, params = {}) {
      const s = driver().session();
      try {
        const r = await s.executeWrite((tx) => tx.run(cypher, params));
        return r.records.map((rec) => rec.toObject());
      } finally {
        await s.close();
      }
    },
  };
}

export async function closeDriver() {
  if (g.__rgNeo) {
    await g.__rgNeo.close();
    g.__rgNeo = undefined;
  }
}
