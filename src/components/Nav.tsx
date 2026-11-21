'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, post } from '@/lib/client';

type Me = { id: number; role: 'TENANT' | 'OWNER' | 'ADMIN'; name: string } | null;
const HOME = { TENANT: '/tenant', OWNER: '/owner', ADMIN: '/admin' } as const;
const LABEL = { TENANT: 'My activity', OWNER: 'My properties', ADMIN: 'Admin console' } as const;

export default function Nav() {
  const [me, setMe] = useState<Me>(null);
  const [ready, setReady] = useState(false);
  const path = usePathname();
  const router = useRouter();

  useEffect(() => {
    api<{ user: Me }>('/api/auth/me')
      .then((r) => setMe(r.user))
      .catch(() => setMe(null))
      .finally(() => setReady(true));
  }, [path]);

  async function logout() {
    await post('/api/auth/logout');
    setMe(null);
    router.push('/');
    router.refresh();
  }

  const cls = (p: string) => `link${path === p ? ' active' : ''}`;
  return (
    <nav className="nav" aria-label="Main">
      <div className="wrap">
        <Link href="/" className="brand">Rent<span>Guard</span></Link>
        <Link href="/" className={cls('/')}>Browse listings</Link>
        {me && <Link href={HOME[me.role]} className={cls(HOME[me.role])}>{LABEL[me.role]}</Link>}
        <span className="spacer" />
        {ready && me && (
          <>
            <span className="muted small">{me.name} · {me.role.toLowerCase()}</span>
            <button className="ghost small" onClick={logout}>Log out</button>
          </>
        )}
        {ready && !me && (
          <>
            <Link href="/login" className={cls('/login')}>Log in</Link>
            <Link href="/register" className="btn small">Sign up</Link>
          </>
        )}
      </div>
    </nav>
  );
}
