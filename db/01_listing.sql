-- =====================================================================
-- RentGuard / PART 1 of 2: LISTING INTEGRITY  (Member A)
-- Load FIRST:  psql -f db/01_listing.sql -f db/02_workflow.sql
-- Owns: users, profiles, property, append-only hash-chained listing_version,
--       listing_photo, bitemporal functions, bait-and-switch trigger,
--       full-text/GIN indexes, transactional outbox, view v_current_listing.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;     -- digest(), crypt(), gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- exclusion constraint on leases

-- ---------- ENUM TYPES (listing side) ----------
CREATE TYPE user_role        AS ENUM ('TENANT', 'OWNER', 'ADMIN');

-- ---------- USERS ----------
CREATE TABLE app_user (
    user_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email          TEXT        NOT NULL UNIQUE
                   CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    password_hash  TEXT        NOT NULL,                    -- bcrypt, never plain text
    role           user_role   NOT NULL,
    full_name      TEXT        NOT NULL CHECK (length(trim(full_name)) > 0),
    phone          TEXT        NOT NULL CHECK (phone ~ '^\+?[0-9]{10,13}$'),
    phone_verified BOOLEAN     NOT NULL DEFAULT FALSE,
    is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, role)                                  -- target for role-pinned FKs
);

-- Role-pinned subtype tables: composite FK + CHECK guarantee that an
-- owner_profile row can only point at a user whose role is OWNER.
CREATE TABLE owner_profile (
    owner_id         BIGINT PRIMARY KEY,
    role             user_role NOT NULL DEFAULT 'OWNER' CHECK (role = 'OWNER'),
    kyc_verified     BOOLEAN   NOT NULL DEFAULT FALSE,
    trust_score      NUMERIC(5,4) NOT NULL DEFAULT 0 CHECK (trust_score BETWEEN 0 AND 1),
    trust_updated_at TIMESTAMPTZ,
    FOREIGN KEY (owner_id, role) REFERENCES app_user (user_id, role) ON DELETE CASCADE
);

CREATE TABLE tenant_profile (
    tenant_id   BIGINT PRIMARY KEY,
    role        user_role NOT NULL DEFAULT 'TENANT' CHECK (role = 'TENANT'),
    occupation  TEXT,
    id_verified BOOLEAN   NOT NULL DEFAULT FALSE,
    FOREIGN KEY (tenant_id, role) REFERENCES app_user (user_id, role) ON DELETE CASCADE
);

-- ---------- PROPERTY + APPEND-ONLY LISTING HISTORY ----------
-- property = stable identity of one rentable unit (flat, PG room, ...)
CREATE TABLE property (
    property_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_id      BIGINT      NOT NULL REFERENCES owner_profile (owner_id),
    property_type TEXT        NOT NULL CHECK (property_type IN ('APARTMENT','PG','ROOM','STUDIO')),
    is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- listing_version = every edit ever made, never updated in place.
--   effective_from = VALID time   (when these terms apply, chosen by owner)
--   recorded_at    = TRANSACTION time (when the DB learned it, set by trigger)
--   prev_hash/row_hash = hash chain per property (tamper evidence)
CREATE TABLE listing_version (
    version_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    property_id      BIGINT        NOT NULL REFERENCES property (property_id),
    seq              INT           NOT NULL,                -- set by trigger
    title            TEXT          NOT NULL CHECK (length(trim(title)) > 0),
    monthly_rent     NUMERIC(10,2) NOT NULL CHECK (monthly_rent > 0),
    security_deposit NUMERIC(10,2) NOT NULL CHECK (security_deposit >= 0),
    address_line     TEXT          NOT NULL,
    locality         TEXT          NOT NULL,
    city             TEXT          NOT NULL,
    pincode          CHAR(6)       NOT NULL CHECK (pincode ~ '^[0-9]{6}$'),
    contact_phone    TEXT          NOT NULL CHECK (contact_phone ~ '^\+?[0-9]{10,13}$'),
    amenities        JSONB         NOT NULL DEFAULT '[]'::jsonb,
    effective_from   DATE          NOT NULL,
    recorded_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),  -- overwritten by trigger
    recorded_by      BIGINT        NOT NULL REFERENCES app_user (user_id),
    photo_digest     TEXT          NOT NULL DEFAULT '',     -- sha256 of sorted photo hashes
    prev_hash        TEXT,
    row_hash         TEXT          NOT NULL,                -- set by trigger
    UNIQUE (property_id, seq),
    UNIQUE (version_id, property_id)                        -- target for composite FKs
);

CREATE TABLE listing_photo (
    photo_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    version_id BIGINT   NOT NULL REFERENCES listing_version (version_id),
    url        TEXT     NOT NULL,
    sha256     CHAR(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    position   SMALLINT NOT NULL DEFAULT 1 CHECK (position > 0),
    UNIQUE (version_id, sha256)
);

-- Transactional outbox: a worker reads unprocessed rows and syncs Neo4j
CREATE TABLE graph_outbox (
    outbox_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type   TEXT        NOT NULL,
    payload      JSONB       NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ
);

-- ---------- INDEXES (listing side) ----------
CREATE INDEX idx_property_owner        ON property (owner_id);
CREATE INDEX idx_lv_property_valid     ON listing_version (property_id, effective_from DESC, seq DESC);
CREATE INDEX idx_lv_recorded           ON listing_version (property_id, recorded_at);
CREATE INDEX idx_lv_contact_phone      ON listing_version (contact_phone);
CREATE INDEX idx_lv_search             ON listing_version USING GIN (
    to_tsvector('english', title || ' ' || locality || ' ' || address_line));   -- full-text search
CREATE INDEX idx_lv_amenities          ON listing_version USING GIN (amenities);
CREATE INDEX idx_photo_sha             ON listing_photo (sha256);                -- photo reuse lookups
CREATE INDEX idx_outbox_pending        ON graph_outbox (outbox_id) WHERE processed_at IS NULL;

-- =====================================================================
-- FUNCTIONS AND TRIGGERS
-- =====================================================================

-- Block UPDATE/DELETE on append-only tables
CREATE FUNCTION fn_block_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% on % is not allowed: table is append-only', TG_OP, TG_TABLE_NAME;
END $$;

CREATE TRIGGER trg_lv_immutable
    BEFORE UPDATE OR DELETE ON listing_version
    FOR EACH ROW EXECUTE FUNCTION fn_block_mutation();
CREATE TRIGGER trg_photo_immutable
    BEFORE UPDATE OR DELETE ON listing_photo
    FOR EACH ROW EXECUTE FUNCTION fn_block_mutation();
-- Canonical hash of one listing_version row (shared by trigger and verifier)
CREATE FUNCTION fn_listing_hash(r listing_version) RETURNS TEXT
LANGUAGE sql STABLE AS $$
    SELECT encode(digest(
        COALESCE(r.prev_hash, 'GENESIS')              || '|' ||
        r.property_id::text                           || '|' ||
        r.seq::text                                   || '|' ||
        r.title                                       || '|' ||
        r.monthly_rent::text                          || '|' ||
        r.security_deposit::text                      || '|' ||
        r.address_line                                || '|' ||
        r.locality                                    || '|' ||
        r.city                                        || '|' ||
        r.pincode                                     || '|' ||
        r.contact_phone                               || '|' ||
        r.amenities::text                             || '|' ||
        to_char(r.effective_from, 'YYYY-MM-DD')       || '|' ||
        to_char(r.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '|' ||
        r.recorded_by::text                           || '|' ||
        r.photo_digest,
        'sha256'), 'hex')
$$;

-- Chain trigger: assigns seq, transaction time, prev_hash, row_hash.
-- Locks the parent property row so concurrent edits are serialised.
CREATE FUNCTION fn_listing_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_last_hash TEXT;
    v_last_seq  INT;
BEGIN
    PERFORM 1 FROM property WHERE property_id = NEW.property_id FOR UPDATE;

    SELECT row_hash, seq INTO v_last_hash, v_last_seq
    FROM listing_version
    WHERE property_id = NEW.property_id
    ORDER BY seq DESC
    LIMIT 1;

    NEW.seq         := COALESCE(v_last_seq, 0) + 1;
    NEW.prev_hash   := v_last_hash;
    NEW.recorded_at := clock_timestamp();
    NEW.row_hash    := fn_listing_hash(NEW);
    RETURN NEW;
END $$;

CREATE TRIGGER trg_listing_chain
    BEFORE INSERT ON listing_version
    FOR EACH ROW EXECUTE FUNCTION fn_listing_chain();

-- Verify a property's chain: returns one row per version with intact = true/false
CREATE FUNCTION fn_verify_listing_chain(p_property BIGINT)
RETURNS TABLE (version_seq INT, intact BOOLEAN)
LANGUAGE sql STABLE AS $$
    SELECT lv.seq,
           (lv.row_hash = fn_listing_hash(lv))
           AND (lv.prev_hash IS NOT DISTINCT FROM
                LAG(lv.row_hash) OVER (ORDER BY lv.seq))
    FROM listing_version lv
    WHERE lv.property_id = p_property
    ORDER BY lv.seq
$$;

-- Bitemporal read: "what did the listing say, as known at p_known_at,
-- for terms effective on p_valid_on?"
CREATE FUNCTION fn_listing_as_of(p_property BIGINT, p_known_at TIMESTAMPTZ, p_valid_on DATE)
RETURNS SETOF listing_version
LANGUAGE sql STABLE AS $$
    SELECT *
    FROM listing_version
    WHERE property_id    = p_property
      AND recorded_at   <= p_known_at
      AND effective_from <= p_valid_on
    ORDER BY effective_from DESC, seq DESC
    LIMIT 1
$$;

-- Publish a new listing version + its photos atomically
CREATE FUNCTION sp_publish_listing(
    p_property BIGINT, p_user BIGINT, p_title TEXT, p_rent NUMERIC, p_deposit NUMERIC,
    p_address TEXT, p_locality TEXT, p_city TEXT, p_pincode CHAR(6), p_phone TEXT,
    p_amenities JSONB, p_effective DATE, p_photo_urls TEXT[], p_photo_hashes TEXT[]
) RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE
    v_id     BIGINT;
    v_digest TEXT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM property WHERE property_id = p_property AND owner_id = p_user) THEN
        RAISE EXCEPTION 'user % does not own property %', p_user, p_property;
    END IF;
    IF COALESCE(array_length(p_photo_urls, 1), 0) <> COALESCE(array_length(p_photo_hashes, 1), 0) THEN
        RAISE EXCEPTION 'photo url/hash arrays differ in length';
    END IF;

    SELECT COALESCE(encode(digest(string_agg(h, ',' ORDER BY h), 'sha256'), 'hex'), '')
      INTO v_digest
      FROM unnest(p_photo_hashes) AS h;

    INSERT INTO listing_version (property_id, title, monthly_rent, security_deposit,
        address_line, locality, city, pincode, contact_phone, amenities,
        effective_from, recorded_by, photo_digest, row_hash)
    VALUES (p_property, p_title, p_rent, p_deposit, p_address, p_locality, p_city,
        p_pincode, p_phone, p_amenities, p_effective, p_user, v_digest, 'pending')
    RETURNING version_id INTO v_id;

    INSERT INTO listing_photo (version_id, url, sha256, position)
    SELECT v_id, t.u, t.h, t.i::smallint
    FROM unnest(p_photo_urls, p_photo_hashes) WITH ORDINALITY AS t(u, h, i);

    RETURN v_id;
END $$;

-- Trigger: bait-and-switch detection (price/deposit jump right after tenant interest)
CREATE FUNCTION fn_flag_bait_switch() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_prev  listing_version%ROWTYPE;
    v_owner BIGINT;
BEGIN
    IF NEW.seq = 1 THEN
        RETURN NEW;
    END IF;

    SELECT * INTO v_prev FROM listing_version
     WHERE property_id = NEW.property_id AND seq = NEW.seq - 1;

    IF (NEW.monthly_rent > v_prev.monthly_rent * 1.15
        OR NEW.security_deposit > v_prev.security_deposit * 1.50)
       AND EXISTS (SELECT 1 FROM inquiry
                    WHERE property_id = NEW.property_id
                      AND created_at > NEW.recorded_at - INTERVAL '14 days') THEN

        SELECT owner_id INTO v_owner FROM property WHERE property_id = NEW.property_id;

        INSERT INTO fraud_flag (owner_id, property_id, flag_type, severity, source, evidence)
        VALUES (v_owner, NEW.property_id, 'BAIT_AND_SWITCH', 4, 'SQL_TRIGGER',
                jsonb_build_object(
                    'old_rent', v_prev.monthly_rent,  'new_rent', NEW.monthly_rent,
                    'old_deposit', v_prev.security_deposit, 'new_deposit', NEW.security_deposit,
                    'version_seq', NEW.seq));
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_flag_bait_switch
    AFTER INSERT ON listing_version
    FOR EACH ROW EXECUTE FUNCTION fn_flag_bait_switch();

-- Trigger: transactional outbox for Neo4j sync (same transaction as the change)
CREATE FUNCTION fn_outbox() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO graph_outbox (event_type, payload)
    VALUES (TG_TABLE_NAME || '.' || TG_OP, to_jsonb(NEW));
    RETURN NEW;
END $$;

CREATE TRIGGER trg_outbox_listing AFTER INSERT ON listing_version
    FOR EACH ROW EXECUTE FUNCTION fn_outbox();
-- =====================================================================
-- VIEWS
-- =====================================================================

-- Current public listing per property (latest version whose terms are in effect)
CREATE VIEW v_current_listing AS
SELECT DISTINCT ON (lv.property_id)
       lv.property_id, p.owner_id, p.property_type,
       lv.version_id, lv.title, lv.monthly_rent, lv.security_deposit,
       lv.locality, lv.city, lv.pincode, lv.contact_phone, lv.amenities,
       lv.effective_from, lv.recorded_at
FROM listing_version lv
JOIN property p ON p.property_id = lv.property_id
WHERE p.is_active AND lv.effective_from <= CURRENT_DATE
ORDER BY lv.property_id, lv.effective_from DESC, lv.seq DESC;
