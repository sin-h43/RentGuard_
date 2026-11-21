import { query } from '@/lib/db';
import { route } from '@/lib/http';

export const GET = route(['ADMIN'], async () => ({
  owners: await query(
    `SELECT owner_id AS "ownerId", full_name AS "fullName", CASE WHEN trust_updated_at IS NULL THEN NULL ELSE trust_score END AS "trustScore",
            active_flags AS "activeFlags", complaints, avg_rating AS "avgRating"
       FROM v_owner_risk ORDER BY active_flags DESC, complaints DESC, trust_score ASC`,
  ),
}));
