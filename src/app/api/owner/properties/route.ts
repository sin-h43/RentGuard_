import { query } from '@/lib/db';
import { jsonBody, route } from '@/lib/http';
import { propertySchema } from '@/lib/validators';

export const POST = route(['OWNER'], async ({ req, session }) => {
  const b = propertySchema.parse(await jsonBody(req));
  const rows = await query(
    `INSERT INTO property (owner_id, property_type) VALUES ($1, $2) RETURNING property_id AS "propertyId"`,
    [session!.uid, b.propertyType],
  );
  return rows[0];
});
