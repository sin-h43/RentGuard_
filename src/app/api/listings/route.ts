import { query } from '@/lib/db';
import { route } from '@/lib/http';

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m);
const num = (v: string | null) => (v && !Number.isNaN(Number(v)) ? Number(v) : null);

// Public search: full-text search (GIN index) + filters over the v_current_listing view.
export const GET = route(null, async ({ req }) => {
  const sp = req.nextUrl.searchParams;
  const q = sp.get('q')?.trim().slice(0, 100) || null;
  const city = sp.get('city')?.trim() || null;
  const locality = sp.get('locality')?.trim() || null;
  const type = sp.get('type') || null;
  const amenity = sp.get('amenity')?.trim().toLowerCase() || null;
  const sort = sp.get('sort') || (q ? 'relevance' : 'newest');
  const order =
    {
      relevance: 'rank DESC, c.recorded_at DESC',
      rent_asc: 'c.monthly_rent ASC',
      rent_desc: 'c.monthly_rent DESC',
      trust: 'o.trust_score DESC, c.monthly_rent ASC',
      newest: 'c.recorded_at DESC',
    }[sort] ?? 'c.recorded_at DESC';

  const rows = await query(
    `SELECT c.property_id AS "propertyId", c.version_id AS "versionId", c.title,
            c.property_type AS "propertyType", c.monthly_rent AS "monthlyRent",
            c.security_deposit AS "securityDeposit", c.locality, c.city, c.amenities,
            c.owner_id AS "ownerId", u.full_name AS "ownerName",
            o.trust_score AS "trustScore", (o.trust_updated_at IS NOT NULL) AS "trustScored", o.kyc_verified AS "kycVerified",
            EXISTS (SELECT 1 FROM fraud_flag f
                     WHERE f.status = 'OPEN' AND f.severity >= 3
                       AND (f.owner_id = c.owner_id OR f.property_id = c.property_id)) AS "underReview",
            (SELECT sha256 FROM listing_photo WHERE version_id = c.version_id ORDER BY position LIMIT 1) AS "coverPhoto",
            CASE WHEN $1::text IS NULL THEN 0
                 ELSE ts_rank(to_tsvector('english', lv.title || ' ' || lv.locality || ' ' || lv.address_line),
                              websearch_to_tsquery('english', $1)) END AS rank
       FROM v_current_listing c
       JOIN listing_version lv ON lv.version_id = c.version_id
       JOIN owner_profile o   ON o.owner_id = c.owner_id
       JOIN app_user u        ON u.user_id = c.owner_id
      WHERE ($1::text IS NULL OR to_tsvector('english', lv.title || ' ' || lv.locality || ' ' || lv.address_line)
                                  @@ websearch_to_tsquery('english', $1))
        AND ($2::text IS NULL OR lower(c.city) = lower($2))
        AND ($3::text IS NULL OR c.locality ILIKE '%' || $3 || '%')
        AND ($4::text IS NULL OR c.property_type = $4)
        AND ($5::numeric IS NULL OR c.monthly_rent >= $5)
        AND ($6::numeric IS NULL OR c.monthly_rent <= $6)
        AND ($7::text IS NULL OR c.amenities ? $7)
      ORDER BY ${order}
      LIMIT 60`,
    [q, city, locality ? escapeLike(locality) : null, type, num(sp.get('minRent')), num(sp.get('maxRent')), amenity],
  );
  return { listings: rows };
});
