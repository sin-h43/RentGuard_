import { one } from '@/lib/db';
import { HttpError, intParam, route } from '@/lib/http';

// Either party can freeze a HELD escrow; an admin then decides (refund).
export const POST = route(['TENANT', 'OWNER'], async ({ session, params }) => {
  const id = intParam(params.id);
  const col = session!.role === 'TENANT' ? 'tenant_id' : 'owner_id';
  const row = await one(
    `UPDATE escrow SET status = 'DISPUTED'
      WHERE escrow_id = $1 AND ${col} = $2 AND status = 'HELD'
      RETURNING escrow_id AS "escrowId", status`,
    [id, session!.uid],
  );
  if (!row) throw new HttpError(409, 'Only your own escrow that is still HELD can be disputed.');
  return row;
});
