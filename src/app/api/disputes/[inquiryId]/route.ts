import { one, query } from '@/lib/db';
import { HttpError, intParam, route } from '@/lib/http';

const FIELDS = ['title', 'monthly_rent', 'security_deposit', 'address_line', 'contact_phone', 'photo_digest'] as const;

/**
 * Bitemporal dispute evidence for one inquiry:
 *   seen      - the version the tenant was shown (pinned FK)
 *   asOf      - what the database KNEW at the moment of the inquiry (fn_listing_as_of)
 *   current   - the latest published version
 *   changed   - which fields differ between seen and current
 *   chainIntact - hash-chain verification for the whole property history
 */
export const GET = route(['TENANT', 'OWNER', 'ADMIN'], async ({ session, params }) => {
  const id = intParam(params.inquiryId, 'inquiry id');
  const inq = await one<{ inquiry_id: number; tenant_id: number; property_id: number; seen_version_id: number; created_at: string; owner_id: number }>(
    `SELECT i.inquiry_id, i.tenant_id, i.property_id, i.seen_version_id, i.created_at, p.owner_id
       FROM inquiry i JOIN property p USING (property_id) WHERE i.inquiry_id = $1`,
    [id],
  );
  if (!inq) throw new HttpError(404, 'Inquiry not found.');
  const s = session!;
  const allowed = s.role === 'ADMIN' || (s.role === 'TENANT' && inq.tenant_id === s.uid) || (s.role === 'OWNER' && inq.owner_id === s.uid);
  if (!allowed) throw new HttpError(403, 'You are not a party to this inquiry.');

  const cols = `version_id, seq, title, monthly_rent, security_deposit, address_line, contact_phone, photo_digest, effective_from, recorded_at, row_hash`;
  const [seen, asOf, current, chain] = await Promise.all([
    one(`SELECT ${cols} FROM listing_version WHERE version_id = $1`, [inq.seen_version_id]),
    one(`SELECT ${cols} FROM fn_listing_as_of($1, $2::timestamptz, CURRENT_DATE)`, [inq.property_id, inq.created_at]),
    one(`SELECT ${cols} FROM listing_version WHERE property_id = $1 ORDER BY seq DESC LIMIT 1`, [inq.property_id]),
    query<{ version_seq: number; intact: boolean }>('SELECT version_seq, intact FROM fn_verify_listing_chain($1)', [inq.property_id]),
  ]);
  const changed = FIELDS.filter((f) => seen && current && String((seen as any)[f]) !== String((current as any)[f]));
  return {
    inquiry: { id: inq.inquiry_id, createdAt: inq.created_at, propertyId: inq.property_id },
    seen,
    asOf,
    current,
    changed,
    chainIntact: chain.every((c) => c.intact),
    chain,
  };
});
