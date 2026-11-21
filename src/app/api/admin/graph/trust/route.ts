import { route } from '@/lib/http';
import { computeTrust } from '@/lib/graph/detect';
import { graphRunner, graphUnavailable, pgDb } from '@/lib/graphApi';

// Personalised PageRank from ID-verified tenants over VERIFIED_STAY edges -> owner_profile.trust_score
export const POST = route(['ADMIN'], async () => {
  try {
    return { trust: await computeTrust(graphRunner(), pgDb) };
  } catch (e) {
    graphUnavailable(e);
  }
});
