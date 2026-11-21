import { env } from '@/lib/env';
import { one } from '@/lib/db';
import { GRAPH_COUNTS, REL_COUNT } from '@/lib/graph/cypher';
import { neo4jRunner } from '@/lib/neo4j';
import { route } from '@/lib/http';

// Never fails: the dashboard shows "not connected" instead of an error page when Neo4j is down.
export const GET = route(['ADMIN'], async () => {
  const pending = await one<{ n: number }>('SELECT count(*)::int AS n FROM graph_outbox WHERE processed_at IS NULL');
  if (!env.neo4jConfigured) return { configured: false, connected: false, pendingEvents: pending?.n ?? 0 };
  try {
    const g = neo4jRunner();
    const [nodes, rels] = await Promise.all([g.read(GRAPH_COUNTS), g.read(REL_COUNT)]);
    return { configured: true, connected: true, pendingEvents: pending?.n ?? 0, nodes, relationships: rels };
  } catch (e) {
    return { configured: true, connected: false, error: (e as Error).message, pendingEvents: pending?.n ?? 0 };
  }
});
