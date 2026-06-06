-- ══════════════════════════════════════════════════════
-- BATCH 3/3 — Views + Seed data + RPC Functions (Sections 9–12)
-- รันหลัง batch 2 สำเร็จแล้วเท่านั้น
-- ══════════════════════════════════════════════════════

-- DROP views/functions ที่อาจมีอยู่แล้ว
DROP VIEW     IF EXISTS v_dashboard_summary, v_village_usage, v_member_bill_latest, v_top_debtors, v_anomaly_readings CASCADE;
DROP FUNCTION IF EXISTS calc_water_charge(NUMERIC, TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_member_bills(BIGINT)         CASCADE;

-- SECTION 9 — VIEWS

CREATE OR REPLACE VIEW v_dashboard_summary AS
SELECT
  COUNT(DISTINCT m.id)                                              AS total_members,
  COUNT(DISTINCT m.id) FILTER (WHERE m.status = 'normal')          AS normal_members,
  COUNT(DISTINCT m.id) FILTER (WHERE m.status = 'overdue')         AS overdue_members,
  COUNT(b.id)                                                       AS total_bills,
  COUNT(b.id) FILTER (WHERE b.status = 'paid')                     AS paid_bills,
  COUNT(b.id) FILTER (WHERE b.status = 'overdue')                  AS overdue_bills,
  COALESCE(SUM(b.total) FILTER (WHERE b.status = 'overdue'), 0)    AS total_debt,
  COALESCE(SUM(b.total) FILTER (WHERE b.status = 'paid'),    0)    AS total_collected,
  ROUND(
    COUNT(b.id) FILTER (WHERE b.status = 'paid')::NUMERIC
    / NULLIF(COUNT(b.id), 0) * 100, 1
  )                                                                 AS collection_rate_pct,
  COALESCE(SUM(mr.usage), 0)                                        AS total_usage_m3
FROM members m
LEFT JOIN bills         b  ON b.member_id  = m.id
LEFT JOIN meter_readings mr ON mr.member_id = m.id;

CREATE OR REPLACE VIEW v_village_usage AS
SELECT
  v.id,
  v.name                                                               AS village_name,
  COUNT(DISTINCT m.id)                                                 AS member_count,
  COUNT(DISTINCT m.id) FILTER (WHERE m.status = 'overdue')            AS overdue_count,
  COALESCE(SUM(mr.usage), 0)                                           AS total_usage_m3,
  COALESCE(SUM(b.total) FILTER (WHERE b.status = 'overdue'), 0)       AS total_debt
FROM villages v
LEFT JOIN members       m  ON m.village_id  = v.id
LEFT JOIN meter_readings mr ON mr.member_id  = m.id
LEFT JOIN bills          b  ON b.member_id   = m.id
GROUP BY v.id, v.name
ORDER BY v.moo_number;

CREATE OR REPLACE VIEW v_member_bill_latest AS
SELECT DISTINCT ON (m.id)
  m.id          AS member_id,
  m.first_name,
  m.last_name,
  m.meter_no,
  m.status      AS member_status,
  v.name        AS village_name,
  b.id          AS latest_bill_id,
  b.period_label,
  b.total,
  b.due_date,
  b.status      AS bill_status
FROM members m
JOIN  villages v ON v.id       = m.village_id
LEFT JOIN bills b ON b.member_id = m.id
ORDER BY m.id, b.period_year DESC, b.period_month DESC;

CREATE OR REPLACE VIEW v_top_debtors AS
SELECT
  m.id          AS member_id,
  m.first_name,
  m.last_name,
  m.house_no,
  v.name        AS village_name,
  m.phone,
  COUNT(b.id)   AS overdue_months,
  SUM(b.total)  AS total_debt,
  MIN(b.due_date) AS oldest_due_date
FROM members m
JOIN villages v ON v.id        = m.village_id
JOIN bills    b ON b.member_id = m.id AND b.status = 'overdue'
GROUP BY m.id, m.first_name, m.last_name, m.house_no, v.name, m.phone
ORDER BY total_debt DESC;

CREATE OR REPLACE VIEW v_anomaly_readings AS
SELECT
  mr.id,
  mr.reading_date,
  mr.anomaly,
  mr.usage,
  mr.anomaly_notes,
  m.id          AS member_id,
  m.first_name,
  m.last_name,
  m.house_no,
  m.meter_no,
  v.name        AS village_name
FROM meter_readings mr
JOIN members  m ON m.id        = mr.member_id
JOIN villages v ON v.id        = m.village_id
WHERE mr.anomaly IS NOT NULL
ORDER BY mr.reading_date DESC;


-- SECTION 11 — SEED DATA (ข้อมูลตั้งต้น)

INSERT INTO villages (name, moo_number, gps_lat, gps_lng) VALUES
  ('หมู่ 1 บ้านป่า',  1, 18.7883, 98.9853),
  ('หมู่ 2 บ้านคลอง', 2, 18.7860, 98.9840),
  ('หมู่ 3 หนองใหญ่', 3, 18.7900, 98.9870),
  ('หมู่ 3 ท่าช้าง',  3, 18.7920, 98.9890),
  ('หมู่ 4 โคกสูง',   4, 18.7940, 98.9850);

INSERT INTO rate_tiers (from_unit, to_unit, rate_per_unit, svc_charge_small, svc_charge_large, late_fee_per_month) VALUES
  ( 0,   10,  5.00, 20, 30, 50),
  (11,   30,  8.50, 20, 30, 50),
  (31,   60, 12.00, 20, 30, 50),
  (61, NULL, 15.00, 20, 30, 50);


-- SECTION 12 — RPC FUNCTIONS

-- คำนวณค่าน้ำแบบ progressive
CREATE OR REPLACE FUNCTION calc_water_charge(
  p_usage      NUMERIC,
  p_meter_size TEXT
)
RETURNS TABLE (water_charge NUMERIC, service_charge NUMERIC, total NUMERIC)
LANGUAGE plpgsql AS $$
DECLARE
  v_svc    NUMERIC;
  v_charge NUMERIC := 0;
  v_rem    NUMERIC := p_usage;
  t        RECORD;
  tier_qty NUMERIC;
BEGIN
  SELECT CASE
    WHEN p_meter_size IN ('1.0','1.5') THEN svc_charge_large
    ELSE svc_charge_small
  END INTO v_svc
  FROM rate_tiers ORDER BY effective_from DESC LIMIT 1;

  FOR t IN (SELECT from_unit, to_unit, rate_per_unit FROM rate_tiers ORDER BY from_unit) LOOP
    EXIT WHEN v_rem <= 0;
    tier_qty := CASE
      WHEN t.to_unit IS NULL THEN v_rem
      ELSE LEAST(v_rem, t.to_unit - GREATEST(t.from_unit - 1, 0))
    END;
    v_charge := v_charge + tier_qty * t.rate_per_unit;
    v_rem    := v_rem - tier_qty;
  END LOOP;

  RETURN QUERY SELECT
    ROUND(v_charge, 2),
    COALESCE(v_svc, 20),
    ROUND(v_charge + COALESCE(v_svc, 20), 2);
END;
$$;

-- ดึงประวัติบิลของสมาชิก
CREATE OR REPLACE FUNCTION get_member_bills(p_member_id BIGINT)
RETURNS TABLE (
  bill_id      TEXT,
  period_label TEXT,
  usage        NUMERIC,
  total        NUMERIC,
  status       bill_status,
  due_date     DATE,
  paid_at      TIMESTAMPTZ,
  channel      payment_channel
)
LANGUAGE sql STABLE AS $$
  SELECT
    b.id, b.period_label, b.usage, b.total, b.status, b.due_date,
    p.paid_at, p.channel
  FROM bills b
  LEFT JOIN payments p ON p.bill_id = b.id AND p.status = 'approved'
  WHERE b.member_id = p_member_id
  ORDER BY b.period_year DESC, b.period_month DESC;
$$;
