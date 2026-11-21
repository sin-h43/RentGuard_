import { query } from '@/lib/db';
import { HttpError, intParam, jsonBody, route } from '@/lib/http';
import { verifySchema } from '@/lib/validators';

// Admin verifies an owner's KYC or a tenant's ID. Verified tenants are the SEEDS of trust propagation.
export const PATCH = route(['ADMIN'], async ({ req, params }) => {
  const id = intParam(params.id);
  const { verified } = verifySchema.parse(await jsonBody(req));
  const o = await query('UPDATE owner_profile SET kyc_verified = $2 WHERE owner_id = $1 RETURNING owner_id', [id, verified]);
  if (o.length) return { userId: id, verified };
  const t = await query('UPDATE tenant_profile SET id_verified = $2 WHERE tenant_id = $1 RETURNING tenant_id', [id, verified]);
  if (t.length) return { userId: id, verified };
  throw new HttpError(404, 'User not found.');
});
