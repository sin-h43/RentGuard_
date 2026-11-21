# Work split between the two team members, and how to push it to Git

The database design is split **equally**. Each member owns one SQL file (tables, constraints, triggers, procedures, views) and the API routes and pages that use it. The files meet at three foreign keys (`app_user`, `property`, `listing_version`), so the work is independent.

| | Member A: listing integrity and graph | Member B: money, workflow and access |
|---|---|---|
| SQL file | `db/01_listing.sql` (loaded first) | `db/02_workflow.sql` (loaded second) |
| Tables | `app_user`, `owner_profile`, `tenant_profile`, `property`, `listing_version`, `listing_photo`, `graph_outbox` | `inquiry`, `lease`, `escrow`, `ledger_entry`, `review`, `complaint`, `fraud_flag` |
| Triggers | hash chain, append-only (listing, photo), bait-and-switch, outbox (listing) | append-only ledger, complaint threshold, review guard, escrow state machine, deferred ledger balance, outbox (review, lease) |
| Functions / procedures | `fn_listing_hash`, `fn_verify_listing_chain`, `fn_listing_as_of`, `sp_publish_listing` | `sp_hold_escrow`, `sp_checkin`, `sp_release_escrow`, `sp_refund_escrow` |
| Views, indexes | `v_current_listing`; GIN full-text, GIN amenities, version/time, phone, photo, outbox | `v_owner_risk`, `v_escrow_summary`; held-escrow, ledger, complaint, open-flag, inquiry |
| Other DB features | full-text search, bitemporal reads, transactional outbox | EXCLUDE no-overlap leases, double-entry ledger, idempotent payments |
| Second database | **all of Neo4j**: model, Cypher, ring clustering, PageRank, sync | none (reads flags and trust from SQL) |
| Server code | `src/lib/graph/*`, `neo4j.ts`, `graphApi.ts`, `photos.ts`, `scripts/graph-sync.ts` | `src/lib/{env,db,session,cookies,http,validators,rateLimit,client}`, `src/middleware.ts` |
| API routes | listings, listing detail, photos, owner properties/listings, disputes (evidence), admin graph (4) | auth (4), inquiries, escrow (4), leases, reviews, complaints, tenant/owner dashboards, admin flags/complaints/users/risk/insights |
| Pages / UI | search page, listing detail, owner page, cluster graph | layout, login, register, tenant page, admin page, Nav, shared UI, CSS |
| Tests | `unit.test.ts`, `cypher-syntax.test.ts` | `e2e.test.ts` |
| Docs | ER diagram, data dictionary, DB logic and fraud explainer, project guide | architecture diagram, screenshots, README, demo script, final report |
| Viva topics | normalisation, hash chain, bitemporal time, outbox, graph model, why Neo4j, PageRank | ACID and procedures, deferred trigger, state machine, idempotency, EXCLUDE, RBAC, JWT, validation |

Files that mix both halves are committed once, by one person: `db/seed.sql` and `src/app/owner/page.tsx` (A), `src/app/admin/page.tsx` (B). Both of you should still be able to explain them.

## Pushing to GitHub (each person commits their own work under their own name)

Two scripts in `git-split/` create the commits. They use **your own** git identity, so the history shows who really committed which files. Each commit message says what the commit contains. Neither script touches the other person's files.

1. **Member A** creates an empty repository on GitHub, adds the other member as collaborator, then in the project folder:
```bash
git config user.name "Member A name"
git config user.email "a@example.com"
bash git-split/member_a.sh          # 11 commits
git remote add origin <repo-url>
git push -u origin main
```
2. **Member B** clones, copies the project files into the clone (or runs the script in their own copy after `git pull`), then:
```bash
git clone <repo-url> && cd <repo>
# put the project files (the same folder contents) into this clone, keeping A's .git
git config user.name "Member B name"
git config user.email "b@example.com"
bash git-split/member_b.sh          # 11 commits
git push
```
Delete `git-split/` afterwards (it is a one-off helper and is not part of the repository). Each script checks that your git identity is set and stops with a message if something is missing.

The commits are real only if you really made the changes. Read your half, run it, and be able to explain it; run `npm run build && npm test` before the final push.

## Loading the database now that the schema is two files
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/01_listing.sql -f db/02_workflow.sql -f db/seed.sql
```
`npm run db:setup` and `docker compose up -d` already do this in the right order (01, 02, then the seed).
