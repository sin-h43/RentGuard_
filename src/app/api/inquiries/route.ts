import { one, query } from '@/lib/db';
import { HttpError, jsonBody, route } from '@/lib/http';
import { inquirySchema } from '@/lib/validators';

// A tenant's inquiry pins the EXACT listing version they were looking at.
// If the owner later changes the price, that row is the evidence (bait-and-switch).
export const POST = route(['TENANT'], async ({ req, session }) => {
  const b = inquirySchema.parse(await jsonBody(req));
  const active = await one('SELECT 1 AS ok FROM property WHERE property_id = $1 AND is_active', [b.propertyId]);
  if (!active) throw new HttpError(404, 'This listing is not available.');

  // composite FK (seen_version_id, property_id) rejects a version that belongs to another property
  const rows = await query(
    `INSERT INTO inquiry (tenant_id, property_id, seen_version_id, message)
     VALUES ($1, $2, $3, $4) RETURNING inquiry_id AS "inquiryId"`,
    [session!.uid, b.propertyId, b.seenVersionId, b.message ?? null],
  );
  return rows[0];
});
