import { route } from '@/lib/http';
import { ensureConstraints } from '@/lib/graph/detect';
import { runSync } from '@/lib/graph/sync';
import { graphRunner, graphUnavailable, withTx } from '@/lib/graphApi';

// Drains the transactional outbox into Neo4j (same code as `npm run graph:sync`).
export const POST = route(['ADMIN'], async () => {
  try {
    const g = graphRunner();
    await ensureConstraints(g);
    return await runSync(withTx, g);
  } catch (e) {
    graphUnavailable(e);
  }
});
