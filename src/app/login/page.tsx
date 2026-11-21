'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Flash } from '@/components/ui';
import { post, useAction } from '@/lib/client';

const HOME = { TENANT: '/tenant', OWNER: '/owner', ADMIN: '/admin' } as const;

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get('next');
  const { run, busy, err } = useAction();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <form
      className="card stack"
      style={{ maxWidth: 420, margin: '30px auto' }}
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(() => post<{ role: keyof typeof HOME }>('/api/auth/login', { email, password }));
        if (r) {
          router.push(next && next.startsWith('/') && !next.startsWith('//') ? next : HOME[r.role]);
          router.refresh();
        }
      }}
    >
      <h1>Log in</h1>
      <Flash err={err} />
      <div>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label htmlFor="pw">Password</label>
        <input id="pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <button disabled={busy}>{busy ? 'Signing in…' : 'Log in'}</button>
      <p className="muted small" style={{ margin: 0 }}>
        New here? <Link href="/register">Create an account</Link>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
