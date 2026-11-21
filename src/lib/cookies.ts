import { NextResponse } from 'next/server';
import { env } from './env';
import { SESSION_COOKIE, SESSION_HOURS } from './session';

export function withSessionCookie(body: unknown, token: string): NextResponse {
  const res = NextResponse.json(body);
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, // not readable from JavaScript (XSS-safe)
    sameSite: 'lax', // basic CSRF protection
    secure: env.isProd,
    path: '/',
    maxAge: SESSION_HOURS * 3600,
  });
  return res;
}

export function clearSessionCookie(): NextResponse {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
}

export function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? 'local').split(',')[0].trim();
}
