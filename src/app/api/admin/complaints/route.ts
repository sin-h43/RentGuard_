import { query } from '@/lib/db';
import { route } from '@/lib/http';

export const GET = route(['ADMIN'], async () => ({
  complaints: await query(
    `SELECT c.complaint_id AS "complaintId", c.property_id AS "propertyId", c.category, c.description, c.status,
            c.created_at AS "createdAt", t.full_name AS "filedBy", o.full_name AS "ownerName"
       FROM complaint c
       JOIN app_user t ON t.user_id = c.filed_by
       JOIN property p ON p.property_id = c.property_id
       JOIN app_user o ON o.user_id = p.owner_id
      ORDER BY (c.status IN ('OPEN','UNDER_REVIEW')) DESC, c.created_at DESC`,
  ),
}));
