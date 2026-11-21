'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Photo, TrustBadge } from '@/components/ui';
import { inr, useApi } from '@/lib/client';

interface L {
  propertyId: number;
  title: string;
  propertyType: string;
  monthlyRent: number;
  securityDeposit: number;
  locality: string;
  city: string;
  amenities: string[];
  ownerName: string;
  trustScore: number;
  trustScored: boolean;
  kycVerified: boolean;
  underReview: boolean;
  coverPhoto: string | null;
}

export default function Home() {
  const [f, setF] = useState({ q: '', locality: '', type: '', minRent: '', maxRent: '', amenity: '', sort: '' });
  const [applied, setApplied] = useState(f);
  const qs = new URLSearchParams(Object.entries(applied).filter(([, v]) => v)).toString();
  const { data, error, loading } = useApi<{ listings: L[] }>(`/api/listings${qs ? '?' + qs : ''}`);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="stack">
      <div>
        <h1>Find a PG or apartment you can trust</h1>
        <p className="muted" style={{ margin: 0 }}>
          Every listing keeps a tamper-evident price history, token money sits in escrow until you visit, and owners are scored by a fraud graph.
        </p>
      </div>

      <form
        className="card form"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(f);
        }}
        aria-label="Search listings"
      >
        <div className="full">
          <label htmlFor="q">Search (full-text: title, locality, address)</label>
          <input id="q" placeholder="e.g. wifi pg indiranagar" value={f.q} onChange={set('q')} />
        </div>
        <div>
          <label htmlFor="loc">Locality</label>
          <input id="loc" value={f.locality} onChange={set('locality')} />
        </div>
        <div>
          <label htmlFor="type">Type</label>
          <select id="type" value={f.type} onChange={set('type')}>
            <option value="">Any</option>
            <option value="PG">PG</option>
            <option value="APARTMENT">Apartment</option>
            <option value="ROOM">Room</option>
            <option value="STUDIO">Studio</option>
          </select>
        </div>
        <div>
          <label htmlFor="min">Min rent</label>
          <input id="min" type="number" min={0} value={f.minRent} onChange={set('minRent')} />
        </div>
        <div>
          <label htmlFor="max">Max rent</label>
          <input id="max" type="number" min={0} value={f.maxRent} onChange={set('maxRent')} />
        </div>
        <div>
          <label htmlFor="am">Amenity</label>
          <input id="am" placeholder="wifi" value={f.amenity} onChange={set('amenity')} />
        </div>
        <div>
          <label htmlFor="sort">Sort</label>
          <select id="sort" value={f.sort} onChange={set('sort')}>
            <option value="">Best match / newest</option>
            <option value="rent_asc">Rent: low to high</option>
            <option value="rent_desc">Rent: high to low</option>
            <option value="trust">Owner trust</option>
          </select>
        </div>
        <div>
          <button type="submit">Search</button>
        </div>
      </form>

      {error && <div className="alert bad">{error}</div>}
      {loading && <p className="muted">Loading…</p>}
      {data && (
        <>
          <p className="muted small" style={{ margin: 0 }}>{data.listings.length} listing(s)</p>
          <div className="grid cards">
            {data.listings.map((l) => (
              <Link key={l.propertyId} href={`/listings/${l.propertyId}`} className="card flush listing">
                <Photo sha={l.coverPhoto} alt={l.title} />
                <div className="body">
                  <div className="row between">
                    <span className="price">{inr(l.monthlyRent)}<span className="muted small"> /mo</span></span>
                    <Badge tone="gray">{l.propertyType}</Badge>
                  </div>
                  <div style={{ fontWeight: 600 }}>{l.title}</div>
                  <div className="muted small">{l.locality}, {l.city} · deposit {inr(l.securityDeposit)}</div>
                  <div style={{ marginTop: 8 }}>
                    <TrustBadge score={l.trustScore} scored={l.trustScored} kyc={l.kycVerified} underReview={l.underReview} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
          {data.listings.length === 0 && <div className="card">No listings match these filters.</div>}
        </>
      )}
    </div>
  );
}
