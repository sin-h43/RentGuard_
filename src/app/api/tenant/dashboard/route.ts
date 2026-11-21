import { query } from '@/lib/db';
import { route } from '@/lib/http';

export const GET = route(['TENANT'], async ({ session }) => {
  const uid = session!.uid;
  const [inquiries, leases, complaints] = await Promise.all([
    query(
      `SELECT i.inquiry_id AS "inquiryId", i.property_id AS "propertyId", i.created_at AS "createdAt", i.message,
              lvs.title, lvs.monthly_rent AS "seenRent", lvs.security_deposit AS "seenDeposit",
              cur.monthly_rent AS "currentRent", cur.security_deposit AS "currentDeposit",
              e.escrow_id AS "escrowId", e.status AS "escrowStatus", e.amount,
              e.otp_expires_at AS "otpExpiresAt", e.tenant_checkin_at AS "tenantCheckinAt", e.owner_checkin_at AS "ownerCheckinAt",
              (e.otp_expires_at IS NOT NULL AND e.otp_expires_at < now()) AS "expired"
         FROM inquiry i
         JOIN listing_version lvs ON lvs.version_id = i.seen_version_id
         LEFT JOIN LATERAL (SELECT monthly_rent, security_deposit FROM listing_version v
                             WHERE v.property_id = i.property_id ORDER BY seq DESC LIMIT 1) cur ON true
         LEFT JOIN escrow e ON e.inquiry_id = i.inquiry_id
        WHERE i.tenant_id = $1
        ORDER BY i.created_at DESC`,
      [uid],
    ),
    query(
      `SELECT l.lease_id AS "leaseId", l.property_id AS "propertyId", l.start_date AS "startDate", l.end_date AS "endDate",
              l.monthly_rent AS "monthlyRent", l.status, lv.title, (r.review_id IS NOT NULL) AS reviewed
         FROM lease l
         JOIN listing_version lv ON lv.version_id = l.agreed_version_id
         LEFT JOIN review r ON r.lease_id = l.lease_id
        WHERE l.tenant_id = $1 ORDER BY l.start_date DESC`,
      [uid],
    ),
    query(
      `SELECT c.complaint_id AS "complaintId", c.property_id AS "propertyId", c.category, c.status, c.created_at AS "createdAt"
         FROM complaint c WHERE c.filed_by = $1 ORDER BY c.created_at DESC`,
      [uid],
    ),
  ]);
  return { inquiries, leases, complaints };
});
