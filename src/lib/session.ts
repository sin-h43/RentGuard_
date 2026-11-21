import { SignJWT, jwtVerify } from 'jose';
import { env } from './env';

export type Role = 'TENANT' | 'OWNER' | 'ADMIN';
export interface Session {
  uid: number;
  role: Role;
  name: string;
}

export const SESSION_COOKIE = 'rg_session';
export const SESSION_HOURS = 8;

const key = () => new TextEncoder().encode(env.sessionSecret);

export async function signSession(s: Session): Promise<string> {
  return new SignJWT({ role: s.role, name: s.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(s.uid))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(key());
}

export async function readToken(token?: string | null): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ['HS256'] });
    const role = payload.role as Role;
    if (!['TENANT', 'OWNER', 'ADMIN'].includes(role) || !payload.sub) return null;
    return { uid: Number(payload.sub), role, name: String(payload.name ?? '') };
  } catch {
    return null;
  }
}
