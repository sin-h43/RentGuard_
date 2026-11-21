# Viva demo script (about 8 minutes)

Prep: `docker compose up -d`, `npm run db:reset`, `npm run graph:sync`, start the app. Log in with the seeded accounts (`Passw0rd!`).

1. **Problem and twist (30 s).** Fake/bait listings in rentals. Three ideas: tamper-evident history, graph trust, escrowed token.
2. **Tenant (2 min).** Search "wifi pg indiranagar" (full-text, GIN). Open a listing: price history + "Hash chain verified". Enquire, pay token into escrow, note the one-time OTP.
3. **Bait-and-switch (1.5 min).** As owner of property 14 the rent went 6500 -> 9000 after an enquiry: trigger raised a flag. As the tenant open *View evidence*: seen vs as-known-then vs now (bitemporal).
4. **Escrow (1 min).** Tenant checks in, owner enters OTP -> `sp_checkin` releases; the ledger stays balanced (Admin > SQL insights).
5. **Admin graph (2 min).** Graph tab: Sync, Detect (owners 6 & 7 share phone + photos; owner 9 copies a photo), Compute trust. Explain personalised PageRank seeded from verified tenants.
6. **DB internals (1 min).** psql: `UPDATE listing_version ...` is rejected (append-only trigger); `SELECT * FROM fn_verify_listing_chain(<id>)`.
7. **Q&A cheat sheet.** Why Postgres for money (ACID, constraints, triggers)? Why Neo4j for rings (multi-hop shared-attribute traversal)? Why outbox (no dual-write inconsistency; at-least-once + idempotent MERGE)? Why EXCLUDE (no double-booked lease)?

## Suggested contribution split (edit to match reality; commit under your own names)

- Member A: schema, triggers, procedures, views, seed, SQL tests, data dictionary.
- Member B: Next.js UI + API routes, Neo4j sync/detection/trust, e2e tests, screenshots.
- Both: report, README, demo. Make real commits per member in GitHub; this repo has no git history yet (`git init`).
