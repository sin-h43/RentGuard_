import { deriveFindings, trustScores } from './algorithms';
import * as Q from './cypher';
import type { CypherRunner, Db, Finding, OwnerCluster, PairRow, StayEdge } from './types';

export async function ensureConstraints(graph: CypherRunner) {
  for (const stmt of Q.CONSTRAINTS) await graph.write(stmt);
}

/** Runs the traversal queries in Neo4j and turns the results into per-owner findings. */
export async function detect(graph: CypherRunner): Promise<{ findings: Finding[]; clusters: OwnerCluster[] }> {
  const [shared, accountPhones, selfPhotoReuse, phoneSpread, collusion, reviewFarm] = await Promise.all([
    graph.read(Q.SHARED_IDENTITY_PAIRS),
    graph.read(Q.SHARED_ACCOUNT_PHONE),
    graph.read(Q.SELF_PHOTO_REUSE),
    graph.read(Q.PHONE_SPREAD),
    graph.read(Q.REVIEW_COLLUSION),
    graph.read(Q.REVIEW_FARM),
  ]);
  return deriveFindings({
    pairRows: [...shared, ...accountPhones] as PairRow[],
    selfPhotoReuse: selfPhotoReuse as any,
    phoneSpread: phoneSpread as any,
    collusion: collusion as any,
    reviewFarm: reviewFarm as any,
  });
}

/**
 * Writes findings into fraud_flag (source = 'GRAPH').  One live flag per owner+type:
 * an OPEN flag is refreshed, a CONFIRMED flag is left alone, and a DISMISSED flag
 * suppresses the same finding (the admin already judged it a false positive).
 */
export async function persistFindings(db: Db, findings: Finding[]) {
  let created = 0;
  let refreshed = 0;
  let suppressed = 0;
  for (const f of findings) {
    const [ex] = await db.query<{ flag_id: number; status: string }>(
      `SELECT flag_id, status FROM fraud_flag
        WHERE owner_id = $1 AND flag_type = $2 AND source = 'GRAPH'
        ORDER BY (status = 'DISMISSED'), flag_id DESC
        LIMIT 1`,
      [f.ownerId, f.flagType],
    );
    if (!ex) {
      await db.query(
        `INSERT INTO fraud_flag (owner_id, flag_type, severity, source, evidence)
         VALUES ($1, $2, $3, 'GRAPH', $4::jsonb)`,
        [f.ownerId, f.flagType, f.severity, JSON.stringify(f.evidence)],
      );
      created++;
    } else if (ex.status === 'OPEN') {
      await db.query('UPDATE fraud_flag SET severity = $2, evidence = $3::jsonb WHERE flag_id = $1', [
        ex.flag_id,
        f.severity,
        JSON.stringify(f.evidence),
      ]);
      refreshed++;
    } else {
      suppressed++;
    }
  }
  return { created, refreshed, suppressed };
}

/** Personalised PageRank over verified-stay edges, written back to owner_profile.trust_score. */
export async function computeTrust(graph: CypherRunner, db: Db) {
  const edges = (await graph.read(Q.STAY_EDGES)) as StayEdge[];
  const scores = trustScores(edges);
  const owners = await db.query<{ owner_id: number }>('SELECT owner_id FROM owner_profile');
  for (const o of owners) {
    await db.query('UPDATE owner_profile SET trust_score = $2, trust_updated_at = now() WHERE owner_id = $1', [
      o.owner_id,
      Number((scores.get(o.owner_id) ?? 0).toFixed(4)),
    ]);
  }
  return owners.map((o) => ({ ownerId: o.owner_id, trust: Number((scores.get(o.owner_id) ?? 0).toFixed(4)) }));
}
