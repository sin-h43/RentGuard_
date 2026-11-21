// Graph-layer tests.  Needs DATABASE_URL pointing at a database loaded with db/01_listing.sql + db/02_workflow.sql + db/seed.sql.
//   npm run test
//
// Neo4j itself is NOT required: the Cypher traversals are emulated from the same
// PostgreSQL seed data by `PgGraphEmulator`, so these tests check the algorithms,
// the outbox consumer and the flag persistence end to end. The Cypher text is
// checked separately (tests/cypher-syntax.test.mjs) and by running the app against Neo4j.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { pool, tx } from '../src/lib/db';
import * as Q from '../src/lib/graph/cypher';
import { clusterOwners, personalizedPageRank, photoSuspects, trustScores } from '../src/lib/graph/algorithms';
import { computeTrust, detect, persistFindings } from '../src/lib/graph/detect';
import { addressKey, runSync } from '../src/lib/graph/sync';
import type { CypherRunner, Db, PairRow } from '../src/lib/graph/types';

const db: Db = { query: async (t, p) => (await pool().query(t, p as any[])).rows };

// ------------------------------------------------------------------ pure algorithms
describe('algorithms', () => {
  it('address-only overlap does not cluster owners, address + photo does', () => {
    const addr: PairRow = { a: 1, b: 2, rel: 'LOCATED_AT', ref: 'x' };
    assert.equal(clusterOwners([addr]).length, 0);
    const photo: PairRow = { a: 1, b: 2, rel: 'USES_PHOTO', ref: 'h' };
    assert.deepEqual(clusterOwners([addr, photo]).map((c) => c.owners), [[1, 2]]);
  });

  it('clusters are transitive (1-2, 2-3 => {1,2,3})', () => {
    const rows: PairRow[] = [
      { a: 1, b: 2, rel: 'LISTED_WITH_PHONE', ref: 'p1' },
      { a: 2, b: 3, rel: 'USES_PHOTO', ref: 'h' },
      { a: 8, b: 9, rel: 'HAS_PHONE', ref: 'p2' },
    ];
    assert.deepEqual(clusterOwners(rows).map((c) => c.owners), [[1, 2, 3], [8, 9]]);
  });

  it('the later lister of a shared photo is the suspect', () => {
    const [s] = photoSuspects([
      { a: 3, b: 9, rel: 'USES_PHOTO', ref: 'h', propA: 3, propB: 14, listedA: '2026-01-01T00:00:00Z', listedB: '2026-03-01T00:00:00Z' },
    ]);
    assert.equal(s.suspect, 9);
    assert.equal(s.source, 3);
  });

  it('personalised PageRank sums to 1 and gives isolated sybils nothing', () => {
    const edges = [
      { a: 'T1', b: 'O1', w: 1 },
      { a: 'T2', b: 'O1', w: 1 },
      { a: 'T3', b: 'O2', w: 1 },
      { a: 'S1', b: 'O9', w: 12 }, // sybil pair, never connected to a verified tenant
    ];
    const r = personalizedPageRank(edges, ['T1', 'T2', 'T3']);
    const sum = [...r.values()].reduce((x, y) => x + y, 0);
    assert.ok(Math.abs(sum - 1) < 1e-6, `sum=${sum}`);
    assert.ok(r.get('O1')! > r.get('O2')!);
    assert.equal(r.get('O9'), 0);
  });

  it('trustScores: best owner = 1, unverified-only owner = 0, no seeds = all 0', () => {
    const t = trustScores([
      { tenantId: 1, verified: true, ownerId: 10, weight: 6 },
      { tenantId: 2, verified: true, ownerId: 10, weight: 6 },
      { tenantId: 3, verified: false, ownerId: 11, weight: 12 },
    ]);
    assert.equal(t.get(10), 1);
    assert.equal(t.get(11), 0);
    const none = trustScores([{ tenantId: 3, verified: false, ownerId: 11, weight: 12 }]);
    assert.equal(none.get(11), 0);
  });

  it('addressKey normalises case and punctuation', () => {
    assert.equal(addressKey('560038', 'Indiranagar', '12, M.G. Road'), addressKey('560038', ' indiranagar ', '12 mg road'));
  });
});

// ------------------------------------------------------------------ emulate Neo4j from PostgreSQL
class PgGraphEmulator implements CypherRunner {
  writes: { cypher: string; params: Record<string, any> }[] = [];
  private d!: Awaited<ReturnType<PgGraphEmulator['load']>>;

  async load() {
    const props = await db.query<{ id: number; owner: number; listed: Date }>(
      `SELECT p.property_id AS id, p.owner_id AS owner,
              (SELECT min(recorded_at) FROM listing_version v WHERE v.property_id = p.property_id) AS listed
         FROM property p ORDER BY 1`,
    );
    const versions = await db.query<any>(`SELECT property_id, contact_phone, pincode, locality, address_line FROM listing_version`);
    const photos = await db.query<any>(`SELECT lv.property_id, lp.sha256 FROM listing_photo lp JOIN listing_version lv USING (version_id)`);
    const users = await db.query<any>(
      `SELECT u.user_id AS id, u.role, u.phone, COALESCE(t.id_verified, false) AS verified
         FROM app_user u LEFT JOIN tenant_profile t ON t.tenant_id = u.user_id`,
    );
    const stays = await db.query<any>(
      `SELECT l.lease_id, l.tenant_id, p.owner_id, l.start_date, l.end_date
         FROM lease l JOIN property p USING (property_id) WHERE l.status IN ('ACTIVE','ENDED')`,
    );
    const reviews = await db.query<any>(`SELECT r.tenant_id, p.owner_id FROM review r JOIN lease l USING (lease_id) JOIN property p USING (property_id)`);
    const set = (m: Map<number, Set<string>>, k: number, v: string) => (m.get(k) ?? m.set(k, new Set()).get(k)!).add(v);
    const phone = new Map<number, Set<string>>(), addr = new Map<number, Set<string>>(), photo = new Map<number, Set<string>>();
    for (const v of versions) {
      set(phone, v.property_id, v.contact_phone);
      set(addr, v.property_id, addressKey(v.pincode, v.locality, v.address_line));
    }
    for (const p of photos) set(photo, p.property_id, p.sha256);
    return { props, phone, addr, photo, users, stays, reviews };
  }

  async read(cypher: string): Promise<Record<string, any>[]> {
    this.d ??= await this.load();
    const { props, phone, addr, photo, users, stays, reviews } = this.d;
    const own = (id: number) => props.find((p) => p.id === id)!;
    switch (cypher) {
      case Q.SHARED_IDENTITY_PAIRS: {
        const out: any[] = [];
        for (const p1 of props) for (const p2 of props) {
          if (!(p1.owner < p2.owner)) continue;
          for (const [rel, m] of [['LISTED_WITH_PHONE', phone], ['USES_PHOTO', photo], ['LOCATED_AT', addr]] as const) {
            for (const ref of m.get(p1.id) ?? []) if (m.get(p2.id)?.has(ref))
              out.push({ a: p1.owner, b: p2.owner, rel, ref, propA: p1.id, propB: p2.id, listedA: new Date(p1.listed).toISOString(), listedB: new Date(p2.listed).toISOString() });
          }
        }
        return out;
      }
      case Q.SHARED_ACCOUNT_PHONE: {
        const owners = users.filter((u) => u.role === 'OWNER');
        return owners.flatMap((a) => owners.filter((b) => a.id < b.id && a.phone === b.phone).map((b) => ({ a: a.id, b: b.id, rel: 'HAS_PHONE', ref: a.phone })));
      }
      case Q.SELF_PHOTO_REUSE: {
        const out: any[] = [];
        for (const p1 of props) for (const p2 of props) {
          if (!(p1.id < p2.id) || p1.owner !== p2.owner) continue;
          for (const ref of photo.get(p1.id) ?? []) if (photo.get(p2.id)?.has(ref)) {
            const differ = [...addr.get(p1.id)!].some((x) => [...addr.get(p2.id)!].some((y) => x !== y));
            if (differ) out.push({ ownerId: p1.owner, ref, propA: p1.id, propB: p2.id });
          }
        }
        return out;
      }
      case Q.PHONE_SPREAD: {
        const byPhone = new Map<string, number[]>();
        for (const p of props) for (const ph of phone.get(p.id) ?? []) byPhone.set(ph, [...(byPhone.get(ph) ?? []), p.id]);
        return [...byPhone].flatMap(([ph, ids]) => {
          const addrs = new Set(ids.flatMap((i) => [...addr.get(i)!]));
          return ids.length >= 3 && addrs.size >= 2 ? [{ phone: ph, owners: [...new Set(ids.map((i) => own(i).owner))], listings: ids.length, addresses: addrs.size }] : [];
        });
      }
      case Q.REVIEW_COLLUSION: {
        const phoneOf = new Map(users.map((u) => [u.id, u.phone]));
        const pairs = [...reviews.map((r) => [r.tenant_id, r.owner_id]), ...stays.map((s) => [s.tenant_id, s.owner_id])];
        const seen = new Set<string>();
        return pairs.flatMap(([t, o]) => {
          const k = `${t}|${o}`;
          if (seen.has(k) || phoneOf.get(t) !== phoneOf.get(o)) return [];
          seen.add(k);
          return [{ tenantId: t, ownerId: o, phone: phoneOf.get(t) }];
        });
      }
      case Q.REVIEW_FARM: {
        const perTenant = new Map<number, number>();
        for (const r of reviews) perTenant.set(r.tenant_id, (perTenant.get(r.tenant_id) ?? 0) + 1);
        const byOwner = new Map<number, number[]>();
        for (const r of reviews) byOwner.set(r.owner_id, [...(byOwner.get(r.owner_id) ?? []), r.tenant_id]);
        return [...byOwner].flatMap(([o, ts]) => {
          const uniq = [...new Set(ts)];
          const single = uniq.filter((t) => perTenant.get(t) === 1).length;
          return uniq.length >= 3 && single / uniq.length >= 0.8 ? [{ ownerId: o, reviewers: uniq.length, singleUse: single }] : [];
        });
      }
      case Q.STAY_EDGES: {
        const verified = new Map(users.map((u) => [u.id, u.verified]));
        return stays.map((s) => {
          const months = Math.max(1, Math.floor((Math.min(Date.parse(s.end_date), Date.now()) - Date.parse(s.start_date)) / (30 * 86_400_000)));
          return { tenantId: s.tenant_id, verified: verified.get(s.tenant_id), ownerId: s.owner_id, weight: Math.min(12, months) };
        });
      }
      default:
        throw new Error('emulator does not implement: ' + cypher.slice(0, 60));
    }
  }

  async write(cypher: string, params: Record<string, any> = {}) {
    this.writes.push({ cypher, params });
    return [];
  }
}

// ------------------------------------------------------------------ against the seeded database
describe('graph pipeline on seed data', () => {
  before(async () => {
    await db.query(`DELETE FROM fraud_flag WHERE source = 'GRAPH'`);
    await db.query(`UPDATE graph_outbox SET processed_at = NULL`);
    await db.query(`UPDATE owner_profile SET trust_score = 0`);
  });
  after(async () => {
    await pool().end();
  });

  it('outbox consumer: every event is applied once, then the queue is empty', async () => {
    const g = new PgGraphEmulator();
    const [{ n }] = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM graph_outbox WHERE processed_at IS NULL');
    assert.ok(n > 0, 'seed must have produced outbox events');

    const withTx = (fn: (d: Db) => Promise<any>) => tx((c) => fn({ query: async (t, p) => (await c.query(t, p as any[])).rows }));
    const first = await runSync(withTx as any, g);
    assert.equal(first.processed, n);

    const listingWrites = g.writes.filter((w) => w.cypher === Q.UPSERT_LISTING);
    const [{ lv }] = await db.query<{ lv: number }>('SELECT count(*)::int AS lv FROM listing_version');
    assert.equal(listingWrites.length, lv);
    for (const w of listingWrites) {
      for (const k of ['ownerId', 'propertyId', 'phone', 'addrKey', 'recordedAt']) assert.ok(w.params[k] !== undefined && w.params[k] !== null, `missing ${k}`);
      assert.ok(Array.isArray(w.params.photoHashes) && w.params.photoHashes.length >= 1);
    }
    // 12 leases in the seed are ACTIVE/ENDED -> 12 stays; 12 reviews
    assert.equal(g.writes.filter((w) => w.cypher === Q.UPSERT_STAY).length, 12);
    assert.equal(g.writes.filter((w) => w.cypher === Q.UPSERT_REVIEW).length, 12);

    const second = await runSync(withTx as any, new PgGraphEmulator());
    assert.equal(second.processed, 0);
    const [{ pending }] = await db.query<{ pending: number }>('SELECT count(*)::int AS pending FROM graph_outbox WHERE processed_at IS NULL');
    assert.equal(pending, 0);
  });

  it('detection finds the planted ring, the photo thief and the review farm - and no honest owner', async () => {
    const { findings, clusters } = await detect(new PgGraphEmulator());
    // equal-size clusters are ordered by lowest owner id
    assert.deepEqual(clusters.map((c) => c.owners), [[3, 9], [6, 7]]);

    const has = (owner: number, type: string) => findings.find((f) => f.ownerId === owner && f.flagType === type);
    assert.ok(has(6, 'SHARED_CONTACT') && has(7, 'SHARED_CONTACT'), 'ring owners share a contact');
    assert.ok(has(7, 'DUPLICATE_PHOTO'), 'Anil copied Vikram\'s photos (listed later)');
    assert.ok(!has(6, 'DUPLICATE_PHOTO'), 'original lister is not flagged');
    assert.ok(has(9, 'DUPLICATE_PHOTO'), 'Kiran copied Lakshmi\'s photo');
    assert.ok(!has(3, 'DUPLICATE_PHOTO'), 'Lakshmi (original) is not flagged');
    assert.ok(has(6, 'REVIEW_RING'), 'Vikram: reviewers share his phone / are single-use');

    const honest = [2, 3, 4, 5, 8];
    assert.deepEqual(findings.filter((f) => honest.includes(f.ownerId)), [], 'no false positives on honest owners');
  });

  it('persisting findings is idempotent and respects dismissals', async () => {
    const { findings } = await detect(new PgGraphEmulator());
    const a = await persistFindings(db, findings);
    assert.equal(a.created, findings.length);
    const b = await persistFindings(db, findings);
    assert.equal(b.created, 0);
    assert.equal(b.refreshed, findings.length);

    await db.query(
      `UPDATE fraud_flag SET status = 'DISMISSED', reviewed_by = 1
        WHERE source = 'GRAPH' AND owner_id = 9 AND flag_type = 'DUPLICATE_PHOTO'`,
    );
    const c = await persistFindings(db, findings);
    assert.equal(c.suppressed, 1);
    assert.equal(c.created, 0);
  });

  it('trust propagation: verified-tenant owners > 0, sybil review ring = 0, written back to SQL', async () => {
    const rows = await computeTrust(new PgGraphEmulator(), db);
    const t = new Map(rows.map((r) => [r.ownerId, r.trust]));
    for (const honest of [2, 3, 4, 5]) assert.ok(t.get(honest)! > 0.9, `owner ${honest} trust ${t.get(honest)}`);
    assert.ok(t.get(8)! > 0 && t.get(8)! < t.get(2)!, 'owner with a single verified stay ranks below owners with two');
    assert.equal(t.get(6), 0, 'Vikram: only unverified (collusive) tenants');
    assert.equal(t.get(7), 0);
    assert.equal(t.get(9), 0);
    const [{ trust_score }] = await db.query('SELECT trust_score FROM owner_profile WHERE owner_id = 2');
    assert.ok(trust_score > 0.9);
  });
});
