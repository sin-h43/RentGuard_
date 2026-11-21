# RentGuard - PG/Apartment Rental Aggregator with Fraud-Flagging

PESU DBMS Experiential Learning, Level 3. Hybrid database project: **PostgreSQL 16** (system of record) + **Neo4j 5** (fraud graph), served by a **Next.js 15 (App Router)** app.

What makes it more than CRUD:

1. **Tamper-evident, bitemporal listing history** - every edit is an immutable row linked to the previous one by a SHA-256 hash chain; "what did the tenant see when they enquired?" is a bitemporal query (`fn_listing_as_of`).
2. **Graph trust propagation + ring detection (Neo4j)** - owners sharing phones, photos or addresses across "different" listings are clustered; owner trust is a personalised PageRank seeded only from ID-verified tenants (sybil-resistant).
3. **Escrowed token money** - a tenant's token is held in a double-entry ledger and released to the owner only when both parties check in with a one-time OTP.

Advanced DB features: transactions + stored procedures, triggers (hash chain, append-only, bait-and-switch, complaint threshold, escrow state machine, ledger balance), views, GIN full-text search, partial/composite indexes, EXCLUDE constraint (no overlapping leases), transactional outbox to Neo4j, graph traversal queries.

Roles: **TENANT**, **OWNER**, **ADMIN**. Full write-up in [`docs/REPORT.md`](docs/REPORT.md); viva script in [`docs/DEMO.md`](docs/DEMO.md).

## Setup

Prerequisites: Node 20+, Docker (for Postgres + Neo4j), or your own Postgres 16 / Neo4j 5.

```bash
cp .env.example .env          # then edit: set POSTGRES_PASSWORD, NEO4J_PASSWORD, SESSION_SECRET (>= 32 random chars)
docker compose up -d          # Postgres (schema + seed auto-loaded on first start) and Neo4j
npm install
npm run db:setup              # (re)applies db/01_listing.sql, db/02_workflow.sql and db/seed.sql  - only needed without docker auto-load
npm run graph:sync            # pushes the outbox into Neo4j
npm run build && npm run start   # http://localhost:3000   (or: npm run dev)
```

Generate a secret: `openssl rand -base64 48`. No credentials live in the code; everything comes from `.env` (git-ignored).

Then in the admin console open **Fraud graph (Neo4j)** and press 1. Sync, 2. Detect, 3. Compute trust.

### Demo accounts (all use password `Passw0rd!`, seed data only)

Emails are in `db/seed.sql`. Admin is user 1; owners 2-9 (e.g. the colluding ring owners 6 and 7); tenants 10+. Demo visit OTP for the seeded escrow is `111111`.

## Tests

```bash
npm test             # 32 unit + Cypher-syntax tests (no database needed)
npm run test:e2e     # 23 HTTP end-to-end tests against a running server
```

E2E prerequisites: a **fresh** database (`npm run db:reset`) and a **freshly restarted** server (login/sign-up rate limiting is in memory). Saved output: `docs/test-unit.txt`, `docs/test-e2e.txt`.

## Layout

```
db/            01_listing.sql (Member A), 02_workflow.sql (Member B), seed.sql, neo4j_model.cypher (generated), er_diagram.mmd, architecture.mmd
src/lib/       db, session (JWT cookie), validators (zod), graph/ (Cypher, PageRank, ring detection, outbox sync)
src/app/api/   route handlers, all wrapped by route(roles, handler)
src/app/       pages: /, /listings/[id], /login, /register, /tenant, /owner, /admin
scripts/       graph-sync.ts (outbox -> Neo4j, --watch)
tests/         unit, cypher-syntax, e2e
docs/          REPORT.md, DEMO.md, data-dictionary.md, ER + architecture diagrams, screenshots, test logs
```

## Security notes

bcrypt password hashes; httpOnly JWT cookie; role guard in middleware **and** every route; zod validation in the API **plus** CHECK/FK/EXCLUDE constraints and triggers in the database; parameterised SQL only; upload magic-byte check and content-addressed filenames; security headers in `next.config.mjs`.

## Honest limitations

- The Neo4j integration was developed and tested without a live Neo4j: graph algorithms are unit-tested against a Postgres-backed emulator and all Cypher is syntax-checked with the official parser. Run it once against the Docker Neo4j and take the Graph-tab screenshots yourself.
- Rate limiting is per-process memory; photo reuse is detected by exact hash (perceptual hashing / pgvector is future work).
