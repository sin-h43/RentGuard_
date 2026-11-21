'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Flash, Photo, StatusBadge, TrustBadge } from '@/components/ui';
import { api, fmtDateTime, humanize, inr, post, useAction, useApi } from '@/lib/client';

interface Prop {
  propertyId: number; propertyType: string; isActive: boolean; versionId: number | null; seq: number | null; title: string | null;
  monthlyRent: number | null; securityDeposit: number | null; addressLine: string | null; locality: string | null; city: string | null;
  pincode: string | null; contactPhone: string | null; amenities: string[] | null; photos: string[] | null; inquiries: number; chainIntact: boolean;
}
interface Esc {
  escrowId: number; status: string; amount: number; otpExpiresAt: string; tenantCheckinAt: string | null; ownerCheckinAt: string | null;
  inquiryId: number; propertyId: number; tenantName: string; title: string; hasLease: boolean;
}
interface Dash {
  properties: Prop[];
  escrows: Esc[];
  flags: { flagId: number; flagType: string; severity: number; status: string; createdAt: string }[];
  profile: { trustScore: number; trustScored: boolean; kycVerified: boolean };
}

export default function OwnerPage() {
  const { data, error, reload } = useApi<Dash>('/api/owner/dashboard');
  const add = useAction();
  const [type, setType] = useState('PG');
  const [open, setOpen] = useState<number | null>(null);

  if (error) return <div className="alert bad">{error}</div>;
  if (!data) return <p className="muted">Loading…</p>;

  return (
    <div className="stack">
      <div className="row between">
        <h1>My properties</h1>
        <TrustBadge score={data.profile.trustScore} scored={data.profile.trustScored} kyc={data.profile.kycVerified} />
      </div>

      {data.flags.length > 0 && (
        <div className="alert warn">
          <strong>Your account has {data.flags.length} fraud flag(s) under review:</strong>{' '}
          {data.flags.map((f) => `${humanize(f.flagType).toLowerCase()} (${f.status.toLowerCase()})`).join(', ')}. Listings with confirmed flags are taken offline.
        </div>
      )}

      <div className="card row">
        <div>
          <label htmlFor="ptype">New property</label>
          <select id="ptype" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="PG">PG</option><option value="APARTMENT">Apartment</option><option value="ROOM">Room</option><option value="STUDIO">Studio</option>
          </select>
        </div>
        <div style={{ alignSelf: 'end' }}>
          <button disabled={add.busy} onClick={() => add.run(() => post('/api/owner/properties', { propertyType: type }), 'Property created. Publish its first listing below.', reload)}>Add property</button>
        </div>
        <Flash msg={add.msg} err={add.err} />
      </div>

      {data.properties.map((p) => (
        <section key={p.propertyId} className="card stack">
          <div className="row between">
            <div>
              <h2 style={{ margin: 0 }}>{p.title ?? `Property #${p.propertyId} (no listing yet)`}</h2>
              <div className="muted small">
                #{p.propertyId} · {p.propertyType}{p.locality ? ` · ${p.locality}, ${p.city}` : ''}
              </div>
            </div>
            <div className="row">
              {!p.isActive && <Badge tone="bad">Taken offline</Badge>}
              {p.seq && (p.chainIntact ? <Badge tone="good">History intact · v{p.seq}</Badge> : <Badge tone="bad">History tampered</Badge>)}
              <Badge tone="gray">{p.inquiries} {p.inquiries === 1 ? 'enquiry' : 'enquiries'}</Badge>
              {p.monthlyRent && <strong>{inr(p.monthlyRent)}</strong>}
            </div>
          </div>
          <div className="row">
            {p.photos?.slice(0, 3).map((s) => <div key={s} style={{ width: 110 }}><Photo sha={s} /></div>)}
          </div>
          <div className="row">
            <button className="ghost small" onClick={() => setOpen(open === p.propertyId ? null : p.propertyId)}>{p.seq ? 'Publish new version' : 'Publish first listing'}</button>
            {p.seq && <Link href={`/listings/${p.propertyId}`} className="small">View public page</Link>}
          </div>
          {open === p.propertyId && <ListingForm p={p} onDone={() => { setOpen(null); reload(); }} />}
        </section>
      ))}

      <section className="card stack">
        <h2 style={{ margin: 0 }}>Visits, escrow and leases</h2>
        {data.escrows.length === 0 && <p className="muted">No tenant has paid a token yet.</p>}
        {data.escrows.map((e) => <EscrowRow key={e.escrowId} e={e} reload={reload} />)}
      </section>
    </div>
  );
}

function ListingForm({ p, onDone }: { p: Prop; onDone: () => void }) {
  const a = useAction();
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({
    title: p.title ?? '', monthlyRent: String(p.monthlyRent ?? ''), securityDeposit: String(p.securityDeposit ?? ''),
    addressLine: p.addressLine ?? '', locality: p.locality ?? '', city: p.city ?? 'Bengaluru', pincode: p.pincode ?? '',
    contactPhone: p.contactPhone ?? '', amenities: (p.amenities ?? []).join(', '), effectiveFrom: today,
  });
  const [keep, setKeep] = useState<string[]>(p.photos ?? []);
  const [files, setFiles] = useState<FileList | null>(null);
  const [flagged, setFlagged] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const raise = p.monthlyRent && Number(f.monthlyRent) > p.monthlyRent * 1.15;

  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setFlagged(null);
        const fd = new FormData();
        fd.set('propertyId', String(p.propertyId));
        for (const [k, v] of Object.entries(f)) fd.set(k, v);
        fd.set('keepPhotos', JSON.stringify(keep));
        if (files) for (const file of Array.from(files)) fd.append('photos', file);
        const r = await a.run(() => api<{ versionId: number; flagsRaised: { flag_type: string }[] }>('/api/owner/listings', { method: 'POST', body: fd }), 'New version published.');
        if (r) {
          if (r.flagsRaised.length) setFlagged(r.flagsRaised.map((x) => x.flag_type).join(', '));
          else onDone();
        }
      }}
    >
      <div className="full"><label htmlFor={`t${p.propertyId}`}>Title</label><input id={`t${p.propertyId}`} required value={f.title} onChange={set('title')} /></div>
      <div><label>Monthly rent (₹)</label><input type="number" min={1} required value={f.monthlyRent} onChange={set('monthlyRent')} /></div>
      <div><label>Security deposit (₹)</label><input type="number" min={0} required value={f.securityDeposit} onChange={set('securityDeposit')} /></div>
      <div className="full"><label>Street address</label><input required value={f.addressLine} onChange={set('addressLine')} /></div>
      <div><label>Locality</label><input required value={f.locality} onChange={set('locality')} /></div>
      <div><label>City</label><input required value={f.city} onChange={set('city')} /></div>
      <div><label>Pincode</label><input required pattern="[0-9]{6}" value={f.pincode} onChange={set('pincode')} /></div>
      <div><label>Contact phone</label><input required pattern="\+?[0-9]{10,13}" value={f.contactPhone} onChange={set('contactPhone')} /></div>
      <div><label>Amenities (comma separated)</label><input value={f.amenities} onChange={set('amenities')} /></div>
      <div><label>Effective from</label><input type="date" required value={f.effectiveFrom} onChange={set('effectiveFrom')} /></div>

      {(p.photos?.length ?? 0) > 0 && (
        <div className="full">
          <label>Keep existing photos</label>
          <div className="row">
            {p.photos!.map((s) => (
              <label key={s} style={{ width: 110, color: 'var(--ink)' }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={keep.includes(s)} onChange={(e) => setKeep(e.target.checked ? [...keep, s] : keep.filter((x) => x !== s))} />
                <Photo sha={s} />
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="full">
        <label htmlFor={`f${p.propertyId}`}>Add photos (JPEG / PNG / WebP, up to 3 MB each, max 6 in total)</label>
        <input id={`f${p.propertyId}`} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => setFiles(e.target.files)} />
      </div>

      {raise && <div className="full alert warn">A rent increase above 15% (or a deposit increase above 50%) within 14 days of a tenant enquiry is flagged automatically as a possible bait-and-switch.</div>}
      <div className="full"><Flash msg={flagged ? null : a.msg} err={a.err} /></div>
      {flagged && <div className="full alert bad">Published, but the database flagged this change for review: {flagged}.</div>}
      <div className="full"><button disabled={a.busy}>{a.busy ? 'Publishing…' : 'Publish version'}</button></div>
    </form>
  );
}

function EscrowRow({ e, reload }: { e: Esc; reload: () => void }) {
  const a = useAction();
  const [otp, setOtp] = useState('');
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10));
  const [end, setEnd] = useState(new Date(Date.now() + 330 * 86_400_000).toISOString().slice(0, 10));
  return (
    <div className="card" style={{ background: 'var(--bg)' }}>
      <div className="row between">
        <div>
          <strong>{e.tenantName}</strong> · {e.title}
          <div className="muted small">Token {inr(e.amount)} · window ends {fmtDateTime(e.otpExpiresAt)}</div>
        </div>
        <StatusBadge status={e.status} />
      </div>
      {e.status === 'HELD' && (
        <div className="row" style={{ marginTop: 10 }}>
          <div style={{ width: 170 }}>
            <label htmlFor={`otp${e.escrowId}`}>Tenant&apos;s visit code</label>
            <input id={`otp${e.escrowId}`} inputMode="numeric" maxLength={6} placeholder="6 digits" value={otp} onChange={(x) => setOtp(x.target.value)} />
          </div>
          <button className="small" style={{ alignSelf: 'end' }} disabled={a.busy} onClick={() => a.run(() => post(`/api/escrow/${e.escrowId}/checkin`, { otp }), 'Visit confirmed.', reload)}>Confirm visit</button>
          <button className="ghost small" style={{ alignSelf: 'end' }} disabled={a.busy} onClick={() => a.run(() => post(`/api/escrow/${e.escrowId}/refund`), 'Token refunded to tenant.', reload)}>Cancel and refund</button>
          <span className="muted small" style={{ alignSelf: 'end' }}>
            {e.tenantCheckinAt ? 'Tenant has checked in.' : 'Tenant has not checked in yet.'}
          </span>
        </div>
      )}
      {e.status === 'RELEASED' && !e.hasLease && (
        <div className="row" style={{ marginTop: 10 }}>
          <div><label>Lease start</label><input type="date" value={start} onChange={(x) => setStart(x.target.value)} /></div>
          <div><label>Lease end</label><input type="date" value={end} onChange={(x) => setEnd(x.target.value)} /></div>
          <button className="small" style={{ alignSelf: 'end' }} disabled={a.busy} onClick={() => a.run(() => post('/api/leases', { inquiryId: e.inquiryId, startDate: start, endDate: end }), 'Lease created at the rent the tenant saw.', reload)}>Create lease</button>
        </div>
      )}
      {e.status === 'RELEASED' && e.hasLease && <p className="muted small" style={{ margin: '8px 0 0' }}>Lease created.</p>}
      <Flash msg={a.msg} err={a.err} />
    </div>
  );
}
