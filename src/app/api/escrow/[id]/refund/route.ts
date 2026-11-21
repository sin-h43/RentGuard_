import { one, tx } from '@/lib/db';
import { HttpError, intParam, route } from '@/lib/http';

// Who may refund: admin (always) / the owner (cancelling) / the tenant once the visit window has expired.
export const POST = route(['TENANT', 'OWNER', 'ADMIN'], async ({ session, params }) => {
  const id = intParam(params.id);
  const e = await one<{ tenant_id: number; owner_id: number; status: string; expired: boolean }>(
    'SELECT tenant_id, owner_id, status, otp_expires_at < now() AS expired FROM escrow WHERE escrow_id = $1',
    [id],
  );
  if (!e) throw new HttpError(404, 'Escrow not found.');
  const s = session!;
  const allowed =
    s.role === 'ADMIN' || (s.role === 'OWNER' && e.owner_id === s.uid) || (s.role === 'TENANT' && e.tenant_id === s.uid && e.expired);
  if (!allowed) {
    throw new HttpError(403, s.role === 'TENANT' ? 'You can claim a refund only after the visit window has expired.' : 'Not allowed.');
  }
  await tx((c) => c.query('CALL sp_refund_escrow($1::bigint)', [id]));
  return { escrowId: id, status: 'REFUNDED' };
});
