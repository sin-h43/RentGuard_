import bcrypt from 'bcryptjs';
import { clientIp, withSessionCookie } from '@/lib/cookies';
import { one } from '@/lib/db';
import { HttpError, jsonBody, route } from '@/lib/http';
import { resetLimit, tooMany } from '@/lib/rateLimit';
import { signSession } from '@/lib/session';
import { loginSchema } from '@/lib/validators';

// compared against when the e-mail is unknown, so response time does not reveal which e-mails exist
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export const POST = route(null, async ({ req }) => {
  const { email, password } = loginSchema.parse(await jsonBody(req));
  const limitKey = `login:${clientIp(req)}:${email}`;
  if (tooMany(limitKey)) throw new HttpError(429, 'Too many attempts. Please wait a minute and try again.');

  const u = await one<{ user_id: number; password_hash: string; role: 'TENANT' | 'OWNER' | 'ADMIN'; full_name: string; is_active: boolean }>(
    'SELECT user_id, password_hash, role, full_name, is_active FROM app_user WHERE email = $1',
    [email],
  );
  const match = await bcrypt.compare(password, u?.password_hash ?? DUMMY_HASH);
  if (!u || !match || !u.is_active) throw new HttpError(401, 'Invalid email or password.');

  resetLimit(limitKey);
  const token = await signSession({ uid: u.user_id, role: u.role, name: u.full_name });
  return withSessionCookie({ id: u.user_id, role: u.role, name: u.full_name }, token);
});
