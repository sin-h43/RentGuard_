'use client';
import type { ReactNode } from 'react';
import { fmtDateTime, humanize } from '@/lib/client';

export function Badge({ children, tone = '' }: { children: ReactNode; tone?: '' | 'warn' | 'bad' | 'good' | 'gray' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Flash({ msg, err }: { msg?: string | null; err?: string | null }) {
  if (err) return <div className="alert bad" role="alert">{err}</div>;
  if (msg) return <div className="alert good" role="status">{msg}</div>;
  return null;
}

export function Photo({ sha, alt = 'Listing photo' }: { sha?: string | null; alt?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={sha ? `/api/photos/${sha}` : '/api/photos/' + '0'.repeat(64)} alt={alt} loading="lazy" />;
}

export function TrustBadge({ score, scored = true, kyc, underReview }: { score: number; scored?: boolean; kyc?: boolean; underReview?: boolean }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      {scored ? <Badge tone={score >= 0.7 ? 'good' : score > 0 ? '' : 'gray'}>Trust {score.toFixed(2)}</Badge> : <Badge tone="gray">Trust: not scored yet</Badge>}
      {kyc && <Badge tone="good">KYC verified</Badge>}
      {underReview && <Badge tone="warn">Under review</Badge>}
    </span>
  );
}

export function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  const tone =
    { HELD: 'warn', RELEASED: 'good', REFUNDED: 'gray', DISPUTED: 'bad', OPEN: 'warn', CONFIRMED: 'bad', DISMISSED: 'gray', RESOLVED: 'good', REJECTED: 'gray', UNDER_REVIEW: 'warn', ACTIVE: 'good', ENDED: 'gray' }[status] ?? '';
  return <Badge tone={tone as any}>{humanize(status)}</Badge>;
}

const ISO = /^\d{4}-\d{2}-\d{2}T/;
function cell(v: unknown): ReactNode {
  if (v === null || v === undefined) return '-';
  if (typeof v === 'object') return <span className="mono">{JSON.stringify(v)}</span>;
  if (typeof v === 'string' && ISO.test(v)) return fmtDateTime(v);
  if (typeof v === 'string' && /^[A-Z]+(_[A-Z]+)+$/.test(v)) return humanize(v);
  return String(v);
}

/** Generic table for query results. */
export function DataTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <p className="muted small">No rows.</p>;
  const cols = Object.keys(rows[0]);
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>{cols.map((c) => <th key={c}>{humanize(c)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{cols.map((c) => <td key={c}>{cell(r[c])}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Modal({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <div className="overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {children}
        <div style={{ marginTop: 14 }}>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

/** Readable rendering of a fraud_flag.evidence JSON document. */
export function Evidence({ value }: { value: unknown }) {
  const show = (x: unknown): string => (Array.isArray(x) ? x.join(', ') : x !== null && typeof x === 'object' ? JSON.stringify(x) : String(x));
  const line = (o: Record<string, unknown>) => Object.entries(o).map(([k, x]) => `${humanize(k)}: ${show(x)}`).join(' · ');
  const v = (value ?? {}) as Record<string, unknown>;
  const lines = Array.isArray(v.signals) ? (v.signals as Record<string, unknown>[]).map(line) : [line(v)];
  return (
    <ul className="ev">
      {lines.map((l, i) => <li key={i}>{l}</li>)}
    </ul>
  );
}
