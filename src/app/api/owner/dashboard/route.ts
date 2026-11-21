import { query } from '@/lib/db';
import { route } from '@/lib/http';

export const GET = route(['OWNER'], async ({ session }) => {
  const uid = session!.uid;
  const [properties, escrows, flags, profile] = await Promise.all([
    query(
      `SELECT p.property_id AS "propertyId", p.property_type AS "propertyType", p.is_active AS "isActive",
              lv.version_id AS "versionId", lv.seq, lv.title, lv.monthly_rent AS "monthlyRent",
              lv.security_deposit AS "securityDeposit", lv.address_line AS "addressLine", lv.locality, lv.city,
              lv.pincode, lv.contact_phone AS "contactPhone", lv.amenities, lv.effective_from AS "effectiveFrom",
              (SELECT array_agg(sha256 ORDER BY position) FROM listing_photo WHERE version_id = lv.version_id) AS photos,
              (SELECT count(*)::int FROM inquiry i WHERE i.property_id = p.property_id) AS inquiries,
              (SELECT COALESCE(bool_and(intact), true) FROM fn_verify_listing_chain(p.property_id)) AS "chainIntact"
         FROM property p
         LEFT JOIN LATERAL (SELECT * FROM listing_version v WHERE v.property_id = p.property_id ORDER BY seq DESC LIMIT 1) lv ON true
        WHERE p.owner_id = $1
        ORDER BY p.property_id`,
      [uid],
    ),
    query(
      `SELECT e.escrow_id AS "escrowId", e.status, e.amount, e.otp_expires_at AS "otpExpiresAt",
              e.tenant_checkin_at AS "tenantCheckinAt", e.owner_checkin_at AS "ownerCheckinAt",
              i.inquiry_id AS "inquiryId", i.property_id AS "propertyId", e.tenant_id AS "tenantId",
              t.full_name AS "tenantName", lv.title,
              EXISTS (SELECT 1 FROM lease l WHERE l.property_id = i.property_id AND l.tenant_id = e.tenant_id
                         AND l.status IN ('PENDING','ACTIVE')) AS "hasLease"
         FROM escrow e
         JOIN inquiry i USING (inquiry_id)
         JOIN app_user t ON t.user_id = e.tenant_id
         JOIN listing_version lv ON lv.version_id = i.seen_version_id
        WHERE e.owner_id = $1
        ORDER BY e.created_at DESC`,
      [uid],
    ),
    query(
      `SELECT flag_id AS "flagId", flag_type AS "flagType", severity, status, created_at AS "createdAt"
         FROM fraud_flag WHERE owner_id = $1 AND status <> 'DISMISSED' ORDER BY created_at DESC`,
      [uid],
    ),
    query(`SELECT trust_score AS "trustScore", (trust_updated_at IS NOT NULL) AS "trustScored", kyc_verified AS "kycVerified" FROM owner_profile WHERE owner_id = $1`, [uid]),
  ]);
  return { properties, escrows, flags, profile: profile[0] };
});
