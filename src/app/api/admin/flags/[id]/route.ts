import { tx } from '@/lib/db';
import { HttpError, intParam, jsonBody, route } from '@/lib/http';
import { flagReviewSchema } from '@/lib/validators';

// Admin decision on a flag. CONFIRMED on a property-level flag takes that listing offline.
// Everything happens in one transaction.
export const PATCH = route(['ADMIN'], async ({ req, session, params }) => {
  const id = intParam(params.id);
  const { status } = flagReviewSchema.parse(await jsonBody(req));
  return tx(async (c) => {
    const { rows } = await c.query(
      `UPDATE fraud_flag SET status = $2::flag_status, reviewed_by = $3
        WHERE flag_id = $1 RETURNING flag_id AS "flagId", property_id, status`,
      [id, status, session!.uid],
    );
    if (!rows[0]) throw new HttpError(404, 'Flag not found.');
    let tookDown = false;
    if (status === 'CONFIRMED' && rows[0].property_id) {
      await c.query('UPDATE property SET is_active = FALSE WHERE property_id = $1', [rows[0].property_id]);
      tookDown = true;
    }
    return { flagId: rows[0].flagId, status, listingTakenDown: tookDown };
  });
});
