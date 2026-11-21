import * as Q from './cypher';
import type { CypherRunner, Db } from './types';

export interface OutboxRow {
  outbox_id: number;
  event_type: string;
  payload: Record<string, any>;
}

// "M.G. Road" and "MG Road" must map to the same address node: drop dots/apostrophes first.
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Normalised address identity: same street address typed differently maps to one node. */
export function addressKey(pincode: string, locality: string, addressLine: string): string {
  return `${pincode}|${norm(locality)}|${norm(addressLine)}`;
}

function monthsBetween(start: string, end: string): number {
  const s = Date.parse(start);
  const e = Math.min(Date.parse(end), Date.now());
  return Math.max(1, Math.floor((e - s) / (30 * 86_400_000)));
}

/** Translates ONE outbox event (a change committed in PostgreSQL) into idempotent Cypher. */
export async function applyEvent(ev: OutboxRow, db: Db, graph: CypherRunner): Promise<void> {
  const p = ev.payload;
  switch (ev.event_type) {
    case 'listing_version.INSERT': {
      const [prop] = await db.query<{ owner_id: number }>('SELECT owner_id FROM property WHERE property_id = $1', [p.property_id]);
      const photos = await db.query<{ sha256: string }>(
        'SELECT sha256 FROM listing_photo WHERE version_id = $1 ORDER BY position',
        [p.version_id],
      );
      await graph.write(Q.UPSERT_LISTING, {
        ownerId: prop.owner_id,
        propertyId: p.property_id,
        city: p.city,
        locality: p.locality,
        phone: p.contact_phone,
        addrKey: addressKey(p.pincode, p.locality, p.address_line),
        photoHashes: photos.map((r) => r.sha256),
        recordedAt: new Date(p.recorded_at).toISOString(),
      });
      return;
    }

    case 'lease.INSERT':
    case 'lease.UPDATE': {
      if (p.status === 'CANCELLED') {
        await graph.write(Q.DELETE_STAY, { leaseId: p.lease_id });
        return;
      }
      if (p.status !== 'ACTIVE' && p.status !== 'ENDED') return; // PENDING leases are not "verified stays" yet
      const [row] = await db.query<{ owner_id: number; id_verified: boolean }>(
        `SELECT pr.owner_id, t.id_verified
           FROM property pr, tenant_profile t
          WHERE pr.property_id = $1 AND t.tenant_id = $2`,
        [p.property_id, p.tenant_id],
      );
      await graph.write(Q.UPSERT_STAY, {
        tenantId: p.tenant_id,
        ownerId: row.owner_id,
        idVerified: row.id_verified,
        leaseId: p.lease_id,
        months: monthsBetween(p.start_date, p.end_date),
      });
      return;
    }

    case 'review.INSERT': {
      const [row] = await db.query<{ owner_id: number }>(
        `SELECT pr.owner_id FROM lease l JOIN property pr USING (property_id) WHERE l.lease_id = $1`,
        [p.lease_id],
      );
      await graph.write(Q.UPSERT_REVIEW, {
        tenantId: p.tenant_id,
        ownerId: row.owner_id,
        leaseId: p.lease_id,
        rating: p.rating,
        at: new Date(p.created_at).toISOString(),
      });
      return;
    }

    default:
      return; // unknown events are acknowledged and ignored
  }
}

/** Account phones are not outbox events; they are upserted on every run (idempotent, cheap). */
export async function syncAccounts(db: Db, graph: CypherRunner): Promise<{ owners: number; tenants: number }> {
  const owners = await db.query<{ id: number; phone: string }>(
    `SELECT user_id AS id, phone FROM app_user WHERE role = 'OWNER' AND is_active`,
  );
  const tenants = await db.query<{ id: number; phone: string; idVerified: boolean }>(
    `SELECT u.user_id AS id, u.phone, t.id_verified AS "idVerified"
       FROM app_user u JOIN tenant_profile t ON t.tenant_id = u.user_id WHERE u.is_active`,
  );
  if (owners.length) await graph.write(Q.UPSERT_OWNER_ACCOUNTS, { rows: owners });
  if (tenants.length) await graph.write(Q.UPSERT_TENANT_ACCOUNTS, { rows: tenants });
  return { owners: owners.length, tenants: tenants.length };
}

export type WithTx = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

/**
 * Transactional-outbox consumer. Each batch runs inside one PostgreSQL transaction
 * with FOR UPDATE SKIP LOCKED, so two workers never process the same event.
 * Delivery is at-least-once; MERGE makes every statement idempotent.
 */
export async function runSync(withTx: WithTx, graph: CypherRunner, batch = 500) {
  let processed = 0;
  const accounts = await withTx((db) => syncAccounts(db, graph));
  for (;;) {
    const n = await withTx(async (db) => {
      const rows = await db.query<OutboxRow>(
        `SELECT outbox_id, event_type, payload
           FROM graph_outbox
          WHERE processed_at IS NULL
          ORDER BY outbox_id
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [batch],
      );
      for (const r of rows) {
        await applyEvent(r, db, graph);
        await db.query('UPDATE graph_outbox SET processed_at = now() WHERE outbox_id = $1', [r.outbox_id]);
      }
      return rows.length;
    });
    processed += n;
    if (n < batch) break;
  }
  return { processed, accounts };
}
