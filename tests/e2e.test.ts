// End-to-end API tests against a RUNNING app.
//   1) npm run db:reset && npm run build && PORT=3100 npm start
//   2) BASE_URL=http://localhost:3100 npm run test:e2e
// Neo4j is not needed: the graph endpoints are expected to answer "not configured" (503/200) without it.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
const PASSWORD = 'Passw0rd!';
const run = Date.now().toString(36);

class Client {
  cookie = '';
  async req(method: string, path: string, body?: unknown, opts: { raw?: boolean; redirect?: RequestRedirect } = {}) {
    const isForm = body instanceof FormData;
    const res = await fetch(BASE + path, {
      method,
      redirect: opts.redirect ?? 'follow',
      headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...(body && !isForm ? { 'content-type': 'application/json' } : {}) },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    const data = opts.raw ? null : await res.json().catch(() => ({}));
    return { status: res.status, data: data as any, res };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b?: unknown) => this.req('POST', p, b ?? {});
  patch = (p: string, b?: unknown) => this.req('PATCH', p, b ?? {});
  async login(email: string, password = PASSWORD) {
    const r = await this.post('/api/auth/login', { email, password });
    assert.equal(r.status, 200, `login ${email}: ${JSON.stringify(r.data)}`);
    return r.data;
  }
}

// a valid 1x1 PNG plus random trailing bytes so every call produces a different image hash
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const png = (tag: string) => new File([Buffer.concat([PNG, Buffer.from(tag + Math.random())])], `${tag}.png`, { type: 'image/png' });

function listingForm(propertyId: number, over: Record<string, string> = {}, files: File[] = [], keep: string[] = []) {
  const fd = new FormData();
  const base: Record<string, string> = {
    propertyId: String(propertyId), title: 'E2E test PG', monthlyRent: '10000', securityDeposit: '20000',
    addressLine: `${run} Test Street`, locality: 'Testville', city: 'Bengaluru', pincode: '560001',
    contactPhone: '9000000' + String(Math.floor(Math.random() * 900) + 100), amenities: 'wifi, meals',
    effectiveFrom: new Date().toISOString().slice(0, 10), ...over,
  };
  for (const [k, v] of Object.entries(base)) fd.set(k, v);
  fd.set('keepPhotos', JSON.stringify(keep));
  for (const f of files) fd.append('photos', f);
  return fd;
}

const s: Record<string, any> = {};

describe('public + auth + role guards', () => {
  it('lists seeded listings and supports full-text search and filters', async () => {
    const c = new Client();
    const all = await c.get('/api/listings');
    assert.equal(all.status, 200);
    assert.ok(all.data.listings.length >= 12);
    const fts = await c.get('/api/listings?q=' + encodeURIComponent('indiranagar'));
    const ids = fts.data.listings.map((l: any) => l.propertyId);
    assert.ok(ids.includes(1) && ids.includes(7), 'full-text search finds Indiranagar listings');
    const cheap = await c.get('/api/listings?maxRent=7000&type=PG');
    assert.ok(cheap.data.listings.every((l: any) => l.monthlyRent <= 7000 && l.propertyType === 'PG'));
  });

  it('hides street address and phone from anonymous visitors', async () => {
    const d = await new Client().get('/api/listings/1');
    assert.equal(d.status, 200);
    assert.equal(d.data.listing.addressLine, null);
    assert.equal(d.data.listing.contactPhone, null);
    assert.equal(d.data.chainIntact, true);
  });

  it('SQL-injection style input is treated as data, not code', async () => {
    const r = await new Client().get('/api/listings?q=' + encodeURIComponent("'; DROP TABLE property; --") + '&locality=' + encodeURIComponent("%' OR '1'='1"));
    assert.equal(r.status, 200);
    const check = await new Client().get('/api/listings');
    assert.ok(check.data.listings.length >= 12, 'tables still intact');
  });

  it('protected API and pages require login', async () => {
    const c = new Client();
    assert.equal((await c.get('/api/tenant/dashboard')).status, 401);
    assert.equal((await c.get('/api/admin/flags')).status, 401);
    const page = await c.req('GET', '/admin', undefined, { raw: true, redirect: 'manual' });
    assert.equal(page.status, 307);
    assert.match(page.res.headers.get('location') ?? '', /\/login\?next=%2Fadmin/);
  });

  it('registration validates input (app level) and the database (unique e-mail)', async () => {
    const c = new Client();
    const good = { email: `t1_${run}@example.com`, password: PASSWORD, fullName: 'E2E Tenant One', phone: '9111111111', role: 'TENANT' };
    assert.equal((await c.post('/api/auth/register', { ...good, password: 'short' })).status, 400);
    assert.equal((await c.post('/api/auth/register', { ...good, password: 'nodigitshere' })).status, 400);
    assert.equal((await c.post('/api/auth/register', { ...good, phone: '12ab' })).status, 400);
    assert.equal((await c.post('/api/auth/register', { ...good, role: 'ADMIN' })).status, 400, 'cannot self-register as admin');
    assert.equal((await c.post('/api/auth/register', good)).status, 200);
    assert.equal((await new Client().post('/api/auth/register', good)).status, 409, 'duplicate e-mail');
  });

  it('passwords are stored as bcrypt hashes, never plain text', async () => {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const { rows } = await pool.query('SELECT password_hash FROM app_user');
    await pool.end();
    assert.ok(rows.length > 10);
    assert.ok(rows.every((r) => /^\$2[aby]\$\d\d\$/.test(r.password_hash) && !r.password_hash.includes(PASSWORD)));
  });

  it('wrong passwords are rejected, repeated attempts are rate-limited', async () => {
    const c = new Client();
    const email = `nobody_${run}@example.com`;
    const first = await c.post('/api/auth/login', { email, password: 'whatever1' });
    assert.equal(first.status, 401);
    assert.equal(first.data.error, 'Invalid email or password.', 'no user enumeration');
    let last = 401;
    for (let i = 0; i < 10; i++) last = (await c.post('/api/auth/login', { email, password: 'whatever1' })).status;
    assert.equal(last, 429);
  });

  it('roles are enforced: a tenant cannot reach owner or admin endpoints', async () => {
    const t = new Client();
    await t.login('t10@rentguard.test');
    assert.equal((await t.get('/api/admin/flags')).status, 403);
    assert.equal((await t.get('/api/owner/dashboard')).status, 403);
    assert.equal((await t.post('/api/owner/properties', { propertyType: 'PG' })).status, 403);
    const o = new Client();
    await o.login('ramesh@rentguard.test');
    assert.equal((await o.post('/api/inquiries', { propertyId: 1, seenVersionId: 1 })).status, 403);
    // page-level guard: an owner is bounced from /admin to their own area
    const bounce = await o.req('GET', '/admin', undefined, { raw: true, redirect: 'manual' });
    assert.equal(bounce.status, 307);
    assert.match(bounce.res.headers.get('location') ?? '', /\/owner$/);
  });
});

describe('owner -> tenant -> escrow -> lease flow', () => {
  const owner = new Client();
  const tenant = new Client();

  it('owner signs up, adds a property and publishes version 1 with an uploaded photo', async () => {
    const reg = await owner.post('/api/auth/register', { email: `owner_${run}@example.com`, password: PASSWORD, fullName: 'E2E Owner', phone: '9222222222', role: 'OWNER' });
    assert.equal(reg.status, 200);
    s.ownerId = reg.data.id;
    const prop = await owner.post('/api/owner/properties', { propertyType: 'PG' });
    assert.equal(prop.status, 200);
    s.propertyId = prop.data.propertyId;

    assert.equal((await owner.req('POST', '/api/owner/listings', listingForm(s.propertyId, {}, []))).status, 400, 'at least one photo required');
    assert.equal((await owner.req('POST', '/api/owner/listings', listingForm(s.propertyId, { monthlyRent: '-5' }, [png('a')]))).status, 400);
    assert.equal((await owner.req('POST', '/api/owner/listings', listingForm(s.propertyId, { pincode: '12' }, [png('a')]))).status, 400);
    const fake = new File([Buffer.from('<?php echo 1; ?>')], 'x.png', { type: 'image/png' });
    assert.equal((await owner.req('POST', '/api/owner/listings', listingForm(s.propertyId, {}, [fake]))).status, 400, 'content must really be an image');

    const pub = await owner.req('POST', '/api/owner/listings', listingForm(s.propertyId, {}, [png('v1')]));
    assert.equal(pub.status, 200, JSON.stringify(pub.data));
    assert.deepEqual(pub.data.flagsRaised, []);
    s.v1 = pub.data.versionId;
  });

  it('another owner cannot publish to this property', async () => {
    const other = new Client();
    await other.login('lakshmi@rentguard.test');
    const r = await other.req('POST', '/api/owner/listings', listingForm(s.propertyId, {}, [png('x')]));
    assert.equal(r.status, 403);
  });

  it('listing appears in public search with the uploaded photo', async () => {
    const r = await new Client().get('/api/listings?q=Testville');
    const mine = r.data.listings.find((l: any) => l.propertyId === s.propertyId);
    assert.ok(mine, 'new listing is searchable');
    assert.match(mine.coverPhoto, /^[0-9a-f]{64}$/);
    const img = await fetch(`${BASE}/api/photos/${mine.coverPhoto}`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
  });

  it('tenant enquires; duplicate enquiry for the same version is rejected', async () => {
    await tenant.login(`t1_${run}@example.com`);
    const d = await tenant.get(`/api/listings/${s.propertyId}`);
    assert.ok(d.data.listing.addressLine, 'logged-in tenant sees the address');
    const inq = await tenant.post('/api/inquiries', { propertyId: s.propertyId, seenVersionId: d.data.listing.versionId, message: 'Is it available?' });
    assert.equal(inq.status, 200);
    s.inquiryId = inq.data.inquiryId;
    assert.equal((await tenant.post('/api/inquiries', { propertyId: s.propertyId, seenVersionId: d.data.listing.versionId })).status, 409);
    // a version of ANOTHER property cannot be pinned
    assert.equal((await tenant.post('/api/inquiries', { propertyId: s.propertyId, seenVersionId: 1 })).status, 400);
  });

  it('escrow: amount rules, idempotent payment, one-time OTP, two-party release', async () => {
    assert.equal((await tenant.post('/api/escrow', { inquiryId: s.inquiryId, amount: 50 })).status, 400, 'below minimum');
    assert.equal((await tenant.post('/api/escrow', { inquiryId: s.inquiryId, amount: 99999 })).status, 400, 'more than one month rent');
    const key = crypto.randomUUID();
    const pay = await tenant.post('/api/escrow', { inquiryId: s.inquiryId, amount: 1000, idempotencyKey: key });
    assert.equal(pay.status, 200, JSON.stringify(pay.data));
    assert.match(pay.data.otp, /^\d{6}$/);
    s.escrowId = pay.data.escrowId;
    s.otp = pay.data.otp;

    const replay = await tenant.post('/api/escrow', { inquiryId: s.inquiryId, amount: 1000, idempotencyKey: key });
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.otp, undefined, 'OTP is never shown twice');
    assert.equal((await tenant.post('/api/escrow', { inquiryId: s.inquiryId, amount: 1000 })).status, 409, 'one escrow per enquiry');

    // owner enters a wrong code
    const wrong = await owner.post(`/api/escrow/${s.escrowId}/checkin`, { otp: s.otp === '123456' ? '654321' : '123456' });
    assert.equal(wrong.status, 400);
    assert.match(wrong.data.error, /invalid otp/i);
    // owner cannot release with only their side (tenant not checked in): no release yet
    const ownerFirst = await owner.post(`/api/escrow/${s.escrowId}/checkin`, { otp: s.otp });
    assert.equal(ownerFirst.status, 200);
    assert.equal(ownerFirst.data.status, 'HELD', 'still held until the tenant checks in');
    const t = await tenant.post(`/api/escrow/${s.escrowId}/checkin`);
    assert.equal(t.data.status, 'RELEASED', JSON.stringify(t.data));
    // can't refund after release
    assert.equal((await owner.post(`/api/escrow/${s.escrowId}/refund`)).status, 400);
  });

  it('lease: created at the rent the tenant saw; overlapping lease rejected; early review rejected', async () => {
    const start = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + 300 * 86_400_000).toISOString().slice(0, 10);
    const lease = await owner.post('/api/leases', { inquiryId: s.inquiryId, startDate: start, endDate: end });
    assert.equal(lease.status, 200, JSON.stringify(lease.data));
    s.leaseId = lease.data.leaseId;
    assert.equal((await owner.post('/api/leases', { inquiryId: s.inquiryId, startDate: start, endDate: end })).status, 409, 'overlap');
    assert.equal((await owner.post('/api/leases', { inquiryId: s.inquiryId, startDate: end, endDate: start })).status, 400);
    const early = await tenant.post('/api/reviews', { leaseId: s.leaseId, rating: 5, comment: 'great' });
    assert.equal(early.status, 400);
    assert.match(early.data.error, /30 days/);
    // someone else's lease cannot be reviewed
    const stranger = new Client();
    await stranger.login('t11@rentguard.test');
    assert.equal((await stranger.post('/api/reviews', { leaseId: s.leaseId, rating: 1 })).status, 400);
  });
});

describe('fraud triggers, dispute evidence and admin actions', () => {
  const owner = new Client();
  const tenant = new Client();
  const admin = new Client();

  it('price hike right after an enquiry is flagged by a database trigger', async () => {
    await owner.login(`owner_${run}@example.com`);
    await tenant.login(`t1_${run}@example.com`);
    const prop = await owner.post('/api/owner/properties', { propertyType: 'ROOM' });
    s.p2 = prop.data.propertyId;
    const v1 = await owner.req('POST', '/api/owner/listings', listingForm(s.p2, { monthlyRent: '8000', title: 'E2E bait room', locality: 'Baitville', contactPhone: '9000000555' }, [png('b1')]));
    assert.equal(v1.status, 200);
    const d = await tenant.get(`/api/listings/${s.p2}`);
    const inq = await tenant.post('/api/inquiries', { propertyId: s.p2, seenVersionId: d.data.listing.versionId });
    s.inq2 = inq.data.inquiryId;

    const keep = d.data.photos as string[];
    const ok = await owner.req('POST', '/api/owner/listings', listingForm(s.p2, { monthlyRent: '8400', title: 'E2E bait room', locality: 'Baitville', contactPhone: '9000000555' }, [], keep));
    assert.deepEqual(ok.data.flagsRaised, [], '5% change is not flagged');
    const bad = await owner.req('POST', '/api/owner/listings', listingForm(s.p2, { monthlyRent: '12000', title: 'E2E bait room', locality: 'Baitville', contactPhone: '9000000555' }, [], keep));
    assert.equal(bad.status, 200);
    assert.deepEqual(bad.data.flagsRaised.map((f: any) => f.flag_type), ['BAIT_AND_SWITCH']);
  });

  it('keepPhotos cannot claim a photo that never belonged to this property', async () => {
    const stolen = (await new Client().get('/api/listings/1')).data.photos[0];
    const r = await owner.req('POST', '/api/owner/listings', listingForm(s.p2, { monthlyRent: '12000' }, [], [stolen]));
    assert.equal(r.status, 400);
  });

  it('tenant sees the change and gets bitemporal evidence; hash chain intact', async () => {
    const dash = await tenant.get('/api/tenant/dashboard');
    const row = dash.data.inquiries.find((i: any) => i.inquiryId === s.inq2);
    assert.equal(row.seenRent, 8000);
    assert.equal(row.currentRent, 12000);
    const ev = await tenant.get(`/api/disputes/${s.inq2}`);
    assert.equal(ev.status, 200);
    assert.deepEqual(ev.data.changed, ['monthly_rent']);
    assert.equal(ev.data.seen.monthly_rent, 8000);
    assert.equal(ev.data.asOf.monthly_rent, 8000, 'what the database knew when the tenant enquired');
    assert.equal(ev.data.current.monthly_rent, 12000);
    assert.equal(ev.data.chainIntact, true);
    const stranger = new Client();
    await stranger.login('t11@rentguard.test');
    assert.equal((await stranger.get(`/api/disputes/${s.inq2}`)).status, 403, 'only parties see the evidence');
  });

  it('three different tenants complaining about one owner trigger a HIGH_COMPLAINTS flag', async () => {
    for (let i = 2; i <= 4; i++) {
      const t = new Client();
      const r = await t.post('/api/auth/register', { email: `t${i}_${run}@example.com`, password: PASSWORD, fullName: `E2E Tenant ${i}`, phone: `91111111${10 + i}`, role: 'TENANT' });
      assert.equal(r.status, 200);
      assert.equal((await t.post('/api/complaints', { propertyId: s.p2, category: 'FAKE_LISTING', description: 'Owner asked for money before showing the room.' })).status, 200);
    }
    assert.equal((await tenant.post('/api/complaints', { propertyId: s.p2, category: 'OTHER', description: 'short' })).status, 400, 'description too short');
  });

  it('admin reviews flags: confirming a property flag takes the listing offline', async () => {
    await admin.login('admin@rentguard.test');
    const flags = await admin.get('/api/admin/flags?status=OPEN');
    const mine = flags.data.flags.filter((f: any) => f.ownerId === s.ownerId);
    const types = mine.map((f: any) => f.flagType).sort();
    assert.deepEqual(types, ['BAIT_AND_SWITCH', 'HIGH_COMPLAINTS']);
    const bait = mine.find((f: any) => f.flagType === 'BAIT_AND_SWITCH');
    assert.equal(bait.source, 'SQL_TRIGGER');
    assert.equal(bait.propertyId, s.p2);

    const conf = await admin.patch(`/api/admin/flags/${bait.flagId}`, { status: 'CONFIRMED' });
    assert.equal(conf.status, 200);
    assert.equal(conf.data.listingTakenDown, true);
    const search = await new Client().get('/api/listings?q=Baitville');
    assert.equal(search.data.listings.length, 0, 'taken-down listing disappears from search');
    const hc = mine.find((f: any) => f.flagType === 'HIGH_COMPLAINTS');
    assert.equal((await admin.patch(`/api/admin/flags/${hc.flagId}`, { status: 'DISMISSED' })).status, 200);
    assert.equal((await admin.patch('/api/admin/flags/99999', { status: 'DISMISSED' })).status, 404);
    assert.equal((await admin.patch(`/api/admin/flags/${hc.flagId}`, { status: 'OPEN' })).status, 400, 'invalid status');
  });

  it('admin: complaints workflow and user verification', async () => {
    const c = await admin.get('/api/admin/complaints');
    const open = c.data.complaints.find((x: any) => x.status === 'OPEN');
    assert.equal((await admin.patch(`/api/admin/complaints/${open.complaintId}`, { status: 'RESOLVED' })).status, 200);
    const users = await admin.get('/api/admin/users');
    const u = users.data.users.find((x: any) => x.email === `t1_${run}@example.com`);
    assert.equal(u.verified, false);
    assert.equal((await admin.patch(`/api/admin/users/${u.userId}`, { verified: true })).status, 200);
  });

  it('SQL insights run and the ledger balances (debits = credits)', async () => {
    const r = await admin.get('/api/admin/insights');
    assert.equal(r.status, 200);
    assert.equal(r.data.results.length, 6);
    const ledger = r.data.results.find((x: any) => x.id === 'ledger-balance').rows;
    const d = ledger.reduce((a: number, x: any) => a + x.debits, 0);
    const cr = ledger.reduce((a: number, x: any) => a + x.credits, 0);
    assert.equal(d, cr);
    assert.ok(d > 0);
    const rent = r.data.results.find((x: any) => x.id === 'rent-changes').rows;
    assert.ok(rent.length >= 2, 'rent-change history (LAG) has rows');
    const risky = r.data.results.find((x: any) => x.id === 'risky-owners').rows;
    assert.ok(risky.length >= 1);
  });

  it('graph endpoints degrade gracefully when Neo4j is not configured', async () => {
    const st = await admin.get('/api/admin/graph/status');
    assert.equal(st.status, 200);
    if (!process.env.NEO4J_URI) {
      assert.equal(st.data.connected, false);
      assert.equal((await admin.post('/api/admin/graph/detect')).status, 503);
      assert.equal((await admin.post('/api/admin/graph/sync')).status, 503);
    }
    assert.ok(st.data.pendingEvents >= 1, 'database changes are waiting in the outbox');
  });

  it('logout clears the session', async () => {
    const c = new Client();
    await c.login('t10@rentguard.test');
    assert.equal((await c.get('/api/tenant/dashboard')).status, 200);
    await c.post('/api/auth/logout');
    assert.equal((await c.get('/api/tenant/dashboard')).status, 401);
  });
});
