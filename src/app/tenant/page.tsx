'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, DataTable, Flash, Modal, StatusBadge } from '@/components/ui';
import { fmtDate, fmtDateTime, inr, post, useAction, useApi } from '@/lib/client';

interface Inquiry {
  inquiryId: number; propertyId: number; createdAt: string; title: string; seenRent: number; seenDeposit: number;
  currentRent: number; currentDeposit: number; escrowId: number | null; escrowStatus: string | null; amount: number | null;
  otpExpiresAt: string | null; tenantCheckinAt: string | null; ownerCheckinAt: string | null; expired: boolean;
}
interface Lease { leaseId: number; propertyId: number; startDate: string; endDate: string; monthlyRent: number; status: string; title: string; reviewed: boolean }
interface Dash {
  inquiries: Inquiry[];
  leases: Lease[];
  complaints: { complaintId: number; propertyId: number; category: string; status: string; createdAt: string }[];
}

export default function TenantPage() {
  const { data, error, reload } = useApi<Dash>('/api/tenant/dashboard');
  const act = useAction();
  const [evidence, setEvidence] = useState<number | null>(null);

  if (error) return <div className="alert bad">{error}</div>;
  if (!data) return <p className="muted">Loading…</p>;

  return (
    <div className="stack">
      <h1>My activity</h1>
      <Flash msg={act.msg} err={act.err} />

      <section className="card stack">
        <h2 style={{ margin: 0 }}>Enquiries and escrow</h2>
        {data.inquiries.length === 0 && <p className="muted">No enquiries yet. <Link href="/">Browse listings</Link>.</p>}
        {data.inquiries.map((i) => {
          const changed = i.seenRent !== i.currentRent || i.seenDeposit !== i.currentDeposit;
          return (
            <div key={i.inquiryId} className="card" style={{ background: 'var(--bg)' }}>
              <div className="row between">
                <div>
                  <Link href={`/listings/${i.propertyId}`} style={{ fontWeight: 600 }}>{i.title}</Link>
                  <div className="muted small">Enquiry #{i.inquiryId} · {fmtDateTime(i.createdAt)}</div>
                </div>
                <div className="row">
                  {i.escrowStatus ? <><StatusBadge status={i.escrowStatus} /><span className="small">{inr(i.amount)}</span></> : <Badge tone="gray">no token paid</Badge>}
                </div>
              </div>

              {changed && (
                <div className="alert warn" style={{ marginTop: 10 }}>
                  The listing changed after you enquired: rent {inr(i.seenRent)} → <strong>{inr(i.currentRent)}</strong>, deposit {inr(i.seenDeposit)} → {inr(i.currentDeposit)}.
                  If you pay a token or sign a lease, the terms you saw ({inr(i.seenRent)}) apply.
                </div>
              )}

              <div className="row" style={{ marginTop: 10 }}>
                <button className="ghost small" onClick={() => setEvidence(i.inquiryId)}>View evidence</button>
                {i.escrowStatus === 'HELD' && !i.tenantCheckinAt && (
                  <button className="small" disabled={act.busy} onClick={() => act.run(() => post(`/api/escrow/${i.escrowId}/checkin`), 'Check-in recorded. Now give the owner your visit code.', reload)}>
                    I am at the property
                  </button>
                )}
                {i.escrowStatus === 'HELD' && i.tenantCheckinAt && !i.ownerCheckinAt && <Badge>Waiting for owner to enter your code</Badge>}
                {i.escrowStatus === 'HELD' && i.expired && (
                  <button className="small" disabled={act.busy} onClick={() => act.run(() => post(`/api/escrow/${i.escrowId}/refund`), 'Token refunded.', reload)}>Claim refund (window expired)</button>
                )}
                {i.escrowStatus === 'HELD' && (
                  <button className="ghost small danger" disabled={act.busy} onClick={() => act.run(() => post(`/api/escrow/${i.escrowId}/dispute`), 'Escrow frozen. An administrator will decide.', reload)}>Dispute</button>
                )}
                {i.otpExpiresAt && i.escrowStatus === 'HELD' && <span className="muted small">visit window ends {fmtDateTime(i.otpExpiresAt)}</span>}
              </div>
            </div>
          );
        })}
      </section>

      <section className="card stack">
        <h2 style={{ margin: 0 }}>My leases</h2>
        {data.leases.length === 0 && <p className="muted">No leases yet. A lease is created by the owner after a verified visit.</p>}
        {data.leases.map((l) => <LeaseRow key={l.leaseId} l={l} reload={reload} />)}
      </section>

      <section className="card">
        <h2>My complaints</h2>
        {data.complaints.length === 0 ? <p className="muted">None.</p> : <DataTable rows={data.complaints} />}
      </section>

      {evidence && <Evidence id={evidence} onClose={() => setEvidence(null)} />}
    </div>
  );
}

function LeaseRow({ l, reload }: { l: Lease; reload: () => void }) {
  const a = useAction();
  const [rating, setRating] = useState('5');
  const [comment, setComment] = useState('');
  return (
    <div className="card" style={{ background: 'var(--bg)' }}>
      <div className="row between">
        <div>
          <Link href={`/listings/${l.propertyId}`} style={{ fontWeight: 600 }}>{l.title}</Link>
          <div className="muted small">{fmtDate(l.startDate)} → {fmtDate(l.endDate)} · {inr(l.monthlyRent)}/month</div>
        </div>
        <StatusBadge status={l.status} />
      </div>
      {!l.reviewed && (l.status === 'ACTIVE' || l.status === 'ENDED') && (
        <div className="form" style={{ marginTop: 10 }}>
          <div>
            <label htmlFor={`r${l.leaseId}`}>Rating</label>
            <select id={`r${l.leaseId}`} value={rating} onChange={(e) => setRating(e.target.value)}>
              {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="full">
            <label htmlFor={`c${l.leaseId}`}>Review (allowed after 30 days of the lease)</label>
            <input id={`c${l.leaseId}`} value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          <div>
            <button className="small" disabled={a.busy} onClick={() => a.run(() => post('/api/reviews', { leaseId: l.leaseId, rating: Number(rating), comment }), 'Review posted.', reload)}>Post review</button>
          </div>
          <div className="full"><Flash msg={a.msg} err={a.err} /></div>
        </div>
      )}
      {l.reviewed && <p className="muted small" style={{ margin: '8px 0 0' }}>You have reviewed this lease.</p>}
    </div>
  );
}

function Evidence({ id, onClose }: { id: number; onClose: () => void }) {
  const { data, error } = useApi<any>(`/api/disputes/${id}`);
  const rows = data
    ? [
        ['Rent', 'monthly_rent', (v: any) => (v == null ? '-' : inr(v))],
        ['Deposit', 'security_deposit', (v: any) => (v == null ? '-' : inr(v))],
        ['Contact phone', 'contact_phone', (v: any) => v ?? '-'],
        ['Address', 'address_line', (v: any) => v ?? '-'],
        ['Photo set', 'photo_digest', (v: any) => (v == null ? '-' : String(v).slice(0, 10) + '…')],
      ] as const
    : [];
  return (
    <Modal onClose={onClose}>
      <h2>Dispute evidence for enquiry #{id}</h2>
      {error && <div className="alert bad">{error}</div>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && (
        <div className="stack">
          <p className="muted small" style={{ margin: 0 }}>
            Compares the version you were shown with the latest version. &quot;As known then&quot; is a bitemporal query: what the database knew at the moment you enquired.
          </p>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Field</th><th>You saw (v{data.seen?.seq})</th><th>As known then ({data.asOf ? `v${data.asOf.seq}` : 'none'})</th><th>Now (v{data.current?.seq})</th></tr></thead>
              <tbody>
                {rows.map(([label, key, f]) => (
                  <tr key={key} className={data.changed.includes(key) ? 'changed' : ''}>
                    <td>{label}</td>
                    <td>{f(data.seen?.[key])}</td>
                    <td>{f(data.asOf?.[key])}</td>
                    <td>{f(data.current?.[key])}</td>
                  </tr>
                ))}
                <tr>
                  <td>Recorded at</td>
                  <td>{fmtDateTime(data.seen?.recorded_at)}</td>
                  <td>{fmtDateTime(data.asOf?.recorded_at)}</td>
                  <td>{fmtDateTime(data.current?.recorded_at)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className={`alert ${data.chainIntact ? 'good' : 'bad'}`}>
            {data.chainIntact ? 'Listing history hash chain is intact: this evidence has not been altered.' : 'Hash chain broken: the listing history was tampered with.'}
          </div>
        </div>
      )}
    </Modal>
  );
}
