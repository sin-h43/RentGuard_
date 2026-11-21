// All Cypher used by the application (plain Neo4j 5, no GDS plugin required).
// Same statements are documented in db/neo4j_model.cypher.

export const CONSTRAINTS = [
  'CREATE CONSTRAINT owner_id IF NOT EXISTS FOR (o:Owner) REQUIRE o.ownerId IS UNIQUE',
  'CREATE CONSTRAINT tenant_id IF NOT EXISTS FOR (t:Tenant) REQUIRE t.tenantId IS UNIQUE',
  'CREATE CONSTRAINT property_id IF NOT EXISTS FOR (p:Property) REQUIRE p.propertyId IS UNIQUE',
  'CREATE CONSTRAINT phone_no IF NOT EXISTS FOR (x:Phone) REQUIRE x.number IS UNIQUE',
  'CREATE CONSTRAINT address_key IF NOT EXISTS FOR (a:Address) REQUIRE a.key IS UNIQUE',
  'CREATE CONSTRAINT photo_hash IF NOT EXISTS FOR (f:Photo) REQUIRE f.sha256 IS UNIQUE',
];

// ---------- sync (idempotent MERGE) ----------
export const UPSERT_LISTING = `
MERGE (o:Owner {ownerId: $ownerId})
MERGE (p:Property {propertyId: $propertyId})
  ON CREATE SET p.listedAt = datetime($recordedAt)
  SET p.city = $city, p.locality = $locality
MERGE (o)-[:OWNS]->(p)
MERGE (ph:Phone {number: $phone})
MERGE (p)-[:LISTED_WITH_PHONE]->(ph)
MERGE (a:Address {key: $addrKey})
MERGE (p)-[:LOCATED_AT]->(a)
WITH p
UNWIND $photoHashes AS h
  MERGE (f:Photo {sha256: h})
  MERGE (p)-[:USES_PHOTO]->(f)`;

export const UPSERT_OWNER_ACCOUNTS = `
UNWIND $rows AS r
MERGE (o:Owner {ownerId: r.id})
MERGE (ph:Phone {number: r.phone})
MERGE (o)-[:HAS_PHONE]->(ph)`;

export const UPSERT_TENANT_ACCOUNTS = `
UNWIND $rows AS r
MERGE (t:Tenant {tenantId: r.id})
  SET t.idVerified = r.idVerified
MERGE (ph:Phone {number: r.phone})
MERGE (t)-[:HAS_PHONE]->(ph)`;

export const UPSERT_STAY = `
MERGE (t:Tenant {tenantId: $tenantId})
  SET t.idVerified = $idVerified
MERGE (o:Owner {ownerId: $ownerId})
MERGE (t)-[s:VERIFIED_STAY {leaseId: $leaseId}]->(o)
  SET s.months = $months, s.weight = toFloat(CASE WHEN $months > 12 THEN 12 ELSE $months END)`;

export const DELETE_STAY = `
MATCH (:Tenant)-[s:VERIFIED_STAY {leaseId: $leaseId}]->(:Owner)
DELETE s`;

export const UPSERT_REVIEW = `
MERGE (t:Tenant {tenantId: $tenantId})
MERGE (o:Owner {ownerId: $ownerId})
MERGE (t)-[r:REVIEWED {leaseId: $leaseId}]->(o)
  SET r.rating = $rating, r.at = datetime($at)`;

// ---------- detection ----------
/** Different owners connected through the same phone, photo or address (2-hop traversal over Property). */
export const SHARED_IDENTITY_PAIRS = `
MATCH (o1:Owner)-[:OWNS]->(p1:Property)-[r1:LISTED_WITH_PHONE|USES_PHOTO|LOCATED_AT]->(x)
      <-[r2:LISTED_WITH_PHONE|USES_PHOTO|LOCATED_AT]-(p2:Property)<-[:OWNS]-(o2:Owner)
WHERE o1.ownerId < o2.ownerId AND type(r1) = type(r2)
RETURN DISTINCT o1.ownerId AS a, o2.ownerId AS b, type(r1) AS rel,
       coalesce(x.number, x.key, x.sha256) AS ref,
       p1.propertyId AS propA, p2.propertyId AS propB,
       toString(p1.listedAt) AS listedA, toString(p2.listedAt) AS listedB`;

/** Different owner ACCOUNTS registered with the same phone number. */
export const SHARED_ACCOUNT_PHONE = `
MATCH (o1:Owner)-[:HAS_PHONE]->(ph:Phone)<-[:HAS_PHONE]-(o2:Owner)
WHERE o1.ownerId < o2.ownerId
RETURN DISTINCT o1.ownerId AS a, o2.ownerId AS b, 'HAS_PHONE' AS rel, ph.number AS ref`;

/** One owner using the same photo for listings at different addresses. */
export const SELF_PHOTO_REUSE = `
MATCH (o:Owner)-[:OWNS]->(p1:Property)-[:USES_PHOTO]->(f:Photo)<-[:USES_PHOTO]-(p2:Property)<-[:OWNS]-(o)
WHERE p1.propertyId < p2.propertyId
MATCH (p1)-[:LOCATED_AT]->(a1:Address), (p2)-[:LOCATED_AT]->(a2:Address)
WHERE a1 <> a2
RETURN DISTINCT o.ownerId AS ownerId, f.sha256 AS ref, p1.propertyId AS propA, p2.propertyId AS propB`;

/** One phone number advertised on 3+ listings spread over 2+ addresses. */
export const PHONE_SPREAD = `
MATCH (o:Owner)-[:OWNS]->(p:Property)-[:LISTED_WITH_PHONE]->(ph:Phone)
MATCH (p)-[:LOCATED_AT]->(a:Address)
WITH ph, collect(DISTINCT o.ownerId) AS owners, count(DISTINCT p) AS listings, count(DISTINCT a) AS addresses
WHERE listings >= 3 AND addresses >= 2
RETURN ph.number AS phone, owners, listings, addresses`;

/** Tenant who stayed with / reviewed an owner while sharing that owner's account phone. */
export const REVIEW_COLLUSION = `
MATCH (t:Tenant)-[:REVIEWED|VERIFIED_STAY]->(o:Owner),
      (t)-[:HAS_PHONE]->(ph:Phone)<-[:HAS_PHONE]-(o)
RETURN DISTINCT t.tenantId AS tenantId, o.ownerId AS ownerId, ph.number AS phone`;

/** Owner whose (3+) reviewers almost all never review anyone else. */
export const REVIEW_FARM = `
MATCH (t:Tenant)-[:REVIEWED]->(o:Owner)
WITH o, t, COUNT { (t)-[:REVIEWED]->() } AS n
WITH o, count(t) AS reviewers, sum(CASE WHEN n = 1 THEN 1 ELSE 0 END) AS singleUse
WHERE reviewers >= 3 AND toFloat(singleUse) / reviewers >= 0.8
RETURN o.ownerId AS ownerId, reviewers, singleUse`;

export const STAY_EDGES = `
MATCH (t:Tenant)-[s:VERIFIED_STAY]->(o:Owner)
RETURN t.tenantId AS tenantId, coalesce(t.idVerified, false) AS verified,
       o.ownerId AS ownerId, coalesce(s.weight, 1.0) AS weight`;

export const GRAPH_COUNTS = `
MATCH (n)
RETURN labels(n)[0] AS label, count(*) AS count
ORDER BY label`;

export const REL_COUNT = `MATCH ()-[r]->() RETURN type(r) AS rel, count(*) AS count ORDER BY rel`;
