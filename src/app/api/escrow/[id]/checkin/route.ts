import { one, tx } from '@/lib/db';
import { intParam, jsonBody, route } from '@/lib/http';
import { checkinSchema } from '@/lib/validators';

// Tenant: confirms presence.  Owner: enters the tenant's one-time code.
// When both are done, sp_checkin releases the money (minus platform fee) in the same transaction.
export const POST = route(['TENANT', 'OWNER'], async ({ req, session, params }) => {
  const id = intParam(params.id);
  const { otp } = checkinSchema.parse(await jsonBody(req).catch(() => ({})));
  await tx((c) => c.query('CALL sp_checkin($1::bigint, $2::bigint, $3::text)', [id, session!.uid, otp ?? null]));
  return one(
    `SELECT escrow_id AS "escrowId", status, tenant_checkin_at AS "tenantCheckinAt", owner_checkin_at AS "ownerCheckinAt"
       FROM escrow WHERE escrow_id = $1`,
    [id],
  );
});
