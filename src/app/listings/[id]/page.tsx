'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Badge, Flash, Photo, StatusBadge, TrustBadge } from '@/components/ui';
import { fmtDate, fmtDateTime, inr, post, useAction, useApi } from '@/lib/client';

interface Detail {
  listing: {
    propertyId: number; versionId: number; title: string; propertyType: string; monthlyRent: number; securityDeposit: number;
    locality: string; city: string; pincode: string; amenities: string[]; effectiveFrom: string; recordedAt: string;
    addressLine: string | null; contactPhone: string | null; ownerId: number; ownerName: string; trustScore: number; trustScored: boolean;
    kycVerified: boolean; underReview: boolean;
  };
  photos: string[];
  history: { seq: number; monthlyRent: number; securityDeposit: number; effectiveFrom: string; recordedAt: string }[];
  chainIntact: boolean;
  reviews: { rating: number; comment: string | null; createdAt: string; reviewer: string }[];
  ownerRating: { avg: number | null; n: number };
  myInquiries: { inquiryId: number; seenVersionId: number; escrowId: number | null; escrowStatus: string | null }[];
}

export default function ListingPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, reload } = useApi<Detail>(`/api/listings/${id}`);
  const me = useApi<{ user: { role: string } | null }>('/api/auth/me');
  const role = me.data?.user?.role;

  if (error) return <div className="alert bad">{error}</div>;
  if (!data) return <p className="muted">Loading…</p>;
  const { listing: l } = data;

  return (
    <div className="stack">
      <div className="row between">
        <div>
          <h1>{l.title}</h1>
          <div className="muted">{l.locality}, {l.city} {l.pincode} · <Badge tone="gray">{l.propertyType}</Badge></div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="price">{inr(l.monthlyRent)}<span className="muted small"> /month</span></div>
          <div className="muted small">Deposit {inr(l.securityDeposit)}</div>
        </div>
      </div>

      {l.underReview && (
        <div className="alert warn">This owner or listing has open fraud flags and is under review by an administrator. Do not pay outside the platform.</div>
      )}

      <div className="grid two">
        <div className="stack">
          <div className="photos">
            {data.photos.map((p) => <Photo key={p} sha={p} alt={`${l.title} photo`} />)}
          </div>

          <div className="card">
            <h2>Details</h2>
            <p className="small" style={{ margin: '0 0 6px' }}>
              {l.addressLine ? <>Address: {l.addressLine}</> : <>Street address and contact number are shown after you <Link href="/login">log in</Link>.</>}
            </p>
            {l.contactPhone && <p className="small" style={{ margin: '0 0 6px' }}>Contact: <span className="mono">{l.contactPhone}</span></p>}
            <div className="row">{l.amenities.map((a) => <Badge key={a}>{a}</Badge>)}</div>
          </div>

          <div className="card">
            <div className="row between">
              <h2 style={{ margin: 0 }}>Price history</h2>
              {data.chainIntact ? <Badge tone="good">Hash chain verified ✓</Badge> : <Badge tone="bad">Tamper detected ⚠</Badge>}
            </div>
            <p className="muted small">
              Every edit is stored as a new, immutable version. Each row carries a SHA-256 hash of the previous row, so altering history is detectable.
            </p>
            <div className="tablewrap">
              <table>
                <thead><tr><th>Version</th><th>Rent</th><th>Deposit</th><th>Effective</th><th>Recorded</th></tr></thead>
                <tbody>
                  {data.history.map((h, i) => {
                    const prev = data.history[i - 1];
                    const delta = prev && prev.monthlyRent !== h.monthlyRent ? ((h.monthlyRent - prev.monthlyRent) / prev.monthlyRent) * 100 : null;
                    return (
                      <tr key={h.seq}>
                        <td>v{h.seq}</td>
                        <td>{inr(h.monthlyRent)} {delta !== null && <Badge tone={delta > 0 ? 'warn' : 'good'}>{delta > 0 ? '+' : ''}{delta.toFixed(1)}%</Badge>}</td>
                        <td>{inr(h.securityDeposit)}</td>
                        <td>{fmtDate(h.effectiveFrom)}</td>
                        <td>{fmtDateTime(h.recordedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h2>Reviews from verified leases</h2>
            {data.reviews.length === 0 && <p className="muted small">No reviews for this property yet.</p>}
            {data.reviews.map((r, i) => (
              <p key={i} style={{ margin: '0 0 8px' }}>
                <strong>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</strong> {r.comment} <span className="muted small">- {r.reviewer}, {fmtDate(r.createdAt)}</span>
              </p>
            ))}
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <h2>Owner</h2>
            <div style={{ fontWeight: 600 }}>{l.ownerName}</div>
            <div style={{ margin: '6px 0' }}><TrustBadge score={l.trustScore} scored={l.trustScored} kyc={l.kycVerified} /></div>
            <div className="muted small">
              {data.ownerRating.n > 0 ? `Average rating ${data.ownerRating.avg} from ${data.ownerRating.n} review(s)` : 'No reviews yet'}
            </div>
            <p className="muted small" style={{ marginBottom: 0 }}>
              Trust is computed in a graph of verified stays, seeded only from ID-verified tenants, so fake accounts cannot raise it.
            </p>
          </div>

          {!me.data?.user && (
            <div className="card">
              <h2>Interested?</h2>
              <p className="small"><Link href={`/login?next=/listings/${l.propertyId}`}>Log in</Link> or <Link href="/register">sign up</Link> as a tenant to enquire.</p>
            </div>
          )}
          {role === 'TENANT' && <TenantPanel d={data} reload={reload} />}
        </div>
      </div>
    </div>
  );
}

function TenantPanel({ d, reload }: { d: Detail; reload: () => void }) {
  const l = d.listing;
  const inq = useAction();
  const pay = useAction();
  const cmp = useAction();
  const [message, setMessage] = useState('');
  const [amount, setAmount] = useState('1000');
  const [otp, setOtp] = useState<string | null>(null);
  const [cat, setCat] = useState('FAKE_LISTING');
  const [desc, setDesc] = useState('');

  const hasForCurrent = d.myInquiries.some((i) => i.seenVersionId === l.versionId);

  return (
    <>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Enquire</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Your enquiry records the exact version you are looking at (v{d.history[d.history.length - 1]?.seq}). If the price changes afterwards, that is evidence.
        </p>
        <Flash msg={inq.msg} err={inq.err} />
        {!hasForCurrent && (
          <>
            <div>
              <label htmlFor="msg">Message (optional)</label>
              <input id="msg" value={message} maxLength={500} onChange={(e) => setMessage(e.target.value)} />
            </div>
            <button
              disabled={inq.busy}
              onClick={() => inq.run(() => post('/api/inquiries', { propertyId: l.propertyId, seenVersionId: l.versionId, message }), 'Enquiry sent.', reload)}
            >
              I am interested
            </button>
          </>
        )}
        {otp && (
          <div className="alert warn">
            <strong>Your visit code (shown only once - write it down now):</strong>
            <div className="otp">{otp}</div>
            Give it to the owner when you meet at the property. If you leave this page, it cannot be shown again.
          </div>
        )}
        {d.myInquiries.map((i) => (
          <div key={i.inquiryId} className="row between small">
            <span>Enquiry #{i.inquiryId}</span>
            <span>{i.escrowStatus ? <StatusBadge status={i.escrowStatus} /> : <Badge tone="gray">no token paid</Badge>}</span>
          </div>
        ))}
        {d.myInquiries.some((i) => !i.escrowId) && (
          <div className="stack">
            <h3>Pay a refundable token (escrow)</h3>
            <p className="muted small" style={{ margin: 0 }}>
              Held by the platform. Released to the owner only after you both check in at the property. You get a one-time visit code.
            </p>
            <Flash msg={pay.msg} err={pay.err} />
            <div>
              <label htmlFor="amt">Amount (min ₹100, max one month&apos;s rent)</label>
              <input id="amt" type="number" min={100} max={l.monthlyRent} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <button
              disabled={pay.busy}
              onClick={async () => {
                const target = d.myInquiries.find((i) => !i.escrowId)!;
                const r = await pay.run(() => post<{ otp?: string }>('/api/escrow', { inquiryId: target.inquiryId, amount: Number(amount) }), 'Token held in escrow.', reload);
                if (r?.otp) setOtp(r.otp);
              }}
            >
              Pay token into escrow
            </button>
          </div>
        )}
      </div>

      <div className="card stack">
        <h2 style={{ margin: 0 }}>Report a problem</h2>
        <Flash msg={cmp.msg} err={cmp.err} />
        <div>
          <label htmlFor="cat">Category</label>
          <select id="cat" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="FAKE_LISTING">Fake listing</option>
            <option value="PRICE_CHANGE">Price changed after I enquired</option>
            <option value="DEPOSIT_DISPUTE">Deposit dispute</option>
            <option value="HARASSMENT">Harassment</option>
            <option value="OTHER">Other</option>
          </select>
        </div>
        <div>
          <label htmlFor="desc">What happened? (10+ characters)</label>
          <textarea id="desc" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>
        <button
          className="ghost"
          disabled={cmp.busy}
          onClick={() => cmp.run(() => post('/api/complaints', { propertyId: l.propertyId, category: cat, description: desc }), 'Complaint filed. An administrator will review it.', () => setDesc(''))}
        >
          File complaint
        </button>
      </div>
    </>
  );
}
