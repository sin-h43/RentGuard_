import { HttpError, jsonBody, route } from '@/lib/http';
import { tx } from '@/lib/db';
import { leaseSchema } from '@/lib/validators';

/**
 * Owner creates a lease for a tenant whose escrow was RELEASED (verified visit).
 * Price lock: the lease uses the terms of the listing version the tenant SAW,
 * so a later price hike cannot be applied to them.
 * The exclusion constraint on lease rejects overlapping live leases for one property.
 */
export const POST = route(['OWNER'], async ({ req, session }) => {
  const b = leaseSchema.parse(await jsonBody(req));
  if (b.endDate <= b.startDate) throw new HttpError(400, 'End date must be after the start date.');

  return tx(async (c) => {
    const { rows } = await c.query(
      `SELECT i.tenant_id, i.property_id, i.seen_version_id, lv.monthly_rent, lv.security_deposit, e.status
         FROM inquiry i
         JOIN property p ON p.property_id = i.property_id
         JOIN listing_version lv ON lv.version_id = i.seen_version_id
         LEFT JOIN escrow e ON e.inquiry_id = i.inquiry_id
        WHERE i.inquiry_id = $1 AND p.owner_id = $2
        FOR UPDATE OF i`,
      [b.inquiryId, session!.uid],
    );
    const r = rows[0];
    if (!r) throw new HttpError(404, 'Inquiry not found for your properties.');
    if (r.status !== 'RELEASED') throw new HttpError(409, 'A lease needs a completed visit (escrow RELEASED).');

    const ins = await c.query(
      `INSERT INTO lease (property_id, tenant_id, agreed_version_id, start_date, end_date, monthly_rent, security_deposit, status)
       VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, 'ACTIVE') RETURNING lease_id AS "leaseId"`,
      [r.property_id, r.tenant_id, r.seen_version_id, b.startDate, b.endDate, r.monthly_rent, r.security_deposit],
    );
    return ins.rows[0];
  });
});
