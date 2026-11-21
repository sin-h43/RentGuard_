import { query } from '@/lib/db';
import { route } from '@/lib/http';

// Analytical queries that demonstrate JOIN / GROUP BY / HAVING / subquery / window functions / views.
// The SQL text is returned with the rows so the UI can show it during the demo.
const QUERIES = [
  {
    id: 'avg-rent-by-locality',
    title: 'Average rent by locality (GROUP BY + aggregates on a view)',
    sql: `SELECT locality, city, count(*)::int AS listings,
       round(avg(monthly_rent))::int AS avg_rent, min(monthly_rent) AS min_rent, max(monthly_rent) AS max_rent
  FROM v_current_listing
 GROUP BY locality, city
 ORDER BY avg_rent DESC`,
  },
  {
    id: 'above-locality-average',
    title: 'Listings priced above their locality average (correlated subquery)',
    sql: `SELECT c.property_id, c.title, c.locality, c.monthly_rent,
       (SELECT round(avg(x.monthly_rent))::int FROM v_current_listing x WHERE x.locality = c.locality) AS locality_avg
  FROM v_current_listing c
 WHERE c.monthly_rent > (SELECT avg(x.monthly_rent) FROM v_current_listing x WHERE x.locality = c.locality)
 ORDER BY c.monthly_rent DESC`,
  },
  {
    id: 'risky-owners',
    title: 'Owners with open flags or complaints (multi-table JOIN + HAVING)',
    sql: `SELECT u.full_name AS owner,
       count(DISTINCT f.flag_id)::int AS open_flags,
       count(DISTINCT c.complaint_id)::int AS complaints
  FROM owner_profile o
  JOIN app_user u ON u.user_id = o.owner_id
  LEFT JOIN fraud_flag f ON f.owner_id = o.owner_id AND f.status = 'OPEN'
  LEFT JOIN property p ON p.owner_id = o.owner_id
  LEFT JOIN complaint c ON c.property_id = p.property_id
 GROUP BY u.full_name
HAVING count(DISTINCT f.flag_id) + count(DISTINCT c.complaint_id) > 0
 ORDER BY open_flags DESC, complaints DESC`,
  },
  {
    id: 'rent-changes',
    title: 'Every rent change with the previous value (window function LAG)',
    sql: `SELECT property_id, seq, prev_rent, monthly_rent AS new_rent,
       round((monthly_rent - prev_rent) / prev_rent * 100, 1) AS pct_change, recorded_at
  FROM (SELECT property_id, seq, monthly_rent, recorded_at,
               LAG(monthly_rent) OVER (PARTITION BY property_id ORDER BY seq) AS prev_rent
          FROM listing_version) v
 WHERE prev_rent IS NOT NULL AND monthly_rent <> prev_rent
 ORDER BY recorded_at DESC`,
  },
  {
    id: 'escrow-money',
    title: 'Escrow money by status (GROUP BY)',
    sql: `SELECT status, count(*)::int AS escrows, sum(amount) AS total_amount
  FROM escrow GROUP BY status ORDER BY status`,
  },
  {
    id: 'ledger-balance',
    title: 'Ledger: balance per account (double-entry check, debits - credits)',
    sql: `SELECT account,
       sum(CASE WHEN direction = 'D' THEN amount ELSE 0 END) AS debits,
       sum(CASE WHEN direction = 'C' THEN amount ELSE 0 END) AS credits,
       sum(CASE WHEN direction = 'D' THEN amount ELSE -amount END) AS net
  FROM ledger_entry GROUP BY account ORDER BY account`,
  },
];

export const GET = route(['ADMIN'], async () => {
  const results = [];
  for (const q of QUERIES) results.push({ id: q.id, title: q.title, sql: q.sql, rows: await query(q.sql) });
  return { results };
});
