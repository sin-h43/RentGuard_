import type { Finding, OwnerCluster, PairRow, StayEdge } from './types';

// ---------------------------------------------------------------------------
// Pure graph algorithms (no I/O). The traversal that FINDS the shared
// identity rows runs inside Neo4j (see cypher.ts); these functions turn the
// rows into clusters, findings and trust scores.
// ---------------------------------------------------------------------------

/** Evidence weights: a shared phone or photo is strong, a shared address is weak (family / co-owners). */
export const LINK_WEIGHT: Record<PairRow['rel'], number> = {
  LISTED_WITH_PHONE: 3,
  HAS_PHONE: 3,
  USES_PHOTO: 3,
  LOCATED_AT: 1,
};
export const LINK_THRESHOLD = 3;

const KIND: Record<PairRow['rel'], OwnerCluster['items'][number]['kind']> = {
  LISTED_WITH_PHONE: 'phone',
  HAS_PHONE: 'account phone',
  USES_PHOTO: 'photo',
  LOCATED_AT: 'address',
};

class UnionFind {
  private parent = new Map<number, number>();
  find(x: number): number {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let r = x;
    while (this.parent.get(r) !== r) r = this.parent.get(r)!;
    while (this.parent.get(x) !== r) {
      const next = this.parent.get(x)!;
      this.parent.set(x, r);
      x = next;
    }
    return r;
  }
  union(a: number, b: number) {
    this.parent.set(this.find(a), this.find(b));
  }
}

/** Groups owners that are linked by at least LINK_THRESHOLD worth of shared identity. */
export function clusterOwners(rows: PairRow[]): OwnerCluster[] {
  // distinct (pair, rel, ref) evidence -> per-pair score
  const seen = new Set<string>();
  const score = new Map<string, number>();
  for (const r of rows) {
    const [lo, hi] = r.a < r.b ? [r.a, r.b] : [r.b, r.a];
    const k = `${lo}|${hi}|${r.rel}|${r.ref}`;
    if (seen.has(k)) continue;
    seen.add(k);
    score.set(`${lo}|${hi}`, (score.get(`${lo}|${hi}`) ?? 0) + LINK_WEIGHT[r.rel]);
  }

  const uf = new UnionFind();
  const linked = new Set<number>();
  for (const [k, s] of score) {
    if (s < LINK_THRESHOLD) continue;
    const [a, b] = k.split('|').map(Number);
    uf.union(a, b);
    linked.add(a);
    linked.add(b);
  }

  const groups = new Map<number, Set<number>>();
  for (const o of linked) {
    const root = uf.find(o);
    if (!groups.has(root)) groups.set(root, new Set());
    groups.get(root)!.add(o);
  }

  const clusters: OwnerCluster[] = [];
  for (const members of groups.values()) {
    const items = new Map<string, OwnerCluster['items'][number]>();
    for (const r of rows) {
      if (!members.has(r.a) || !members.has(r.b)) continue;
      const k = `${r.rel}|${r.ref}`;
      const it = items.get(k) ?? { kind: KIND[r.rel], ref: r.ref, owners: [] };
      for (const o of [r.a, r.b]) if (!it.owners.includes(o)) it.owners.push(o);
      items.set(k, it);
    }
    clusters.push({ owners: [...members].sort((x, y) => x - y), items: [...items.values()] });
  }
  return clusters.sort((x, y) => y.owners.length - x.owners.length || x.owners[0] - y.owners[0]);
}

/** For each shared photo, the owner whose listing appeared LATER is the suspected copier. */
export function photoSuspects(rows: PairRow[]) {
  const out: { suspect: number; source: number; ref: string; suspectProp: number; sourceProp: number }[] = [];
  for (const r of rows) {
    if (r.rel !== 'USES_PHOTO') continue;
    const ta = r.listedA ? Date.parse(r.listedA) : NaN;
    const tb = r.listedB ? Date.parse(r.listedB) : NaN;
    const bLater = !Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb ? tb > ta : (r.propB ?? 0) > (r.propA ?? 0);
    out.push(
      bLater
        ? { suspect: r.b, source: r.a, ref: r.ref, suspectProp: r.propB ?? 0, sourceProp: r.propA ?? 0 }
        : { suspect: r.a, source: r.b, ref: r.ref, suspectProp: r.propA ?? 0, sourceProp: r.propB ?? 0 },
    );
  }
  return out;
}

export interface DetectionInput {
  pairRows: PairRow[]; // owner<->owner shared phone/photo/address + shared account phone
  selfPhotoReuse: { ownerId: number; ref: string; propA: number; propB: number }[];
  phoneSpread: { phone: string; owners: number[]; listings: number; addresses: number }[];
  collusion: { tenantId: number; ownerId: number; phone: string }[];
  reviewFarm: { ownerId: number; reviewers: number; singleUse: number }[];
}

/** Turns raw graph findings into per-owner, per-flag-type findings (one flag per owner and type). */
export function deriveFindings(input: DetectionInput): { findings: Finding[]; clusters: OwnerCluster[] } {
  const clusters = clusterOwners(input.pairRows);
  const map = new Map<string, Finding>();
  const add = (ownerId: number, flagType: Finding['flagType'], severity: number, signal: Record<string, unknown>) => {
    const k = `${ownerId}|${flagType}`;
    const f = map.get(k) ?? { ownerId, flagType, severity: 0, evidence: { signals: [] as unknown[] } };
    f.severity = Math.max(f.severity, severity);
    (f.evidence.signals as unknown[]).push(signal);
    map.set(k, f);
  };

  // 1) clusters that share a phone number -> everyone in the cluster uses a contact they do not own alone
  for (const c of clusters) {
    const phoneItems = c.items.filter((i) => i.kind === 'phone' || i.kind === 'account phone');
    if (phoneItems.length === 0) continue;
    const sev = c.owners.length >= 3 ? 5 : 4;
    const involved = new Set(phoneItems.flatMap((i) => i.owners));
    for (const o of involved) {
      add(o, 'SHARED_CONTACT', sev, {
        cluster: c.owners,
        sharedPhones: phoneItems.map((i) => i.ref),
        sharedPhotos: c.items.filter((i) => i.kind === 'photo').length,
        sharedAddresses: c.items.filter((i) => i.kind === 'address').length,
      });
    }
  }

  // 2) photo reuse: flag the later lister, not the original
  for (const s of photoSuspects(input.pairRows)) {
    add(s.suspect, 'DUPLICATE_PHOTO', 3, {
      copiedFromOwner: s.source,
      photo: s.ref.slice(0, 12),
      suspectProperty: s.suspectProp,
      sourceProperty: s.sourceProp,
    });
  }
  for (const r of input.selfPhotoReuse) {
    add(r.ownerId, 'DUPLICATE_PHOTO', 2, {
      sameOwner: true,
      photo: r.ref.slice(0, 12),
      properties: [r.propA, r.propB],
    });
  }

  // 3) one phone number on 3+ listings at 2+ addresses (even with a single owner account)
  for (const p of input.phoneSpread) {
    for (const o of p.owners) {
      add(o, 'SHARED_CONTACT', 3, { phone: p.phone, listings: p.listings, addresses: p.addresses });
    }
  }

  // 4) review collusion + review farms
  const byOwner = new Map<number, { tenants: number[]; phone: string }>();
  for (const c of input.collusion) {
    const e = byOwner.get(c.ownerId) ?? { tenants: [], phone: c.phone };
    if (!e.tenants.includes(c.tenantId)) e.tenants.push(c.tenantId);
    byOwner.set(c.ownerId, e);
  }
  for (const [ownerId, e] of byOwner) add(ownerId, 'REVIEW_RING', 4, { reviewersSharingOwnerPhone: e.tenants, phone: e.phone });
  for (const r of input.reviewFarm) add(r.ownerId, 'REVIEW_RING', 3, { reviewers: r.reviewers, singleUseReviewers: r.singleUse });

  return { findings: [...map.values()], clusters };
}

// ---------------------------------------------------------------------------
// Sybil-resistant trust: personalised PageRank, teleporting ONLY to ID-verified
// tenants. Fake accounts that no verified tenant is connected to get no mass.
// ---------------------------------------------------------------------------
export function personalizedPageRank(
  edges: { a: string; b: string; w: number }[],
  seeds: string[],
  alpha = 0.85,
  maxIter = 200,
  tol = 1e-12,
): Map<string, number> {
  const adj = new Map<string, Map<string, number>>();
  const link = (u: string, v: string, w: number) => {
    if (!adj.has(u)) adj.set(u, new Map());
    adj.get(u)!.set(v, (adj.get(u)!.get(v) ?? 0) + w);
  };
  for (const e of edges) {
    link(e.a, e.b, e.w);
    link(e.b, e.a, e.w);
  }
  const nodes = [...adj.keys()];
  const seedSet = [...new Set(seeds)].filter((s) => adj.has(s));
  const scores = new Map<string, number>(nodes.map((n) => [n, 0]));
  if (seedSet.length === 0) return scores;

  const teleport = new Map<string, number>(seedSet.map((s) => [s, 1 / seedSet.length]));
  let p = new Map<string, number>(nodes.map((n) => [n, teleport.get(n) ?? 0]));
  const outW = new Map<string, number>();
  for (const [u, nb] of adj) outW.set(u, [...nb.values()].reduce((x, y) => x + y, 0));

  for (let it = 0; it < maxIter; it++) {
    const next = new Map<string, number>(nodes.map((n) => [n, (1 - alpha) * (teleport.get(n) ?? 0)]));
    for (const [u, nb] of adj) {
      const share = alpha * (p.get(u) ?? 0);
      const total = outW.get(u)!;
      for (const [v, w] of nb) next.set(v, next.get(v)! + (share * w) / total);
    }
    let diff = 0;
    for (const n of nodes) diff += Math.abs(next.get(n)! - (p.get(n) ?? 0));
    p = next;
    if (diff < tol) break;
  }
  return p;
}

/** Owner trust 0..1 from verified-stay edges; best owner = 1. Owners with no verified-tenant path get 0. */
export function trustScores(edges: StayEdge[]): Map<number, number> {
  const ppr = personalizedPageRank(
    edges.map((e) => ({ a: `T${e.tenantId}`, b: `O${e.ownerId}`, w: Math.max(1, e.weight) })),
    [...new Set(edges.filter((e) => e.verified).map((e) => `T${e.tenantId}`))],
  );
  const owners = new Map<number, number>();
  for (const [node, s] of ppr) if (node.startsWith('O')) owners.set(Number(node.slice(1)), s);
  const top = Math.max(0, ...owners.values());
  for (const [o, s] of owners) owners.set(o, top === 0 ? 0 : s / top);
  return owners;
}
