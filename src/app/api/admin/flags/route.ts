import { query } from '@/lib/db';
import { route } from '@/lib/http';

export const GET = route(['ADMIN'], async ({ req }) => {
  const status = req.nextUrl.searchParams.get('status');
  const flags = await query(
    `SELECT f.flag_id AS "flagId", f.flag_type AS "flagType", f.severity, f.source, f.status, f.evidence,
            f.created_at AS "createdAt", f.owner_id AS "ownerId", u.full_name AS "ownerName", f.property_id AS "propertyId"
       FROM fraud_flag f
       LEFT JOIN app_user u ON u.user_id = f.owner_id
      WHERE ($1::text IS NULL OR f.status::text = $1)
      ORDER BY (f.status = 'OPEN') DESC, f.severity DESC, f.created_at DESC`,
    [status],
  );
  return { flags };
});
