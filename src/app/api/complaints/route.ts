import { query } from '@/lib/db';
import { jsonBody, route } from '@/lib/http';
import { complaintSchema } from '@/lib/validators';

// INSERT fires trg_flag_complaints: 3 distinct complainants against one owner in 30 days raise a fraud flag.
export const POST = route(['TENANT'], async ({ req, session }) => {
  const b = complaintSchema.parse(await jsonBody(req));
  const rows = await query(
    `INSERT INTO complaint (property_id, filed_by, category, description)
     VALUES ($1, $2, $3, $4) RETURNING complaint_id AS "complaintId"`,
    [b.propertyId, session!.uid, b.category, b.description],
  );
  return rows[0];
});
