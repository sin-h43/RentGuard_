'use client';
import { useState } from 'react';
import ClusterGraph, { ClusterView } from '@/components/ClusterGraph';
import { Badge, DataTable, Evidence, Flash, StatusBadge } from '@/components/ui';
import { fmtDateTime, humanize, patch, post, useAction, useApi } from '@/lib/client';

const TABS = ['Fraud flags', 'Owner risk', 'Fraud graph (Neo4j)', 'Complaints', 'Users', 'SQL insights'] as const;
type Tab = (typeof TABS)[number];

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('Fraud flags');
  return (
    <div>
      <h1>Admin console</h1>
      <p className="muted" style={{ marginTop: 0 }}>Flags from database triggers (SQL) and from graph traversals (Neo4j) land in one review queue.</p>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {tab === 'Fraud flags' && <Flags />}
      {tab === 'Owner risk' && <Risk />}
      {tab === 'Fraud graph (Neo4j)' && <Graph />}
      {tab === 'Complaints' && <Complaints />}
      {tab === 'Users' && <Users />}
      {tab === 'SQL insights' && <Insights />}
    </div>
  );
}

function Flags() {
  const { data, error, reload } = useApi<{ flags: any[] }>('/api/admin/flags');
  const a = useAction();
  if (error) return <div className="alert bad">{error}</div>;
  if (!data) return <p className="muted">Loading…</p>;
  return (
    <div className="stack">
      <Flash msg={a.msg} err={a.err} />
      <div className="card tablewrap">
        <table>
          <thead><tr><th>Flag</th><th>Owner</th><th>Severity</th><th>Source</th><th>Status</th><th>Evidence</th><th>Raised</th><th /></tr></thead>
          <tbody>
            {data.flags.map((f) => (
              <tr key={f.flagId}>
                <td><strong>{humanize(f.flagType)}</strong>{f.propertyId && <div className="muted small">property #{f.propertyId}</div>}</td>
                <td>{f.ownerName ?? '-'}</td>
                <td><Badge tone={f.severity >= 4 ? 'bad' : 'warn'}>{f.severity}/5</Badge></td>
                <td><Badge tone={f.source === 'GRAPH' ? '' : 'gray'}>{f.source === 'GRAPH' ? 'Neo4j graph' : 'SQL trigger'}</Badge></td>
                <td><StatusBadge status={f.status} /></td>
                <td className="evidence"><Evidence value={f.evidence} /></td>
                <td>{fmtDateTime(f.createdAt)}</td>
                <td>
                  {f.status === 'OPEN' && (
                    <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                      <button className="small danger" disabled={a.busy} onClick={() => a.run(() => patch(`/api/admin/flags/${f.flagId}`, { status: 'CONFIRMED' }), (r: any) => (r.listingTakenDown ? 'Confirmed. The listing was taken offline.' : 'Confirmed.'), reload)}>Confirm</button>
                      <button className="small ghost" disabled={a.busy} onClick={() => a.run(() => patch(`/api/admin/flags/${f.flagId}`, { status: 'DISMISSED' }), 'Dismissed.', reload)}>Dismiss</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.flags.length === 0 && <p className="muted">No flags.</p>}
      </div>
    </div>
  );
}

function Risk() {
  const { data, error } = useApi<{ owners: any[] }>('/api/admin/risk');
  if (error) return <div className="alert bad">{error}</div>;
  if (!data) return <p className="muted">Loading…</p>;
  return (
    <div className="card">
      <h2>Owner risk (view <span className="mono">v_owner_risk</span>)</h2>
      <DataTable rows={data.owners} />
    </div>
  );
}

function Graph() {
  const status = useApi<any>('/api/admin/graph/status');
  const a = useAction();
  const [clusters, setClusters] = useState<(ClusterView & { owners: number[] })[] | null>(null);
  const [stored, setStored] = useState<any>(null);
  const [trust, setTrust] = useState<{ ownerId: number; trust: number }[] | null>(null);
  const s = status.data;

  return (
    <div className="stack">
      <div className="card stack">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Graph database</h2>
          {s && (s.connected ? <Badge tone="good">Neo4j connected</Badge> : <Badge tone="bad">Neo4j not connected</Badge>)}
        </div>
        {s && !s.connected && (
          <div className="alert warn">
            {s.configured ? `Cannot reach Neo4j: ${s.error}` : 'Neo4j is not configured. Set NEO4J_URI, NEO4J_USER and NEO4J_PASSWORD in .env and start it with docker compose up -d.'}
          </div>
        )}
        {s && <p className="muted small" style={{ margin: 0 }}>{s.pendingEvents} change event(s) waiting in the PostgreSQL outbox.</p>}
        {s?.connected && (
          <div className="row">
            {s.nodes.map((n: any) => <Badge key={n.label} tone="gray">{n.label}: {n.count}</Badge>)}
            {s.relationships.map((n: any) => <Badge key={n.rel} tone="gray">{n.rel}: {n.count}</Badge>)}
          </div>
        )}
        <Flash msg={a.msg} err={a.err} />
        <div className="row">
          <button disabled={a.busy} onClick={() => a.run(() => post<any>('/api/admin/graph/sync'), (r) => `Synced ${r.processed} event(s) into Neo4j.`, status.reload)}>1. Sync outbox → Neo4j</button>
          <button disabled={a.busy} onClick={async () => {
            const r = await a.run(() => post<any>('/api/admin/graph/detect'), (x) => `Detection finished: ${x.stored.created} new flag(s), ${x.stored.refreshed} refreshed, ${x.stored.suppressed} suppressed (dismissed earlier).`);
            if (r) { setClusters(r.clusters); setStored(r); }
          }}>2. Detect rings and fraud patterns</button>
          <button disabled={a.busy} onClick={async () => {
            const r = await a.run(() => post<any>('/api/admin/graph/trust'), 'Trust scores recomputed and written to owner_profile.');
            if (r) setTrust(r.trust);
          }}>3. Compute trust scores</button>
        </div>
      </div>

      {clusters && (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Linked owner clusters</h2>
          {clusters.length === 0 && <p className="muted">No clusters found.</p>}
          {clusters.map((c) => (
            <div key={c.owners.join('-')} className="card" style={{ background: 'var(--bg)' }}>
              <div className="row between">
                <strong>{c.ownerNames.join(' · ')}</strong>
                <Badge tone="bad">{c.owners.length} owners linked</Badge>
              </div>
              <ClusterGraph c={c} />
            </div>
          ))}
          {stored && <div className="muted small">Findings: {stored.findings.map((f: any) => `${f.owner}: ${f.flagType}`).join(' · ')}</div>}
        </div>
      )}

      {trust && (
        <div className="card">
          <h2>Trust scores (personalised PageRank from verified tenants)</h2>
          <DataTable rows={[...trust].sort((x, y) => y.trust - x.trust)} />
        </div>
      )}
    </div>
  );
}

function Complaints() {
  const { data, error, reload } = useApi<{ complaints: any[] }>('/api/admin/complaints');
  const a = useAction();
  if (error) return <div className="alert bad">{error}</div>;
  if (!data) return <p className="muted">Loading…</p>;
  return (
    <div className="stack">
      <Flash msg={a.msg} err={a.err} />
      <div className="card tablewrap">
        <table>
          <thead><tr><th>#</th><th>Property</th><th>Owner</th><th>Category</th><th>Description</th><th>By</th><th>Status</th><th /></tr></thead>
          <tbody>
            {data.complaints.map((c) => (
              <tr key={c.complaintId}>
                <td>{c.complaintId}</td><td>#{c.propertyId}</td><td>{c.ownerName}</td><td>{humanize(c.category)}</td>
                <td style={{ maxWidth: 300 }}>{c.description}</td><td>{c.filedBy}</td><td><StatusBadge status={c.status} /></td>
                <td>
                  {(c.status === 'OPEN' || c.status === 'UNDER_REVIEW') && (
                    <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                      <button className="small" disabled={a.busy} onClick={() => a.run(() => patch(`/api/admin/complaints/${c.complaintId}`, { status: 'RESOLVED' }), 'Resolved.', reload)}>Resolve</button>
                      <button className="small ghost" disabled={a.busy} onClick={() => a.run(() => patch(`/api/admin/complaints/${c.complaintId}`, { status: 'REJECTED' }), 'Rejected.', reload)}>Reject</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Users() {
  const { data, error, reload } = useApi<{ users: any[] }>('/api/admin/users');
  const a = useAction();
  if (error) return <div className="alert bad">{error}</div>;
  if (!data) return <p className="muted">Loading…</p>;
  return (
    <div className="stack">
      <p className="muted small" style={{ margin: 0 }}>Verified tenants are the seeds of trust propagation: toggling verification changes owner trust scores after the next graph run.</p>
      <Flash msg={a.msg} err={a.err} />
      <div className="card tablewrap">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Phone</th><th>Verified</th><th /></tr></thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={u.userId}>
                <td>{u.fullName}</td><td>{u.email}</td><td>{u.role.toLowerCase()}</td><td className="mono">{u.phone}</td>
                <td>{u.verified ? <Badge tone="good">verified</Badge> : <Badge tone="gray">no</Badge>}</td>
                <td><button className="small ghost" disabled={a.busy} onClick={() => a.run(() => patch(`/api/admin/users/${u.userId}`, { verified: !u.verified }), u.verified ? 'Verification removed.' : 'Verified.', reload)}>{u.verified ? 'Unverify' : 'Verify'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Insights() {
  const { data, error } = useApi<{ results: { id: string; title: string; sql: string; rows: any[] }[] }>('/api/admin/insights');
  if (error) return <div className="alert bad">{error}</div>;
  if (!data) return <p className="muted">Loading…</p>;
  return (
    <div className="stack">
      {data.results.map((r) => (
        <div key={r.id} className="card">
          <h2>{r.title}</h2>
          <pre className="sql">{r.sql}</pre>
          <DataTable rows={r.rows} />
        </div>
      ))}
    </div>
  );
}
