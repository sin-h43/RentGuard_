-- =====================================================================
-- RentGuard / PART 2 of 2: MONEY, WORKFLOW AND ACCESS  (Member B)
-- Load SECOND (needs 01_listing.sql: app_user, property, listing_version).
-- Owns: inquiry, lease (EXCLUDE), escrow + procedures, double-entry ledger,
--       review / complaint / fraud_flag, their triggers, views v_owner_risk
--       and v_escrow_summary, access-control notes and the ALTER/DROP demo.
-- =====================================================================

-- ---------- ENUM TYPES (workflow side) ----------
CREATE TYPE escrow_status    AS ENUM ('HELD', 'RELEASED', 'REFUNDED', 'DISPUTED');
CREATE TYPE lease_status     AS ENUM ('PENDING', 'ACTIVE', 'ENDED', 'CANCELLED');
CREATE TYPE complaint_status AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED');
CREATE TYPE flag_status      AS ENUM ('OPEN', 'CONFIRMED', 'DISMISSED');
CREATE TYPE ledger_account   AS ENUM ('TENANT', 'ESCROW', 'OWNER', 'PLATFORM');

-- ---------- INQUIRY, LEASE, ESCROW, LEDGER ----------
-- An inquiry pins the exact listing version the tenant saw (dispute evidence).
CREATE TABLE inquiry (
    inquiry_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id       BIGINT      NOT NULL REFERENCES tenant_profile (tenant_id),
    property_id     BIGINT      NOT NULL REFERENCES property (property_id),
    seen_version_id BIGINT      NOT NULL,
    message         TEXT,
    -- clock_timestamp() (not now()) so it is on the SAME clock as listing_version.recorded_at,
    -- which makes "what did the database know when the tenant enquired?" correct even inside one transaction
    created_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (seen_version_id, property_id)
        REFERENCES listing_version (version_id, property_id),
    UNIQUE (tenant_id, property_id, seen_version_id)
);

CREATE TABLE lease (
    lease_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    property_id       BIGINT        NOT NULL REFERENCES property (property_id),
    tenant_id         BIGINT        NOT NULL REFERENCES tenant_profile (tenant_id),
    agreed_version_id BIGINT        NOT NULL,
    start_date        DATE          NOT NULL,
    end_date          DATE          NOT NULL,
    monthly_rent      NUMERIC(10,2) NOT NULL CHECK (monthly_rent > 0),
    security_deposit  NUMERIC(10,2) NOT NULL CHECK (security_deposit >= 0),
    status            lease_status  NOT NULL DEFAULT 'PENDING',
    CHECK (end_date > start_date),
    FOREIGN KEY (agreed_version_id, property_id)
        REFERENCES listing_version (version_id, property_id),
    UNIQUE (lease_id, tenant_id),
    -- no two live leases may overlap on the same property
    EXCLUDE USING gist (
        property_id WITH =,
        daterange(start_date, end_date, '[)') WITH &&
    ) WHERE (status IN ('PENDING', 'ACTIVE'))
);

-- Simplified token-money escrow (state machine HELD -> RELEASED | REFUNDED | DISPUTED)
CREATE TABLE escrow (
    escrow_id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    inquiry_id        BIGINT        NOT NULL UNIQUE REFERENCES inquiry (inquiry_id),
    tenant_id         BIGINT        NOT NULL REFERENCES tenant_profile (tenant_id),
    owner_id          BIGINT        NOT NULL REFERENCES owner_profile (owner_id),
    amount            NUMERIC(10,2) NOT NULL CHECK (amount >= 100),
    status            escrow_status NOT NULL DEFAULT 'HELD',
    otp_hash          TEXT          NOT NULL,               -- bcrypt of one-time visit code
    otp_expires_at    TIMESTAMPTZ   NOT NULL,
    tenant_checkin_at TIMESTAMPTZ,
    owner_checkin_at  TIMESTAMPTZ,
    idempotency_key   UUID          NOT NULL UNIQUE,        -- safe retries of the payment call
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    resolved_at       TIMESTAMPTZ,
    -- money can only be released if BOTH parties checked in
    CHECK (status <> 'RELEASED'
           OR (tenant_checkin_at IS NOT NULL AND owner_checkin_at IS NOT NULL)),
    CHECK (status IN ('HELD', 'DISPUTED') OR resolved_at IS NOT NULL)
);

-- Double-entry ledger: for every txn_group, sum(D) must equal sum(C)
CREATE TABLE ledger_entry (
    entry_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    txn_group  UUID           NOT NULL,
    escrow_id  BIGINT         NOT NULL REFERENCES escrow (escrow_id),
    account    ledger_account NOT NULL,
    direction  CHAR(1)        NOT NULL CHECK (direction IN ('D', 'C')),
    amount     NUMERIC(10,2)  NOT NULL CHECK (amount > 0),
    posted_at  TIMESTAMPTZ    NOT NULL DEFAULT now()
);

-- ---------- REVIEWS, COMPLAINTS, FRAUD FLAGS, GRAPH OUTBOX ----------
CREATE TABLE review (
    review_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lease_id   BIGINT      NOT NULL UNIQUE,                 -- one review per lease
    tenant_id  BIGINT      NOT NULL,
    rating     SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment    TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (lease_id, tenant_id) REFERENCES lease (lease_id, tenant_id)
);

CREATE TABLE complaint (
    complaint_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    property_id  BIGINT           NOT NULL REFERENCES property (property_id),
    filed_by     BIGINT           NOT NULL REFERENCES tenant_profile (tenant_id),
    category     TEXT             NOT NULL
                 CHECK (category IN ('FAKE_LISTING','PRICE_CHANGE','DEPOSIT_DISPUTE','HARASSMENT','OTHER')),
    description  TEXT             NOT NULL CHECK (length(description) >= 10),
    status       complaint_status NOT NULL DEFAULT 'OPEN',
    resolved_by  BIGINT           REFERENCES app_user (user_id),
    created_at   TIMESTAMPTZ      NOT NULL DEFAULT now(),
    CHECK (status IN ('OPEN','UNDER_REVIEW') OR resolved_by IS NOT NULL)
);

CREATE TABLE fraud_flag (
    flag_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_id    BIGINT REFERENCES owner_profile (owner_id),
    property_id BIGINT REFERENCES property (property_id),
    flag_type   TEXT NOT NULL CHECK (flag_type IN
                ('BAIT_AND_SWITCH','DUPLICATE_PHOTO','SHARED_CONTACT','REVIEW_RING','HIGH_COMPLAINTS')),
    severity    SMALLINT NOT NULL CHECK (severity BETWEEN 1 AND 5),
    source      TEXT NOT NULL CHECK (source IN ('SQL_TRIGGER','GRAPH')),
    status      flag_status NOT NULL DEFAULT 'OPEN',
    evidence    JSONB NOT NULL DEFAULT '{}'::jsonb,
    reviewed_by BIGINT REFERENCES app_user (user_id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (owner_id IS NOT NULL OR property_id IS NOT NULL),
    CHECK (status = 'OPEN' OR reviewed_by IS NOT NULL)
);

-- ---------- INDEXES (workflow side) ----------
CREATE INDEX idx_inquiry_prop_time     ON inquiry (property_id, created_at DESC);
CREATE INDEX idx_escrow_held           ON escrow (created_at) WHERE status = 'HELD';
CREATE INDEX idx_ledger_group          ON ledger_entry (txn_group);
CREATE INDEX idx_complaint_prop_time   ON complaint (property_id, created_at DESC);
CREATE INDEX idx_flag_open             ON fraud_flag (created_at DESC) WHERE status = 'OPEN';

-- =====================================================================
-- TRIGGERS AND CONSTRAINTS (workflow side)
-- =====================================================================

-- Append-only ledger (function fn_block_mutation is defined in 01_listing.sql)
CREATE TRIGGER trg_ledger_immutable
    BEFORE UPDATE OR DELETE ON ledger_entry
    FOR EACH ROW EXECUTE FUNCTION fn_block_mutation();

-- Trigger: 3+ distinct complainants against one owner in 30 days
CREATE FUNCTION fn_flag_complaints() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_owner BIGINT;
    v_count INT;
BEGIN
    SELECT owner_id INTO v_owner FROM property WHERE property_id = NEW.property_id;

    SELECT count(DISTINCT c.filed_by) INTO v_count
      FROM complaint c JOIN property p USING (property_id)
     WHERE p.owner_id = v_owner
       AND c.created_at > now() - INTERVAL '30 days';

    IF v_count >= 3 AND NOT EXISTS (
        SELECT 1 FROM fraud_flag
         WHERE owner_id = v_owner AND flag_type = 'HIGH_COMPLAINTS' AND status = 'OPEN') THEN
        INSERT INTO fraud_flag (owner_id, flag_type, severity, source, evidence)
        VALUES (v_owner, 'HIGH_COMPLAINTS', 3, 'SQL_TRIGGER',
                jsonb_build_object('distinct_complainants_30d', v_count));
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_flag_complaints
    AFTER INSERT ON complaint
    FOR EACH ROW EXECUTE FUNCTION fn_flag_complaints();

-- Trigger: only genuine tenants (30+ days into a live/ended lease) may review
CREATE FUNCTION fn_review_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    l lease%ROWTYPE;
BEGIN
    SELECT * INTO l FROM lease WHERE lease_id = NEW.lease_id;
    IF l.status NOT IN ('ACTIVE', 'ENDED') OR l.start_date > CURRENT_DATE - 30 THEN
        RAISE EXCEPTION 'review not allowed: lease % has not run for 30 days', NEW.lease_id;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_review_guard
    BEFORE INSERT ON review
    FOR EACH ROW EXECUTE FUNCTION fn_review_guard();

-- Trigger: escrow state machine guard
CREATE FUNCTION fn_escrow_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status <> NEW.status AND NOT (
        (OLD.status = 'HELD'     AND NEW.status IN ('RELEASED', 'REFUNDED', 'DISPUTED')) OR
        (OLD.status = 'DISPUTED' AND NEW.status IN ('RELEASED', 'REFUNDED'))) THEN
        RAISE EXCEPTION 'illegal escrow transition % -> %', OLD.status, NEW.status;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_escrow_transition
    BEFORE UPDATE OF status ON escrow
    FOR EACH ROW EXECUTE FUNCTION fn_escrow_transition();

-- Trigger: deferred double-entry balance check, evaluated at COMMIT
CREATE FUNCTION fn_ledger_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_d NUMERIC;
    v_c NUMERIC;
BEGIN
    SELECT COALESCE(SUM(amount) FILTER (WHERE direction = 'D'), 0),
           COALESCE(SUM(amount) FILTER (WHERE direction = 'C'), 0)
      INTO v_d, v_c
      FROM ledger_entry WHERE txn_group = NEW.txn_group;

    IF v_d <> v_c THEN
        RAISE EXCEPTION 'unbalanced ledger transaction % (debits %, credits %)',
                        NEW.txn_group, v_d, v_c;
    END IF;
    RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_ledger_balanced
    AFTER INSERT ON ledger_entry
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION fn_ledger_balanced();

CREATE TRIGGER trg_outbox_review  AFTER INSERT ON review
    FOR EACH ROW EXECUTE FUNCTION fn_outbox();
CREATE TRIGGER trg_outbox_lease   AFTER INSERT OR UPDATE OF status ON lease
    FOR EACH ROW EXECUTE FUNCTION fn_outbox();

-- =====================================================================
-- ESCROW STORED PROCEDURES (each CALL runs inside the caller's transaction)
-- =====================================================================

-- Tenant pays token money into escrow. Idempotent on p_key.
CREATE PROCEDURE sp_hold_escrow(p_inquiry_id BIGINT, p_amount NUMERIC, p_otp TEXT, p_key UUID)
LANGUAGE plpgsql AS $$
DECLARE
    v_inq   inquiry%ROWTYPE;
    v_owner BIGINT;
    v_rent  NUMERIC;
    v_id    BIGINT;
    v_grp   UUID := gen_random_uuid();
BEGIN
    SELECT * INTO v_inq FROM inquiry WHERE inquiry_id = p_inquiry_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'inquiry % not found', p_inquiry_id; END IF;

    SELECT owner_id INTO v_owner FROM property WHERE property_id = v_inq.property_id;
    SELECT monthly_rent INTO v_rent FROM listing_version WHERE version_id = v_inq.seen_version_id;
    IF p_amount > v_rent THEN
        RAISE EXCEPTION 'token amount % exceeds one month rent %', p_amount, v_rent;
    END IF;

    INSERT INTO escrow (inquiry_id, tenant_id, owner_id, amount, otp_hash, otp_expires_at, idempotency_key)
    VALUES (p_inquiry_id, v_inq.tenant_id, v_owner, p_amount,
            crypt(p_otp, gen_salt('bf')), now() + INTERVAL '72 hours', p_key)
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING escrow_id INTO v_id;

    IF v_id IS NULL THEN
        RETURN;                                   -- replayed request, nothing to do
    END IF;

    INSERT INTO ledger_entry (txn_group, escrow_id, account, direction, amount) VALUES
        (v_grp, v_id, 'ESCROW', 'D', p_amount),
        (v_grp, v_id, 'TENANT', 'C', p_amount);
END $$;

-- Pay owner (minus 2% platform fee). Requires both check-ins (also CHECK-enforced).
CREATE PROCEDURE sp_release_escrow(p_escrow_id BIGINT)
LANGUAGE plpgsql AS $$
DECLARE
    e     escrow%ROWTYPE;
    v_fee NUMERIC(10,2);
    v_grp UUID := gen_random_uuid();
BEGIN
    SELECT * INTO e FROM escrow WHERE escrow_id = p_escrow_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'escrow % not found', p_escrow_id; END IF;

    v_fee := round(e.amount * 0.02, 2);

    UPDATE escrow SET status = 'RELEASED', resolved_at = now() WHERE escrow_id = p_escrow_id;

    INSERT INTO ledger_entry (txn_group, escrow_id, account, direction, amount) VALUES
        (v_grp, p_escrow_id, 'ESCROW',   'C', e.amount),
        (v_grp, p_escrow_id, 'OWNER',    'D', e.amount - v_fee),
        (v_grp, p_escrow_id, 'PLATFORM', 'D', v_fee);
END $$;

-- Return money to tenant (visit window expired, owner no-show, admin decision)
CREATE PROCEDURE sp_refund_escrow(p_escrow_id BIGINT)
LANGUAGE plpgsql AS $$
DECLARE
    e     escrow%ROWTYPE;
    v_grp UUID := gen_random_uuid();
BEGIN
    SELECT * INTO e FROM escrow WHERE escrow_id = p_escrow_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'escrow % not found', p_escrow_id; END IF;

    UPDATE escrow SET status = 'REFUNDED', resolved_at = now() WHERE escrow_id = p_escrow_id;

    INSERT INTO ledger_entry (txn_group, escrow_id, account, direction, amount) VALUES
        (v_grp, p_escrow_id, 'ESCROW', 'C', e.amount),
        (v_grp, p_escrow_id, 'TENANT', 'D', e.amount);
END $$;

-- Check-in: tenant confirms presence; owner enters the tenant's one-time code.
-- When both are done the escrow is released automatically.
CREATE PROCEDURE sp_checkin(p_escrow_id BIGINT, p_user_id BIGINT, p_otp TEXT DEFAULT NULL)
LANGUAGE plpgsql AS $$
DECLARE
    e escrow%ROWTYPE;
BEGIN
    SELECT * INTO e FROM escrow WHERE escrow_id = p_escrow_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'escrow % not found', p_escrow_id; END IF;
    IF e.status <> 'HELD' THEN RAISE EXCEPTION 'escrow is not in HELD state'; END IF;
    IF now() > e.otp_expires_at THEN RAISE EXCEPTION 'visit window expired'; END IF;

    IF p_user_id = e.tenant_id THEN
        UPDATE escrow SET tenant_checkin_at = now() WHERE escrow_id = p_escrow_id;
    ELSIF p_user_id = e.owner_id THEN
        IF p_otp IS NULL OR crypt(p_otp, e.otp_hash) <> e.otp_hash THEN
            RAISE EXCEPTION 'invalid OTP';
        END IF;
        UPDATE escrow SET owner_checkin_at = now() WHERE escrow_id = p_escrow_id;
    ELSE
        RAISE EXCEPTION 'user % is not a party to escrow %', p_user_id, p_escrow_id;
    END IF;

    IF EXISTS (SELECT 1 FROM escrow
                WHERE escrow_id = p_escrow_id
                  AND tenant_checkin_at IS NOT NULL
                  AND owner_checkin_at  IS NOT NULL) THEN
        CALL sp_release_escrow(p_escrow_id);
    END IF;
END $$;

-- =====================================================================
-- VIEWS (workflow side)
-- =====================================================================

-- Admin dashboard: risk summary per owner
CREATE VIEW v_owner_risk AS
SELECT o.owner_id,
       u.full_name,
       o.trust_score,
       o.trust_updated_at,
       (SELECT count(*) FROM fraud_flag f
         WHERE f.owner_id = o.owner_id AND f.status <> 'DISMISSED')            AS active_flags,
       (SELECT count(*) FROM complaint c JOIN property p USING (property_id)
         WHERE p.owner_id = o.owner_id)                                        AS complaints,
       (SELECT round(avg(r.rating), 2)
          FROM review r JOIN lease l USING (lease_id)
          JOIN property p ON p.property_id = l.property_id
         WHERE p.owner_id = o.owner_id)                                        AS avg_rating
FROM owner_profile o
JOIN app_user u ON u.user_id = o.owner_id;

-- Escrow overview with ledger-derived balance per account
CREATE VIEW v_escrow_summary AS
SELECT e.escrow_id, e.status, e.amount, e.tenant_id, e.owner_id,
       e.tenant_checkin_at, e.owner_checkin_at,
       COALESCE(SUM(CASE WHEN l.account = 'ESCROW' AND l.direction = 'D' THEN l.amount
                         WHEN l.account = 'ESCROW' AND l.direction = 'C' THEN -l.amount END), 0)
           AS escrow_balance
FROM escrow e
LEFT JOIN ledger_entry l USING (escrow_id)
GROUP BY e.escrow_id;

-- =====================================================================
-- ACCESS CONTROL (database level)
-- =====================================================================
-- Create the application role with a password from your secrets manager, e.g.:
--   CREATE ROLE app_backend LOGIN PASSWORD :'APP_DB_PASSWORD';
-- then:
--   GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_backend;
--   REVOKE UPDATE, DELETE, TRUNCATE ON listing_version, listing_photo, ledger_entry FROM app_backend;

-- =====================================================================
-- DDL DEMO (ALTER / DROP) - run once to show the evaluator
-- =====================================================================
-- ALTER TABLE property      ADD COLUMN furnishing TEXT CHECK (furnishing IN ('NONE','SEMI','FULL'));
-- ALTER TABLE tenant_profile ADD CONSTRAINT uq_tenant_occ UNIQUE (tenant_id, occupation);
-- ALTER TABLE tenant_profile DROP CONSTRAINT uq_tenant_occ;
-- DROP INDEX IF EXISTS idx_lv_amenities;
-- ALTER TABLE property      DROP COLUMN furnishing;
