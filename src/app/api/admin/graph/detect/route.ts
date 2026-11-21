import { route } from '@/lib/http';
import { detect, persistFindings } from '@/lib/graph/detect';
import { graphRunner, graphUnavailable, pgDb } from '@/lib/graphApi';

// Runs the graph traversals in Neo4j, writes the findings into fraud_flag (source = GRAPH)
// and returns the owner clusters for the dashboard.
export const POST = route(['ADMIN'], async () => {
  try {
    const { findings, clusters } = await detect(graphRunner());
    const stored = await persistFindings(pgDb, findings);
    const names = await pgDb.query<{ user_id: number; full_name: string }>('SELECT user_id, full_name FROM app_user WHERE role = $1', ['OWNER']);
    const nameOf = Object.fromEntries(names.map((n) => [n.user_id, n.full_name]));
    return {
      stored,
      clusters: clusters.map((c) => ({ ...c, ownerNames: c.owners.map((o) => nameOf[o] ?? `#${o}`) })),
      findings: findings.map((f) => ({ ownerId: f.ownerId, owner: nameOf[f.ownerId], flagType: f.flagType, severity: f.severity })),
    };
  } catch (e) {
    graphUnavailable(e);
  }
});
