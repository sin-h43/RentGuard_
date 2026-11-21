import { query } from '@/lib/db';
import { route } from '@/lib/http';

export const GET = route(['ADMIN'], async () => ({
  users: await query(
    `SELECT u.user_id AS "userId", u.full_name AS "fullName", u.email, u.role, u.phone, u.is_active AS "isActive",
            COALESCE(o.kyc_verified, t.id_verified, false) AS verified
       FROM app_user u
       LEFT JOIN owner_profile o ON o.owner_id = u.user_id
       LEFT JOIN tenant_profile t ON t.tenant_id = u.user_id
      WHERE u.role <> 'ADMIN'
      ORDER BY u.role, u.user_id`,
  ),
}));
