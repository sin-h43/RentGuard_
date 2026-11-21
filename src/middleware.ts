import { NextRequest, NextResponse } from 'next/server';
import { readToken, SESSION_COOKIE } from '@/lib/session';

// Page-level role guard. API routes additionally enforce roles in route() (defence in depth).
const SECTION_ROLE: Record<string, 'TENANT' | 'OWNER' | 'ADMIN'> = {
  tenant: 'TENANT',
  owner: 'OWNER',
  admin: 'ADMIN',
};
const ROLE_HOME = { TENANT: '/tenant', OWNER: '/owner', ADMIN: '/admin' } as const;

export async function middleware(req: NextRequest) {
  const session = await readToken(req.cookies.get(SESSION_COOKIE)?.value);
  const path = req.nextUrl.pathname;

  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(path)}`;
    return NextResponse.redirect(url);
  }

  const required = SECTION_ROLE[path.split('/')[1]];
  if (required && session.role !== required) {
    const url = req.nextUrl.clone();
    url.pathname = ROLE_HOME[session.role];
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/tenant/:path*', '/owner/:path*', '/admin/:path*'] };
