# Data dictionary

Generated from the live PostgreSQL schema (`information_schema`, `pg_constraint`, `pg_indexes`, `pg_trigger`). 14 tables.

## `app_user`

| Column | Type | Null? | Default |
|---|---|---|---|
| `user_id` | bigint | no |  |
| `email` | text | no |  |
| `password_hash` | text | no |  |
| `role` | user_role | no |  |
| `full_name` | text | no |  |
| `phone` | text | no |  |
| `phone_verified` | boolean | no | `false` |
| `is_active` | boolean | no | `true` |
| `created_at` | timestamp with time zone | no | `now()` |

**Constraints**

- CHECK `app_user_email_check`: `CHECK ((email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'::text))`
- CHECK `app_user_full_name_check`: `CHECK ((length(TRIM(BOTH FROM full_name)) > 0))`
- CHECK `app_user_phone_check`: `CHECK ((phone ~ '^\+?[0-9]{10,13}$'::text))`
- PRIMARY KEY `app_user_pkey`: `PRIMARY KEY (user_id)`
- UNIQUE `app_user_email_key`: `UNIQUE (email)`
- UNIQUE `app_user_user_id_role_key`: `UNIQUE (user_id, role)`

**Indexes**

- `app_user_email_key`: `CREATE UNIQUE INDEX app_user_email_key ON public.app_user USING btree (email)`
- `app_user_user_id_role_key`: `CREATE UNIQUE INDEX app_user_user_id_role_key ON public.app_user USING btree (user_id, role)`

## `complaint`

| Column | Type | Null? | Default |
|---|---|---|---|
| `complaint_id` | bigint | no |  |
| `property_id` | bigint | no |  |
| `filed_by` | bigint | no |  |
| `category` | text | no |  |
| `description` | text | no |  |
| `status` | complaint_status | no | `'OPEN'::complaint_status` |
| `resolved_by` | bigint | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |

**Constraints**

- CHECK `complaint_category_check`: `CHECK ((category = ANY (ARRAY['FAKE_LISTING'::text, 'PRICE_CHANGE'::text, 'DEPOSIT_DISPUTE'::text, 'HARASSMENT'::text, 'OTHER'::text])))`
- CHECK `complaint_check`: `CHECK (((status = ANY (ARRAY['OPEN'::complaint_status, 'UNDER_REVIEW'::complaint_status])) OR (resolved_by IS NOT NULL)))`
- CHECK `complaint_description_check`: `CHECK ((length(description) >= 10))`
- FOREIGN KEY `complaint_filed_by_fkey`: `FOREIGN KEY (filed_by) REFERENCES tenant_profile(tenant_id)`
- FOREIGN KEY `complaint_property_id_fkey`: `FOREIGN KEY (property_id) REFERENCES property(property_id)`
- FOREIGN KEY `complaint_resolved_by_fkey`: `FOREIGN KEY (resolved_by) REFERENCES app_user(user_id)`
- PRIMARY KEY `complaint_pkey`: `PRIMARY KEY (complaint_id)`

**Indexes**

- `idx_complaint_prop_time`: `CREATE INDEX idx_complaint_prop_time ON public.complaint USING btree (property_id, created_at DESC)`

**Triggers**

- `trg_flag_complaints`

## `escrow`

| Column | Type | Null? | Default |
|---|---|---|---|
| `escrow_id` | bigint | no |  |
| `inquiry_id` | bigint | no |  |
| `tenant_id` | bigint | no |  |
| `owner_id` | bigint | no |  |
| `amount` | numeric | no |  |
| `status` | escrow_status | no | `'HELD'::escrow_status` |
| `otp_hash` | text | no |  |
| `otp_expires_at` | timestamp with time zone | no |  |
| `tenant_checkin_at` | timestamp with time zone | yes |  |
| `owner_checkin_at` | timestamp with time zone | yes |  |
| `idempotency_key` | uuid | no |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `resolved_at` | timestamp with time zone | yes |  |

**Constraints**

- CHECK `escrow_amount_check`: `CHECK ((amount >= (100)::numeric))`
- CHECK `escrow_check`: `CHECK (((status <> 'RELEASED'::escrow_status) OR ((tenant_checkin_at IS NOT NULL) AND (owner_checkin_at IS NOT NULL))))`
- CHECK `escrow_check1`: `CHECK (((status = ANY (ARRAY['HELD'::escrow_status, 'DISPUTED'::escrow_status])) OR (resolved_at IS NOT NULL)))`
- FOREIGN KEY `escrow_inquiry_id_fkey`: `FOREIGN KEY (inquiry_id) REFERENCES inquiry(inquiry_id)`
- FOREIGN KEY `escrow_owner_id_fkey`: `FOREIGN KEY (owner_id) REFERENCES owner_profile(owner_id)`
- FOREIGN KEY `escrow_tenant_id_fkey`: `FOREIGN KEY (tenant_id) REFERENCES tenant_profile(tenant_id)`
- PRIMARY KEY `escrow_pkey`: `PRIMARY KEY (escrow_id)`
- UNIQUE `escrow_idempotency_key_key`: `UNIQUE (idempotency_key)`
- UNIQUE `escrow_inquiry_id_key`: `UNIQUE (inquiry_id)`

**Indexes**

- `escrow_idempotency_key_key`: `CREATE UNIQUE INDEX escrow_idempotency_key_key ON public.escrow USING btree (idempotency_key)`
- `escrow_inquiry_id_key`: `CREATE UNIQUE INDEX escrow_inquiry_id_key ON public.escrow USING btree (inquiry_id)`
- `idx_escrow_held`: `CREATE INDEX idx_escrow_held ON public.escrow USING btree (created_at) WHERE (status = 'HELD'::escrow_status)`

**Triggers**

- `trg_escrow_transition`

## `fraud_flag`

| Column | Type | Null? | Default |
|---|---|---|---|
| `flag_id` | bigint | no |  |
| `owner_id` | bigint | yes |  |
| `property_id` | bigint | yes |  |
| `flag_type` | text | no |  |
| `severity` | smallint | no |  |
| `source` | text | no |  |
| `status` | flag_status | no | `'OPEN'::flag_status` |
| `evidence` | jsonb | no | `'{}'::jsonb` |
| `reviewed_by` | bigint | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |

**Constraints**

- CHECK `fraud_flag_check`: `CHECK (((owner_id IS NOT NULL) OR (property_id IS NOT NULL)))`
- CHECK `fraud_flag_check1`: `CHECK (((status = 'OPEN'::flag_status) OR (reviewed_by IS NOT NULL)))`
- CHECK `fraud_flag_flag_type_check`: `CHECK ((flag_type = ANY (ARRAY['BAIT_AND_SWITCH'::text, 'DUPLICATE_PHOTO'::text, 'SHARED_CONTACT'::text, 'REVIEW_RING'::text, 'HIGH_COMPLAINTS'::text])))`
- CHECK `fraud_flag_severity_check`: `CHECK (((severity >= 1) AND (severity <= 5)))`
- CHECK `fraud_flag_source_check`: `CHECK ((source = ANY (ARRAY['SQL_TRIGGER'::text, 'GRAPH'::text])))`
- FOREIGN KEY `fraud_flag_owner_id_fkey`: `FOREIGN KEY (owner_id) REFERENCES owner_profile(owner_id)`
- FOREIGN KEY `fraud_flag_property_id_fkey`: `FOREIGN KEY (property_id) REFERENCES property(property_id)`
- FOREIGN KEY `fraud_flag_reviewed_by_fkey`: `FOREIGN KEY (reviewed_by) REFERENCES app_user(user_id)`
- PRIMARY KEY `fraud_flag_pkey`: `PRIMARY KEY (flag_id)`

**Indexes**

- `idx_flag_open`: `CREATE INDEX idx_flag_open ON public.fraud_flag USING btree (created_at DESC) WHERE (status = 'OPEN'::flag_status)`

## `graph_outbox`

| Column | Type | Null? | Default |
|---|---|---|---|
| `outbox_id` | bigint | no |  |
| `event_type` | text | no |  |
| `payload` | jsonb | no |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `processed_at` | timestamp with time zone | yes |  |

**Constraints**

- PRIMARY KEY `graph_outbox_pkey`: `PRIMARY KEY (outbox_id)`

**Indexes**

- `idx_outbox_pending`: `CREATE INDEX idx_outbox_pending ON public.graph_outbox USING btree (outbox_id) WHERE (processed_at IS NULL)`

## `inquiry`

| Column | Type | Null? | Default |
|---|---|---|---|
| `inquiry_id` | bigint | no |  |
| `tenant_id` | bigint | no |  |
| `property_id` | bigint | no |  |
| `seen_version_id` | bigint | no |  |
| `message` | text | yes |  |
| `created_at` | timestamp with time zone | no | `clock_timestamp()` |

**Constraints**

- FOREIGN KEY `inquiry_property_id_fkey`: `FOREIGN KEY (property_id) REFERENCES property(property_id)`
- FOREIGN KEY `inquiry_seen_version_id_property_id_fkey`: `FOREIGN KEY (seen_version_id, property_id) REFERENCES listing_version(version_id, property_id)`
- FOREIGN KEY `inquiry_tenant_id_fkey`: `FOREIGN KEY (tenant_id) REFERENCES tenant_profile(tenant_id)`
- PRIMARY KEY `inquiry_pkey`: `PRIMARY KEY (inquiry_id)`
- UNIQUE `inquiry_tenant_id_property_id_seen_version_id_key`: `UNIQUE (tenant_id, property_id, seen_version_id)`

**Indexes**

- `idx_inquiry_prop_time`: `CREATE INDEX idx_inquiry_prop_time ON public.inquiry USING btree (property_id, created_at DESC)`
- `inquiry_tenant_id_property_id_seen_version_id_key`: `CREATE UNIQUE INDEX inquiry_tenant_id_property_id_seen_version_id_key ON public.inquiry USING btree (tenant_id, property_id, seen_version_id)`

## `lease`

| Column | Type | Null? | Default |
|---|---|---|---|
| `lease_id` | bigint | no |  |
| `property_id` | bigint | no |  |
| `tenant_id` | bigint | no |  |
| `agreed_version_id` | bigint | no |  |
| `start_date` | date | no |  |
| `end_date` | date | no |  |
| `monthly_rent` | numeric | no |  |
| `security_deposit` | numeric | no |  |
| `status` | lease_status | no | `'PENDING'::lease_status` |

**Constraints**

- CHECK `lease_check`: `CHECK ((end_date > start_date))`
- CHECK `lease_monthly_rent_check`: `CHECK ((monthly_rent > (0)::numeric))`
- CHECK `lease_security_deposit_check`: `CHECK ((security_deposit >= (0)::numeric))`
- FOREIGN KEY `lease_agreed_version_id_property_id_fkey`: `FOREIGN KEY (agreed_version_id, property_id) REFERENCES listing_version(version_id, property_id)`
- FOREIGN KEY `lease_property_id_fkey`: `FOREIGN KEY (property_id) REFERENCES property(property_id)`
- FOREIGN KEY `lease_tenant_id_fkey`: `FOREIGN KEY (tenant_id) REFERENCES tenant_profile(tenant_id)`
- PRIMARY KEY `lease_pkey`: `PRIMARY KEY (lease_id)`
- UNIQUE `lease_lease_id_tenant_id_key`: `UNIQUE (lease_id, tenant_id)`
- EXCLUDE `lease_property_id_daterange_excl`: `EXCLUDE USING gist (property_id WITH =, daterange(start_date, end_date, '[)'::text) WITH &&) WHERE ((status = ANY (ARRAY['PENDING'::lease_status, 'ACTIVE'::lease_status])))`

**Indexes**

- `lease_lease_id_tenant_id_key`: `CREATE UNIQUE INDEX lease_lease_id_tenant_id_key ON public.lease USING btree (lease_id, tenant_id)`
- `lease_property_id_daterange_excl`: `CREATE INDEX lease_property_id_daterange_excl ON public.lease USING gist (property_id, daterange(start_date, end_date, '[)'::text)) WHERE (status = ANY (ARRAY['PENDING'::lease_status, 'ACTIVE'::lease_status]))`

**Triggers**

- `trg_outbox_lease`

## `ledger_entry`

| Column | Type | Null? | Default |
|---|---|---|---|
| `entry_id` | bigint | no |  |
| `txn_group` | uuid | no |  |
| `escrow_id` | bigint | no |  |
| `account` | ledger_account | no |  |
| `direction` | character(1) | no |  |
| `amount` | numeric | no |  |
| `posted_at` | timestamp with time zone | no | `now()` |

**Constraints**

- CHECK `ledger_entry_amount_check`: `CHECK ((amount > (0)::numeric))`
- CHECK `ledger_entry_direction_check`: `CHECK ((direction = ANY (ARRAY['D'::bpchar, 'C'::bpchar])))`
- FOREIGN KEY `ledger_entry_escrow_id_fkey`: `FOREIGN KEY (escrow_id) REFERENCES escrow(escrow_id)`
- PRIMARY KEY `ledger_entry_pkey`: `PRIMARY KEY (entry_id)`
- t `trg_ledger_balanced`: `TRIGGER DEFERRABLE INITIALLY DEFERRED`

**Indexes**

- `idx_ledger_group`: `CREATE INDEX idx_ledger_group ON public.ledger_entry USING btree (txn_group)`

**Triggers**

- `trg_ledger_balanced`
- `trg_ledger_immutable`

## `listing_photo`

| Column | Type | Null? | Default |
|---|---|---|---|
| `photo_id` | bigint | no |  |
| `version_id` | bigint | no |  |
| `url` | text | no |  |
| `sha256` | character(64) | no |  |
| `position` | smallint | no | `1` |

**Constraints**

- CHECK `listing_photo_position_check`: `CHECK (("position" > 0))`
- CHECK `listing_photo_sha256_check`: `CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text))`
- FOREIGN KEY `listing_photo_version_id_fkey`: `FOREIGN KEY (version_id) REFERENCES listing_version(version_id)`
- PRIMARY KEY `listing_photo_pkey`: `PRIMARY KEY (photo_id)`
- UNIQUE `listing_photo_version_id_sha256_key`: `UNIQUE (version_id, sha256)`

**Indexes**

- `idx_photo_sha`: `CREATE INDEX idx_photo_sha ON public.listing_photo USING btree (sha256)`
- `listing_photo_version_id_sha256_key`: `CREATE UNIQUE INDEX listing_photo_version_id_sha256_key ON public.listing_photo USING btree (version_id, sha256)`

**Triggers**

- `trg_photo_immutable`

## `listing_version`

| Column | Type | Null? | Default |
|---|---|---|---|
| `version_id` | bigint | no |  |
| `property_id` | bigint | no |  |
| `seq` | integer | no |  |
| `title` | text | no |  |
| `monthly_rent` | numeric | no |  |
| `security_deposit` | numeric | no |  |
| `address_line` | text | no |  |
| `locality` | text | no |  |
| `city` | text | no |  |
| `pincode` | character(6) | no |  |
| `contact_phone` | text | no |  |
| `amenities` | jsonb | no | `'[]'::jsonb` |
| `effective_from` | date | no |  |
| `recorded_at` | timestamp with time zone | no | `now()` |
| `recorded_by` | bigint | no |  |
| `photo_digest` | text | no | `''::text` |
| `prev_hash` | text | yes |  |
| `row_hash` | text | no |  |

**Constraints**

- CHECK `listing_version_contact_phone_check`: `CHECK ((contact_phone ~ '^\+?[0-9]{10,13}$'::text))`
- CHECK `listing_version_monthly_rent_check`: `CHECK ((monthly_rent > (0)::numeric))`
- CHECK `listing_version_pincode_check`: `CHECK ((pincode ~ '^[0-9]{6}$'::text))`
- CHECK `listing_version_security_deposit_check`: `CHECK ((security_deposit >= (0)::numeric))`
- CHECK `listing_version_title_check`: `CHECK ((length(TRIM(BOTH FROM title)) > 0))`
- FOREIGN KEY `listing_version_property_id_fkey`: `FOREIGN KEY (property_id) REFERENCES property(property_id)`
- FOREIGN KEY `listing_version_recorded_by_fkey`: `FOREIGN KEY (recorded_by) REFERENCES app_user(user_id)`
- PRIMARY KEY `listing_version_pkey`: `PRIMARY KEY (version_id)`
- UNIQUE `listing_version_property_id_seq_key`: `UNIQUE (property_id, seq)`
- UNIQUE `listing_version_version_id_property_id_key`: `UNIQUE (version_id, property_id)`

**Indexes**

- `idx_lv_amenities`: `CREATE INDEX idx_lv_amenities ON public.listing_version USING gin (amenities)`
- `idx_lv_contact_phone`: `CREATE INDEX idx_lv_contact_phone ON public.listing_version USING btree (contact_phone)`
- `idx_lv_property_valid`: `CREATE INDEX idx_lv_property_valid ON public.listing_version USING btree (property_id, effective_from DESC, seq DESC)`
- `idx_lv_recorded`: `CREATE INDEX idx_lv_recorded ON public.listing_version USING btree (property_id, recorded_at)`
- `idx_lv_search`: `CREATE INDEX idx_lv_search ON public.listing_version USING gin (to_tsvector('english'::regconfig, ((((title \|\| ' '::text) \|\| locality) \|\| ' '::text) \|\| address_line)))`
- `listing_version_property_id_seq_key`: `CREATE UNIQUE INDEX listing_version_property_id_seq_key ON public.listing_version USING btree (property_id, seq)`
- `listing_version_version_id_property_id_key`: `CREATE UNIQUE INDEX listing_version_version_id_property_id_key ON public.listing_version USING btree (version_id, property_id)`

**Triggers**

- `trg_flag_bait_switch`
- `trg_listing_chain`
- `trg_lv_immutable`
- `trg_outbox_listing`

## `owner_profile`

| Column | Type | Null? | Default |
|---|---|---|---|
| `owner_id` | bigint | no |  |
| `role` | user_role | no | `'OWNER'::user_role` |
| `kyc_verified` | boolean | no | `false` |
| `trust_score` | numeric | no | `0` |
| `trust_updated_at` | timestamp with time zone | yes |  |

**Constraints**

- CHECK `owner_profile_role_check`: `CHECK ((role = 'OWNER'::user_role))`
- CHECK `owner_profile_trust_score_check`: `CHECK (((trust_score >= (0)::numeric) AND (trust_score <= (1)::numeric)))`
- FOREIGN KEY `owner_profile_owner_id_role_fkey`: `FOREIGN KEY (owner_id, role) REFERENCES app_user(user_id, role) ON DELETE CASCADE`
- PRIMARY KEY `owner_profile_pkey`: `PRIMARY KEY (owner_id)`

## `property`

| Column | Type | Null? | Default |
|---|---|---|---|
| `property_id` | bigint | no |  |
| `owner_id` | bigint | no |  |
| `property_type` | text | no |  |
| `is_active` | boolean | no | `true` |
| `created_at` | timestamp with time zone | no | `now()` |

**Constraints**

- CHECK `property_property_type_check`: `CHECK ((property_type = ANY (ARRAY['APARTMENT'::text, 'PG'::text, 'ROOM'::text, 'STUDIO'::text])))`
- FOREIGN KEY `property_owner_id_fkey`: `FOREIGN KEY (owner_id) REFERENCES owner_profile(owner_id)`
- PRIMARY KEY `property_pkey`: `PRIMARY KEY (property_id)`

**Indexes**

- `idx_property_owner`: `CREATE INDEX idx_property_owner ON public.property USING btree (owner_id)`

## `review`

| Column | Type | Null? | Default |
|---|---|---|---|
| `review_id` | bigint | no |  |
| `lease_id` | bigint | no |  |
| `tenant_id` | bigint | no |  |
| `rating` | smallint | no |  |
| `comment` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |

**Constraints**

- CHECK `review_rating_check`: `CHECK (((rating >= 1) AND (rating <= 5)))`
- FOREIGN KEY `review_lease_id_tenant_id_fkey`: `FOREIGN KEY (lease_id, tenant_id) REFERENCES lease(lease_id, tenant_id)`
- PRIMARY KEY `review_pkey`: `PRIMARY KEY (review_id)`
- UNIQUE `review_lease_id_key`: `UNIQUE (lease_id)`

**Indexes**

- `review_lease_id_key`: `CREATE UNIQUE INDEX review_lease_id_key ON public.review USING btree (lease_id)`

**Triggers**

- `trg_outbox_review`
- `trg_review_guard`

## `tenant_profile`

| Column | Type | Null? | Default |
|---|---|---|---|
| `tenant_id` | bigint | no |  |
| `role` | user_role | no | `'TENANT'::user_role` |
| `occupation` | text | yes |  |
| `id_verified` | boolean | no | `false` |

**Constraints**

- CHECK `tenant_profile_role_check`: `CHECK ((role = 'TENANT'::user_role))`
- FOREIGN KEY `tenant_profile_tenant_id_role_fkey`: `FOREIGN KEY (tenant_id, role) REFERENCES app_user(user_id, role) ON DELETE CASCADE`
- PRIMARY KEY `tenant_profile_pkey`: `PRIMARY KEY (tenant_id)`

## Views

- `v_current_listing`
- `v_escrow_summary`
- `v_owner_risk`

## Stored procedures and functions

- `fn_block_mutation` (function)
- `fn_escrow_transition` (function)
- `fn_flag_bait_switch` (function)
- `fn_flag_complaints` (function)
- `fn_ledger_balanced` (function)
- `fn_listing_as_of` (function)
- `fn_listing_chain` (function)
- `fn_listing_hash` (function)
- `fn_outbox` (function)
- `fn_review_guard` (function)
- `fn_verify_listing_chain` (function)
- `sp_publish_listing` (function)
- `sp_checkin` (procedure)
- `sp_hold_escrow` (procedure)
- `sp_refund_escrow` (procedure)
- `sp_release_escrow` (procedure)
