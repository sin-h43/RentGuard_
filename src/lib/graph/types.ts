/** Minimal interfaces so the graph logic can run against real Neo4j or a test double. */
export interface CypherRunner {
  read(cypher: string, params?: Record<string, unknown>): Promise<Record<string, any>[]>;
  write(cypher: string, params?: Record<string, unknown>): Promise<Record<string, any>[]>;
}

export interface Db {
  query<T = any>(text: string, params?: unknown[]): Promise<T[]>;
}

export type PairRel = 'LISTED_WITH_PHONE' | 'USES_PHOTO' | 'LOCATED_AT' | 'HAS_PHONE';

/** One piece of shared identity between two different owners (found by graph traversal). */
export interface PairRow {
  a: number;
  b: number;
  rel: PairRel;
  ref: string;
  propA?: number;
  propB?: number;
  listedA?: string;
  listedB?: string;
}

export interface StayEdge {
  tenantId: number;
  verified: boolean;
  ownerId: number;
  weight: number;
}

export interface Finding {
  ownerId: number;
  flagType: 'DUPLICATE_PHOTO' | 'SHARED_CONTACT' | 'REVIEW_RING';
  severity: number;
  evidence: Record<string, unknown>;
}

export interface OwnerCluster {
  owners: number[];
  items: { kind: 'phone' | 'photo' | 'address' | 'account phone'; ref: string; owners: number[] }[];
}
