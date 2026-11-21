import bcrypt from 'bcryptjs';
import { clientIp, withSessionCookie } from '@/lib/cookies';
import { tx } from '@/lib/db';
import { HttpError, jsonBody, route } from '@/lib/http';
import { tooMany } from '@/lib/rateLimit';
import { signSession } from '@/lib/session';
import { registerSchema } from '@/lib/validators';

export const POST = route(null, async ({ req }) => {
  // generous enough for a shared campus / office address, still blocks scripted mass sign-up
  if (tooMany(`register:${clientIp(req)}`, 20, 3_600_000)) throw new HttpError(429, 'Too many sign-ups from this address. Try again later.');
  const b = registerSchema.parse(await jsonBody(req));
  const hash = await bcrypt.hash(b.password, 10); // salted bcrypt, never stored in plain text

  // one ACID transaction: the account row and its role profile are created together or not at all
  const uid = await tx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO app_user (email, password_hash, role, full_name, phone)
       VALUES ($1, $2, $3::user_role, $4, $5) RETURNING user_id`,
      [b.email, hash, b.role, b.fullName, b.phone],
    );
    const id = rows[0].user_id as number;
    await c.query(b.role === 'OWNER' ? 'INSERT INTO owner_profile (owner_id) VALUES ($1)' : 'INSERT INTO tenant_profile (tenant_id) VALUES ($1)', [id]);
    return id;
  });

  const token = await signSession({ uid, role: b.role, name: b.fullName });
  return withSessionCookie({ id: uid, role: b.role, name: b.fullName }, token);
});
