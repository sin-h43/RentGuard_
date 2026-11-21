-- =====================================================================
-- seed.sql  -  demo data for the rental aggregator
-- Run ONCE on an empty database right after 01_listing.sql and 02_workflow.sql:
--     psql -d rent -f 01_listing.sql -f 02_workflow.sql -f seed.sql
-- All demo accounts use the password  Passw0rd!  (stored as bcrypt hashes).
-- Demo OTP for escrow check-ins:  111111
-- =====================================================================
BEGIN;
\o /dev/null

-- ---------- USERS (ids are assigned in this order) ----------
-- 1 admin | 2-9 owners | 10-21 tenants | 22-24 suspicious tenant accounts
INSERT INTO app_user (email, password_hash, role, full_name, phone, phone_verified) VALUES
 ('admin@rentguard.test',  crypt('Passw0rd!', gen_salt('bf', 8)), 'ADMIN',  'Asha Admin',       '9000000001', true),
 ('ramesh@rentguard.test', crypt('Passw0rd!', gen_salt('bf', 8)), 'OWNER',  'Ramesh Iyer',      '9845012301', true),
 ('lakshmi@rentguard.test',crypt('Passw0rd!', gen_salt('bf', 8)), 'OWNER',  'Lakshmi Narayan',  '9845012302', true),
 ('suresh@rentguard.test', crypt('Passw0rd!', gen_salt('bf', 8)), 'OWNER',  'Suresh Gowda',     '9845012303', true),
 ('meena@rentguard.test',  crypt('Passw0rd!', gen_salt('bf', 8)), 'OWNER',  'Meena Pillai',     '9845012304', true),
 ('vikram@rentguard.test', crypt('Passw0rd!', gen_salt('bf', 8)), 'OWNER',  'Vikram Shetty',    '9845099999', true),
 ('anil@rentguard.test',   crypt('Passw0rd!', gen_salt('bf', 8)), 'OWNER',  'Anil Kumar',       '9845099999', true),
 ('pooja@rentguard.test',  crypt('Passw0rd!', gen_salt('bf', 8)), 'OWNER',  'Pooja Menon',      '9845012307', true),
 ('kiran@rentguard.test',  crypt('Passw0rd!', gen_salt('bf', 8)), 'OWNER',  'Kiran Rao',        '9845012308', false),
 ('t10@rentguard.test', crypt('Passw0rd!', gen_salt('bf', 8)), 'TENANT', 'Divya Nair',     '9731000010', true),
 ('t11@rentguard.test', crypt('Passw0rd!', gen_salt('bf', 8)), 'TENANT', 'Arjun Mehta',    '9731000011', true),
 ('t12@rentguard.test', crypt('Passw0rd!', gen_salt('bf', 8)), 'TENANT', 'Sneha Reddy',    '9731000012', true),
 ('t13@rentguard.test', crypt('Passw0rd!', gen_salt('bf', 8)), 'TENANT', 'Rahul Verma',    '9731000013', true),
 ('t14@rentguard.test', crypt('Passw0rd!', gen_salt('bf', 8)), 'TENANT', 'Isha Kapoor',    '9731000014', true),
 ('t15@rentguard.test', crypt('Passw0rd!', gen_salt('bf', 8)), 'TENANT', 'Karthik S',      '9731000015', true),
 ('t16@rentguard.test', crypt('Passw0rd!', gen_salt('bf', 8)), 'TENANT', 'Nisha Joseph',   '9731000016', true),
 ('t17@rentguard.test', crypt('Passw0rd!', gen_salt('bf', 8)), 'TENANT', 'Varun Bhat',     '9731000017', true),
 ('t18@rentguard.test', crypt('Passw0rd!', gen_salt('bf', 8)), 'TENANT', 'Tanvi Shah',     '9731000018', true),
 ('t19@rentguard.test', crypt('Passw0rd!', gen_salt('bf', 8)), 'TENANT', 'Rohan Das',      '9731000019', true),
 ('t20@rentguard.test', crypt('Passw0rd!', gen_salt('bf', 8)), 'TENANT', 'Priya Singh',    '9731000020', true),
 ('t21@rentguard.test', crypt('Passw0rd!', gen_salt('bf', 8)), 'TENANT', 'Manoj Pai',      '9731000021', true),
 ('t22@rentguard.test', crypt('Passw0rd!', gen_salt('bf', 8)), 'TENANT', 'Guest Reviewer A','9845099999', false),
 ('t23@rentguard.test', crypt('Passw0rd!', gen_salt('bf', 8)), 'TENANT', 'Guest Reviewer B','9731000023', false),
 ('t24@rentguard.test', crypt('Passw0rd!', gen_salt('bf', 8)), 'TENANT', 'Guest Reviewer C','9731000024', false);

INSERT INTO owner_profile (owner_id, kyc_verified) VALUES
 (2, true), (3, true), (4, true), (5, true), (6, false), (7, false), (8, true), (9, false);

INSERT INTO tenant_profile (tenant_id, occupation, id_verified) VALUES
 (10,'Software engineer',true), (11,'Consultant',true), (12,'Student',true), (13,'Analyst',true),
 (14,'Designer',true), (15,'Student',true), (16,'Nurse',true), (17,'Engineer',true),
 (18,'Accountant',true), (19,'Student',false), (20,'Marketing',false), (21,'Student',false),
 (22,NULL,false), (23,NULL,false), (24,NULL,false);

-- ---------- PROPERTIES (ids 1..14) ----------
INSERT INTO property (owner_id, property_type) VALUES
 (2,'PG'), (2,'APARTMENT'),          -- 1,2   Ramesh
 (3,'PG'), (3,'ROOM'),               -- 3,4   Lakshmi
 (4,'APARTMENT'), (4,'PG'),          -- 5,6   Suresh
 (5,'STUDIO'), (5,'PG'),             -- 7,8   Meena
 (6,'PG'), (6,'APARTMENT'),          -- 9,10  Vikram  (fraud ring)
 (7,'PG'), (7,'ROOM'),               -- 11,12 Anil    (fraud ring)
 (8,'APARTMENT'),                    -- 13    Pooja
 (9,'PG');                           -- 14    Kiran   (reuses Lakshmi's photo, price switch)

-- ---------- helper: publish first/next version of a listing ----------
-- photo keys become deterministic SHA-256 hashes, so the SAME key on two
-- listings means the SAME image (this is what the graph detects).
CREATE FUNCTION pg_temp.pub(p_prop BIGINT, p_rent NUMERIC, p_dep NUMERIC, p_addr TEXT,
                            p_loc TEXT, p_pin TEXT, p_phone TEXT, p_keys TEXT[],
                            p_effective DATE DEFAULT CURRENT_DATE - 60)
RETURNS BIGINT LANGUAGE sql AS $$
    SELECT sp_publish_listing(
        p_prop,
        (SELECT owner_id FROM property WHERE property_id = p_prop),
        (SELECT initcap(property_type) FROM property WHERE property_id = p_prop) || ' in ' || p_loc,
        p_rent, p_dep, p_addr, p_loc, 'Bengaluru', p_pin::char(6), p_phone,
        '["wifi","water","power backup"]'::jsonb,
        p_effective,
        ARRAY(SELECT 'https://img.rentguard.test/' || k || '.jpg' FROM unnest(p_keys) k),
        ARRAY(SELECT encode(digest('photo-' || k, 'sha256'), 'hex') FROM unnest(p_keys) k)
    )
$$;

-- ---------- LISTINGS (version 1 of each) ----------
SELECT pg_temp.pub( 1,  8000, 16000, '12 MG Road',          'Indiranagar',     '560038', '9845012301', ARRAY['p1-a','p1-b']);
SELECT pg_temp.pub( 2, 24000, 72000, '45 5th Block',        'Koramangala',     '560034', '9845012301', ARRAY['p2-a','p2-b','p2-c']);
SELECT pg_temp.pub( 3,  7500, 15000, '8 27th Main',         'HSR Layout',      '560102', '9845012302', ARRAY['p3-a','p3-b']);
SELECT pg_temp.pub( 4,  6000, 12000, '21 ITPL Road',        'Whitefield',      '560066', '9845012302', ARRAY['p4-a']);
SELECT pg_temp.pub( 5, 18000, 54000, '3 4th Block',         'Jayanagar',       '560041', '9845012303', ARRAY['p5-a','p5-b']);
SELECT pg_temp.pub( 6,  9000, 18000, '77 Hosur Road',       'BTM Layout',      '560076', '9845012303', ARRAY['p6-a','p6-b']);
SELECT pg_temp.pub( 7, 14000, 28000, '9 100 Feet Road',     'Indiranagar',     '560038', '9845012304', ARRAY['p7-a','p7-b']);
SELECT pg_temp.pub( 8,  8500, 17000, '60 80 Feet Road',     'Koramangala',     '560034', '9845012304', ARRAY['p8-a']);
-- fraud ring: two owner accounts, one contact number, recycled photos, different addresses
SELECT pg_temp.pub( 9,  6000, 12000, '14 Varthur Main Road','Marathahalli',    '560037', '9845099999', ARRAY['ring-a','ring-b']);
SELECT pg_temp.pub(10, 12000, 24000, '5 Outer Ring Road',   'Bellandur',       '560103', '9845099999', ARRAY['ring-d']);
SELECT pg_temp.pub(11,  5500, 11000, '31 Kadugodi Road',    'Whitefield',      '560066', '9845099999', ARRAY['ring-a','ring-c']);
SELECT pg_temp.pub(12,  6500, 13000, '2 Hosur Main Road',   'Electronic City', '560100', '9845099999', ARRAY['ring-d','ring-e']);
SELECT pg_temp.pub(13, 22000, 66000, '18 27th Cross',       'HSR Layout',      '560102', '9845012307', ARRAY['p13-a','p13-b']);
-- Kiran lifts Lakshmi's photo 'p3-a' for a listing at another address
SELECT pg_temp.pub(14,  6500, 13000, '40 11th Main',        'Jayanagar',       '560041', '9845012308', ARRAY['p3-a','p14-b']);

-- A normal, small rent revision on property 1 (5%, no inquiry yet) -> must NOT raise a flag
SELECT pg_temp.pub( 1,  8400, 16000, '12 MG Road',          'Indiranagar',     '560038', '9845012301', ARRAY['p1-a','p1-b'], CURRENT_DATE);

-- ---------- INQUIRIES (each pins the version the tenant saw) ----------
INSERT INTO inquiry (tenant_id, property_id, seen_version_id, message)
SELECT x.ten, x.prop, lv.version_id, x.msg
FROM (VALUES
   (19,  5, 'Is the flat still available?'),
   (20,  6, 'Can I visit this weekend?'),
   (21,  7, 'Is the rent negotiable?'),
   (18, 13, 'Interested in a 11 month lease'),
   (19, 14, 'Is the PG near the metro?')
) AS x(ten, prop, msg)
JOIN listing_version lv ON lv.property_id = x.prop AND lv.seq = 1;

-- ---------- ESCROW FLOWS ----------
DO $$
DECLARE
    v_inq BIGINT;
    v_esc BIGINT;
BEGIN
    -- (a) HELD: token paid, visit not done yet
    SELECT inquiry_id INTO v_inq FROM inquiry WHERE tenant_id = 19 AND property_id = 5;
    CALL sp_hold_escrow(v_inq, 1500, '111111', '00000000-0000-4000-8000-000000000001');

    -- (b) REFUNDED: owner never showed up
    SELECT inquiry_id INTO v_inq FROM inquiry WHERE tenant_id = 20 AND property_id = 6;
    CALL sp_hold_escrow(v_inq, 2000, '111111', '00000000-0000-4000-8000-000000000002');
    SELECT escrow_id INTO v_esc FROM escrow WHERE tenant_id = 20;
    CALL sp_refund_escrow(v_esc);

    -- (c) RELEASED: tenant checks in, owner confirms with the OTP -> auto release
    SELECT inquiry_id INTO v_inq FROM inquiry WHERE tenant_id = 18 AND property_id = 13;
    CALL sp_hold_escrow(v_inq, 3000, '111111', '00000000-0000-4000-8000-000000000003');
    SELECT escrow_id INTO v_esc FROM escrow WHERE tenant_id = 18;
    CALL sp_checkin(v_esc, 18);
    CALL sp_checkin(v_esc, 8, '111111');
END $$;


-- ---------- LEASES ----------
INSERT INTO lease (property_id, tenant_id, agreed_version_id, start_date, end_date,
                   monthly_rent, security_deposit, status)
SELECT t.prop, t.ten, lv.version_id, CURRENT_DATE + t.so, CURRENT_DATE + t.so + t.len,
       lv.monthly_rent, lv.security_deposit, t.st::lease_status
FROM (VALUES
   ( 1, 10, -200, 365, 'ACTIVE'),
   ( 2, 11, -150, 365, 'ACTIVE'),
   ( 3, 12, -400, 330, 'ENDED'),
   ( 4, 13, -120, 330, 'ACTIVE'),
   ( 5, 14, -300, 300, 'ENDED'),
   ( 6, 15,  -90, 330, 'ACTIVE'),
   ( 7, 16, -180, 300, 'ACTIVE'),
   ( 8, 17, -240, 200, 'ENDED'),
   (13, 18,  -90, 300, 'ACTIVE'),
   -- Vikram's three "reviewers": short stays, unverified accounts
   ( 9, 22, -400, 100, 'ENDED'),
   ( 9, 24, -290,  90, 'ENDED'),
   (10, 23, -250, 200, 'ENDED')
) AS t(prop, ten, so, len, st)
JOIN listing_version lv ON lv.property_id = t.prop AND lv.seq = 1;

-- ---------- REVIEWS ----------
INSERT INTO review (lease_id, tenant_id, rating, comment)
SELECT l.lease_id, l.tenant_id, r.rating, r.comment
FROM (VALUES
   (10, 5, 'Clean PG, owner is responsive.'),
   (11, 4, 'Good flat, deposit returned on time.'),
   (12, 5, 'Very honest owner, rent never changed.'),
   (13, 4, 'Decent room, a bit noisy road.'),
   (14, 5, 'Smooth move-in and move-out.'),
   (15, 4, 'Food is good, wifi could be faster.'),
   (16, 5, 'Great studio, fair terms.'),
   (17, 4, 'Quiet PG, would recommend.'),
   (18, 3, 'Okay flat, maintenance is slow.'),
   (22, 5, 'Amazing owner! Best PG ever!!!'),
   (23, 5, 'Perfect place, highly recommended!'),
   (24, 5, 'Wonderful stay, 10/10!')
) AS r(ten, rating, comment)
JOIN lease l ON l.tenant_id = r.ten;

-- ---------- COMPLAINTS (third distinct complainant fires the trigger) ----------
INSERT INTO complaint (property_id, filed_by, category, description)
VALUES (11, 19, 'FAKE_LISTING',   'Went to the address, the building does not offer any PG.');
INSERT INTO complaint (property_id, filed_by, category, description)
VALUES (11, 20, 'FAKE_LISTING',   'Owner asked for advance money without showing the room.');
INSERT INTO complaint (property_id, filed_by, category, description)
VALUES (11, 21, 'FAKE_LISTING',   'Photos match a different listing, number is the same.');
INSERT INTO complaint (property_id, filed_by, category, description)
VALUES (14, 19, 'PRICE_CHANGE',   'Rent was raised after I enquired and showed interest.');

-- ---------- BAIT AND SWITCH on property 14 (inquiry exists, now rent jumps) ----------
SELECT pg_temp.pub(14, 9000, 13000, '40 11th Main', 'Jayanagar', '560041', '9845012308',
                   ARRAY['p3-a','p14-b'], CURRENT_DATE);

\o
COMMIT;

-- =====================================================================
-- SANITY CHECKS (expected results in comments)
-- =====================================================================
SELECT flag_type, owner_id, property_id, severity, source FROM fraud_flag ORDER BY flag_id;
-- expect 2 rows: BAIT_AND_SWITCH (property 14, owner 9) and HIGH_COMPLAINTS (owner 7)

SELECT escrow_id, status, amount FROM escrow ORDER BY escrow_id;
-- expect HELD, REFUNDED, RELEASED

SELECT txn_group, sum(amount) FILTER (WHERE direction='D') AS debits,
                  sum(amount) FILTER (WHERE direction='C') AS credits
FROM ledger_entry GROUP BY txn_group;
-- debits = credits on every row

SELECT contact_phone, count(DISTINCT property_id) AS listings
FROM listing_version GROUP BY contact_phone HAVING count(DISTINCT property_id) >= 3;
-- expect 9845099999 with 4 listings (the ring's shared number)

SELECT p.sha256, count(DISTINCT lv.property_id) AS listings
FROM listing_photo p JOIN listing_version lv USING (version_id)
GROUP BY p.sha256 HAVING count(DISTINCT lv.property_id) > 1;
-- expect 3 shared images: ring-a, ring-d, and Lakshmi's p3-a

SELECT * FROM v_owner_risk ORDER BY owner_id;
