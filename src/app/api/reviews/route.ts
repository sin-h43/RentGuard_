import { query } from '@/lib/db';
import { jsonBody, route } from '@/lib/http';
import { reviewSchema } from '@/lib/validators';

// trg_review_guard (database) rejects reviews unless the lease has run for 30 days;
// the composite FK (lease_id, tenant_id) rejects reviewing someone else's lease.
export const POST = route(['TENANT'], async ({ req, session }) => {
  const b = reviewSchema.parse(await jsonBody(req));
  const rows = await query(
    `INSERT INTO review (lease_id, tenant_id, rating, comment)
     VALUES ($1, $2, $3, $4) RETURNING review_id AS "reviewId"`,
    [b.leaseId, session!.uid, b.rating, b.comment ?? null],
  );
  return rows[0];
});
