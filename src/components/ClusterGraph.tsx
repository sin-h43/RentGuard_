'use client';

export interface ClusterView {
  owners: number[];
  ownerNames: string[];
  items: { kind: string; ref: string; owners: number[] }[];
}

const COLOR: Record<string, string> = { phone: '#0f766e', 'account phone': '#0e7490', photo: '#b45309', address: '#6b7280' };

/** Owners on the left, the shared phone / photo / address nodes on the right; an edge means "uses it". */
export default function ClusterGraph({ c }: { c: ClusterView }) {
  const rowH = 46;
  const n = Math.max(c.owners.length, c.items.length);
  const h = n * rowH + 24;
  const oy = (i: number) => 24 + i * ((h - 36) / Math.max(1, c.owners.length));
  const iy = (i: number) => 24 + i * ((h - 36) / Math.max(1, c.items.length));
  const label = (it: ClusterView['items'][number]) =>
    it.kind === 'photo' ? `photo ${it.ref.slice(0, 8)}…` : it.kind === 'address' ? it.ref.split('|').slice(1).join(', ').slice(0, 26) : `${it.kind}: ${it.ref}`;
  return (
    <svg viewBox={`0 0 640 ${h}`} width="100%" role="img" aria-label={`Owner cluster: ${c.ownerNames.join(', ')}`} style={{ maxHeight: 420 }}>
      {c.items.map((it, ii) =>
        it.owners.map((o) => {
          const oi = c.owners.indexOf(o);
          return oi < 0 ? null : <line key={`${ii}-${o}`} x1={170} y1={oy(oi)} x2={400} y2={iy(ii)} stroke={COLOR[it.kind] ?? '#888'} strokeWidth={1.6} opacity={0.7} />;
        }),
      )}
      {c.owners.map((o, i) => (
        <g key={o}>
          <circle cx={150} cy={oy(i)} r={14} fill="#14213d" />
          <text x={150} y={oy(i) + 4} textAnchor="middle" fontSize={11} fill="#fff">{o}</text>
          <text x={128} y={oy(i) + 4} textAnchor="end" fontSize={13} fill="currentColor">{c.ownerNames[i]}</text>
        </g>
      ))}
      {c.items.map((it, i) => (
        <g key={`${it.kind}-${it.ref}`}>
          <rect x={400} y={iy(i) - 12} width={230} height={24} rx={6} fill={COLOR[it.kind] ?? '#888'} />
          <text x={410} y={iy(i) + 4} fontSize={11} fill="#fff">{label(it)}</text>
        </g>
      ))}
    </svg>
  );
}
