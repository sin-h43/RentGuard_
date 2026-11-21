import { randomInt, randomUUID } from 'crypto';
import { one, tx } from '@/lib/db';
import { HttpError, jsonBody, route } from '@/lib/http';
import { escrowSchema } from '@/lib/validators';

// Tenant pays a refundable token amount into escrow. The 6-digit visit code is returned ONCE
// (only its bcrypt hash is stored); the tenant shows it to the owner at the property.
export const POST = route(['TENANT'], async ({ req, session }) => {
  const b = escrowSchema.parse(await jsonBody(req));
  const key = b.idempotencyKey ?? randomUUID();

  const mine = await one('SELECT 1 AS ok FROM inquiry WHERE inquiry_id = $1 AND tenant_id = $2', [b.inquiryId, session!.uid]);
  if (!mine) throw new HttpError(404, 'Inquiry not found.');

  const replay = await one<{ escrow_id: number }>('SELECT escrow_id FROM escrow WHERE idempotency_key = $1', [key]);
  if (replay) return { escrowId: replay.escrow_id, replayed: true }; // safe retry: no second charge, no second OTP

  const otp = String(randomInt(100000, 1000000));
  await tx((c) => c.query('CALL sp_hold_escrow($1::bigint, $2::numeric, $3::text, $4::uuid)', [b.inquiryId, b.amount, otp, key]));
  const row = await one<{ escrow_id: number; otp_expires_at: string }>(
    'SELECT escrow_id, otp_expires_at FROM escrow WHERE idempotency_key = $1',
    [key],
  );
  return { escrowId: row!.escrow_id, otp, otpExpiresAt: row!.otp_expires_at, replayed: false };
});
