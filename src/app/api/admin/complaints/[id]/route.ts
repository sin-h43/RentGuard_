import { query } from '@/lib/db';
import { HttpError, intParam, jsonBody, route } from '@/lib/http';
import { complaintReviewSchema } from '@/lib/validators';

// The CHECK constraint on complaint requires resolved_by for RESOLVED / REJECTED, so we always set it.
export const PATCH = route(['ADMIN'], async ({ req, session, params }) => {
  const id = intParam(params.id);
  const { status } = complaintReviewSchema.parse(await jsonBody(req));
  const rows = await query(
    `UPDATE complaint SET status = $2::complaint_status, resolved_by = $3
      WHERE complaint_id = $1 RETURNING complaint_id AS "complaintId", status`,
    [id, status, session!.uid],
  );
  if (!rows[0]) throw new HttpError(404, 'Complaint not found.');
  return rows[0];
});
