// Usage:  npm run graph:sync            (one pass)
//         npm run graph:sync -- --watch  (poll every 10 s)
// Consumes graph_outbox (PostgreSQL) and mirrors changes into Neo4j.
import { pool, tx } from '../src/lib/db';
import { closeDriver, neo4jRunner } from '../src/lib/neo4j';
import { ensureConstraints } from '../src/lib/graph/detect';
import { runSync } from '../src/lib/graph/sync';

const watch = process.argv.includes('--watch');
const graph = neo4jRunner();

async function once() {
  const out = await runSync((fn) => tx((c) => fn({ query: async (t, p) => (await c.query(t, p as any[])).rows })), graph);
  console.log(`[graph-sync] processed ${out.processed} outbox events; accounts synced: ${out.accounts.owners} owners, ${out.accounts.tenants} tenants`);
}

async function main() {
  await ensureConstraints(graph);
  do {
    try {
      await once();
    } catch (e) {
      console.error('[graph-sync] failed, will retry:', (e as Error).message);
    }
    if (watch) await new Promise((r) => setTimeout(r, 10_000));
  } while (watch);
  await closeDriver();
  await pool().end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
