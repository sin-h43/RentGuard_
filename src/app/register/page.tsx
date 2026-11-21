'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Flash } from '@/components/ui';
import { post, useAction } from '@/lib/client';

export default function RegisterPage() {
  const router = useRouter();
  const { run, busy, err } = useAction();
  const [f, setF] = useState({ fullName: '', email: '', phone: '', password: '', role: 'TENANT' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <form
      className="card stack"
      style={{ maxWidth: 460, margin: '30px auto' }}
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(() => post<{ role: string }>('/api/auth/register', f));
        if (r) {
          router.push(r.role === 'OWNER' ? '/owner' : '/tenant');
          router.refresh();
        }
      }}
    >
      <h1>Create an account</h1>
      <Flash err={err} />
      <div>
        <label htmlFor="role">I am a</label>
        <select id="role" value={f.role} onChange={set('role')}>
          <option value="TENANT">Tenant (looking for a place)</option>
          <option value="OWNER">Owner (listing a place)</option>
        </select>
      </div>
      <div>
        <label htmlFor="name">Full name</label>
        <input id="name" required minLength={2} value={f.fullName} onChange={set('fullName')} />
      </div>
      <div>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" required value={f.email} onChange={set('email')} />
      </div>
      <div>
        <label htmlFor="phone">Phone (10-13 digits)</label>
        <input id="phone" inputMode="numeric" required pattern="\+?[0-9]{10,13}" value={f.phone} onChange={set('phone')} />
      </div>
      <div>
        <label htmlFor="pw">Password (8+ characters, a letter and a digit)</label>
        <input id="pw" type="password" autoComplete="new-password" required minLength={8} value={f.password} onChange={set('password')} />
      </div>
      <button disabled={busy}>{busy ? 'Creating…' : 'Sign up'}</button>
      <p className="muted small" style={{ margin: 0 }}>
        Already registered? <Link href="/login">Log in</Link>
      </p>
    </form>
  );
}
