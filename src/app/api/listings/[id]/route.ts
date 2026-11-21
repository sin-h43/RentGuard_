import { one, query } from '@/lib/db';
import { HttpError, intParam, route } from '@/lib/http';

export const GET = route(null, async ({ session, params }) => {
  const id = intParam(params.id);

  const cur = await one(
    `SELECT c.property_id AS "propertyId", c.version_id AS "versionId", c.title, c.property_type AS "propertyType",
            c.monthly_rent AS "monthlyRent", c.security_deposit AS "securityDeposit",
            c.locality, c.city, c.pincode, c.amenities, c.effective_from AS "effectiveFrom", c.recorded_at AS "recordedAt",
            lv.address_line AS "addressLine", lv.contact_phone AS "contactPhone",
            c.owner_id AS "ownerId", u.full_name AS "ownerName", o.trust_score AS "trustScore", (o.trust_updated_at IS NOT NULL) AS "trustScored", o.kyc_verified AS "kycVerified",
            EXISTS (SELECT 1 FROM fraud_flag f WHERE f.status = 'OPEN' AND f.severity >= 3
                     AND (f.owner_id = c.owner_id OR f.property_id = c.property_id)) AS "underReview"
       FROM v_current_listing c
       JOIN listing_version lv ON lv.version_id = c.version_id
       JOIN owner_profile o ON o.owner_id = c.owner_id
       JOIN app_user u ON u.user_id = c.owner_id
      WHERE c.property_id = $1`,
    [id],
  );
  if (!cur) throw new HttpError(404, 'Listing not found.');

  const [photos, history, chain, reviews, ownerRating] = await Promise.all([
    query<{ sha256: string }>('SELECT sha256 FROM listing_photo WHERE version_id = $1 ORDER BY position', [cur.versionId]),
    // public price history: every version ever published (append-only table)
    query(
      `SELECT seq, monthly_rent AS "monthlyRent", security_deposit AS "securityDeposit",
              effective_from AS "effectiveFrom", recorded_at AS "recordedAt"
         FROM listing_version WHERE property_id = $1 ORDER BY seq`,
      [id],
    ),
    one<{ intact: boolean; versions: number }>(
      'SELECT COALESCE(bool_and(intact), true) AS intact, count(*)::int AS versions FROM fn_verify_listing_chain($1)',
      [id],
    ),
    query(
      `SELECT r.rating, r.comment, r.created_at AS "createdAt", split_part(u.full_name, ' ', 1) AS reviewer
         FROM review r JOIN lease l USING (lease_id) JOIN app_user u ON u.user_id = r.tenant_id
        WHERE l.property_id = $1 ORDER BY r.created_at DESC LIMIT 20`,
      [id],
    ),
    one<{ avg: number | null; n: number }>(
      `SELECT round(avg(r.rating), 2) AS avg, count(*)::int AS n
         FROM review r JOIN lease l USING (lease_id) JOIN property p ON p.property_id = l.property_id
        WHERE p.owner_id = $1`,
      [cur.ownerId],
    ),
  ]);

  // contact details and the street address are only shown to logged-in users
  const loggedIn = Boolean(session);
  const listing = { ...cur, addressLine: loggedIn ? cur.addressLine : null, contactPhone: loggedIn ? cur.contactPhone : null };

  let myInquiries: unknown[] = [];
  if (session?.role === 'TENANT') {
    myInquiries = await query(
      `SELECT i.inquiry_id AS "inquiryId", i.seen_version_id AS "seenVersionId", e.escrow_id AS "escrowId", e.status AS "escrowStatus"
         FROM inquiry i LEFT JOIN escrow e ON e.inquiry_id = i.inquiry_id
        WHERE i.tenant_id = $1 AND i.property_id = $2 ORDER BY i.created_at DESC`,
      [session.uid, id],
    );
  }

  return {
    listing,
    photos: photos.map((p) => p.sha256),
    history,
    chainIntact: chain?.intact ?? true,
    reviews,
    ownerRating,
    myInquiries,
  };
});
