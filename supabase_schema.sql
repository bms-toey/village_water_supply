-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  AquaFlow Pro — Supabase / PostgreSQL Schema                    ║
-- ║  วิ่งใน Supabase SQL Editor ตามลำดับ Section 1 → 7             ║
-- ╚══════════════════════════════════════════════════════════════════╝


-- ══════════════════════════════════════════════════════════════════
-- SECTION 1 — ENUMS
-- ══════════════════════════════════════════════════════════════════

CREATE TYPE user_role          AS ENUM ('super_admin','village_admin','meter_reader','finance');
CREATE TYPE member_status      AS ENUM ('normal','overdue','closed','suspended');
CREATE TYPE member_type        AS ENUM ('residential','commercial','agriculture','institution');
CREATE TYPE meter_size_type    AS ENUM ('0.5','0.75','1.0','1.5');
CREATE TYPE bill_status        AS ENUM ('pending','paid','overdue','cancelled');
CREATE TYPE payment_status     AS ENUM ('pending','approved','rejected');
CREATE TYPE payment_channel    AS ENUM ('cash','promptpay','bank','mobile','line_pay');
CREATE TYPE reading_method     AS ENUM ('manual','ai_scan','estimated','remote');
CREATE TYPE anomaly_type       AS ENUM ('high_usage','suspected_leak','meter_fault');
CREATE TYPE maintenance_type   AS ENUM ('pipe_repair','meter_replace','tank_clean','pump_service','leak_fix','other');
CREATE TYPE maintenance_status AS ENUM ('pending','in_progress','completed','cancelled');
CREATE TYPE sent_channel       AS ENUM ('line','sms','app','manual','none');
CREATE TYPE quality_result     AS ENUM ('pass','fail');
CREATE TYPE reporter_type      AS ENUM ('member','staff','system');


-- ══════════════════════════════════════════════════════════════════
-- SECTION 2 — CORE SETUP (villages, profiles)
-- ══════════════════════════════════════════════════════════════════

-- ─── หมู่บ้าน ──────────────────────────────────────────────────
CREATE TABLE villages (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,       -- 'หมู่ 1 บ้านป่า'
  moo_number  SMALLINT,                   -- 1, 2, 3 …
  description TEXT,
  gps_lat     DOUBLE PRECISION,           -- จุดศูนย์กลางหมู่บ้าน
  gps_lng     DOUBLE PRECISION,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ─── profiles (ต่อยอดจาก auth.users) ────────────────────────────
-- สร้าง auto เมื่อ user signup ผ่าน trigger ด้านล่าง
CREATE TABLE profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   TEXT NOT NULL,
  role        user_role NOT NULL DEFAULT 'meter_reader',
  village_id  INT REFERENCES villages(id),  -- NULL = เข้าถึงทุกหมู่บ้าน
  phone       TEXT,
  avatar_url  TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ─── อัตราค่าน้ำ (tier-based progressive) ───────────────────────
-- เก็บเป็น row ต่อ tier เพื่อ audit history
CREATE TABLE rate_tiers (
  id                  SERIAL PRIMARY KEY,
  from_unit           SMALLINT NOT NULL,      -- หน่วยเริ่มต้น (inclusive)
  to_unit             SMALLINT,               -- NULL = ไม่จำกัด (tier สุดท้าย)
  rate_per_unit       NUMERIC(6,2) NOT NULL,  -- บาท/หน่วย
  svc_charge_small    NUMERIC(8,2) NOT NULL DEFAULT 20,  -- ค่าบริการ ½" และ ¾"
  svc_charge_large    NUMERIC(8,2) NOT NULL DEFAULT 30,  -- ค่าบริการ 1" และ 1½"
  late_fee_per_month  NUMERIC(8,2) NOT NULL DEFAULT 50,  -- ค่าปรับต่อเดือน
  effective_from      DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by          UUID REFERENCES profiles(id),
  created_at          TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT tier_range_valid CHECK (to_unit IS NULL OR to_unit > from_unit)
);


-- ══════════════════════════════════════════════════════════════════
-- SECTION 3 — MEMBERS & METERS
-- ══════════════════════════════════════════════════════════════════

-- ─── สมาชิกผู้ใช้น้ำ ─────────────────────────────────────────────
CREATE TABLE members (
  id                  BIGSERIAL PRIMARY KEY,
  first_name          TEXT NOT NULL,
  last_name           TEXT NOT NULL,
  national_id         TEXT UNIQUE,
  house_no            TEXT NOT NULL DEFAULT '',
  village_id          INT NOT NULL REFERENCES villages(id),
  member_type         member_type NOT NULL DEFAULT 'residential',
  household_count     SMALLINT NOT NULL DEFAULT 1 CHECK (household_count > 0),
  registration_date   DATE,
  phone               TEXT,
  line_id             TEXT,
  email               TEXT,
  gps_lat             DOUBLE PRECISION,
  gps_lng             DOUBLE PRECISION,
  -- มิเตอร์
  meter_no            TEXT NOT NULL UNIQUE,
  meter_size          meter_size_type NOT NULL DEFAULT '0.5',
  meter_brand         TEXT,
  meter_install_date  DATE,
  meter_expire_date   DATE,
  -- อ่านล่าสุด (denormalized เพื่อแสดงเร็ว)
  last_read           NUMERIC(10,2) NOT NULL DEFAULT 0,
  last_read_date      DATE,
  -- สถานะ
  status              member_status NOT NULL DEFAULT 'normal',
  notes               TEXT,
  created_by          UUID REFERENCES profiles(id),
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

-- ─── การอ่านมิเตอร์ ───────────────────────────────────────────────
CREATE TABLE meter_readings (
  id              TEXT PRIMARY KEY,                  -- 'MR-YYMMXXXX'
  member_id       BIGINT NOT NULL REFERENCES members(id),
  meter_no        TEXT NOT NULL,
  reading_date    DATE NOT NULL,
  prev_reading    NUMERIC(10,2) NOT NULL DEFAULT 0,
  curr_reading    NUMERIC(10,2) NOT NULL,
  usage           NUMERIC(10,2)
    GENERATED ALWAYS AS (curr_reading - prev_reading) STORED,
  water_charge    NUMERIC(10,2),
  service_charge  NUMERIC(8,2),
  -- total คำนวณจาก bill (ไม่ใส่ late_fee ที่นี่)
  read_by         UUID REFERENCES profiles(id),
  method          reading_method NOT NULL DEFAULT 'manual',
  anomaly         anomaly_type,
  anomaly_notes   TEXT,
  photo_url       TEXT,                              -- path ใน Storage bucket
  bill_id         TEXT,                              -- FK เพิ่มหลัง bills สร้าง
  created_at      TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT reading_non_negative CHECK (curr_reading >= prev_reading)
);


-- ══════════════════════════════════════════════════════════════════
-- SECTION 4 — BILLING & PAYMENTS
-- ══════════════════════════════════════════════════════════════════

-- ─── ใบแจ้งหนี้ ───────────────────────────────────────────────────
CREATE TABLE bills (
  id              TEXT PRIMARY KEY,                  -- 'BILL-YYMM-XXX'
  member_id       BIGINT NOT NULL REFERENCES members(id),
  period_year     SMALLINT NOT NULL,                 -- 2566 (พ.ศ.)
  period_month    SMALLINT NOT NULL
    CHECK (period_month BETWEEN 1 AND 12),
  period_label    TEXT NOT NULL,                     -- 'ต.ค. 2566'
  issue_date      DATE NOT NULL,
  due_date        DATE NOT NULL,
  usage           NUMERIC(10,2) NOT NULL DEFAULT 0,
  water_charge    NUMERIC(10,2) NOT NULL DEFAULT 0,
  service_charge  NUMERIC(8,2)  NOT NULL DEFAULT 0,
  late_fee        NUMERIC(8,2)  NOT NULL DEFAULT 0,
  discount        NUMERIC(8,2)  NOT NULL DEFAULT 0,
  total           NUMERIC(10,2)
    GENERATED ALWAYS AS (water_charge + service_charge + late_fee - discount) STORED,
  status          bill_status NOT NULL DEFAULT 'pending',
  sent_via        sent_channel NOT NULL DEFAULT 'none',
  issued_by       UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  -- ห้ามออกบิลซ้ำต่อสมาชิกในรอบเดียวกัน
  UNIQUE (member_id, period_year, period_month)
);

-- FK จาก meter_readings → bills (เพิ่มหลัง bills ถูกสร้าง)
ALTER TABLE meter_readings
  ADD CONSTRAINT fk_reading_bill
  FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE SET NULL;

-- ─── การชำระเงิน ──────────────────────────────────────────────────
CREATE TABLE payments (
  id              TEXT PRIMARY KEY,                  -- 'PAY-XXXXXX'
  bill_id         TEXT NOT NULL REFERENCES bills(id),
  member_id       BIGINT NOT NULL REFERENCES members(id),
  paid_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  amount          NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  channel         payment_channel NOT NULL,
  tx_ref          TEXT,
  payer_name      TEXT,
  slip_url        TEXT,                              -- path ใน Storage bucket
  status          payment_status NOT NULL DEFAULT 'pending',
  approved_by     UUID REFERENCES profiles(id),
  approved_at     TIMESTAMPTZ,
  reject_reason   TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);


-- ══════════════════════════════════════════════════════════════════
-- SECTION 5 — OPERATIONS (water_production, water_quality, maintenance)
-- ══════════════════════════════════════════════════════════════════

-- ─── การผลิตน้ำ / NRW ────────────────────────────────────────────
CREATE TABLE water_production (
  id                  TEXT PRIMARY KEY,              -- 'WP-2566-10'
  period_year         SMALLINT NOT NULL,
  period_month        SMALLINT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_label        TEXT NOT NULL,
  raw_water_in        NUMERIC(12,2),                 -- น้ำดิบเข้า (m³)
  water_produced      NUMERIC(12,2),                 -- น้ำที่ผลิตได้
  water_distributed   NUMERIC(12,2),                 -- น้ำที่จ่ายออก
  total_meter_usage   NUMERIC(12,2),                 -- รวมที่มิเตอร์วัดได้
  nrw                 NUMERIC(12,2)                  -- น้ำสูญเสีย
    GENERATED ALWAYS AS (water_distributed - total_meter_usage) STORED,
  nrw_pct             NUMERIC(5,2)                   -- % สูญเสีย
    GENERATED ALWAYS AS (
      CASE WHEN COALESCE(water_distributed, 0) > 0
        THEN ROUND((water_distributed - total_meter_usage) / water_distributed * 100, 2)
        ELSE 0
      END
    ) STORED,
  electricity_cost    NUMERIC(10,2) NOT NULL DEFAULT 0,
  chemical_cost       NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_cost          NUMERIC(10,2)
    GENERATED ALWAYS AS (electricity_cost + chemical_cost) STORED,
  recorded_by         UUID REFERENCES profiles(id),
  recorded_date       DATE,
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE (period_year, period_month)
);

-- ─── คุณภาพน้ำ ────────────────────────────────────────────────────
CREATE TABLE water_quality (
  id            TEXT PRIMARY KEY,                    -- 'WQ-001'
  test_date     DATE NOT NULL,
  sample_point  TEXT NOT NULL,                       -- 'ต้นทาง', 'กลางสาย', 'ปลายสาย'
  village_id    INT REFERENCES villages(id),
  ph            NUMERIC(4,2),
  turbidity     NUMERIC(6,3),                        -- NTU
  chlorine      NUMERIC(5,3),                        -- mg/L
  ec            NUMERIC(8,2),                        -- μS/cm
  coliform      NUMERIC(8,2),                        -- CFU/100mL
  result        quality_result NOT NULL DEFAULT 'pass',
  tested_by     UUID REFERENCES profiles(id),
  lab_ref       TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ─── งานซ่อมบำรุง ────────────────────────────────────────────────
CREATE TABLE maintenance_jobs (
  id                TEXT PRIMARY KEY,                -- 'MNT-001'
  type              maintenance_type NOT NULL,
  description       TEXT NOT NULL,
  location          TEXT,
  village_id        INT REFERENCES villages(id),
  member_id         BIGINT REFERENCES members(id),  -- NULL ถ้าไม่เกี่ยวกับสมาชิกโดยตรง
  reported_by_type  reporter_type NOT NULL DEFAULT 'staff',
  reported_by       UUID REFERENCES profiles(id),
  reported_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  assigned_to       UUID REFERENCES profiles(id),
  assigned_name     TEXT,                            -- ชื่อช่างภายนอก
  start_date        DATE,
  completed_date    DATE,
  materials         TEXT,
  cost              NUMERIC(10,2) NOT NULL DEFAULT 0,
  status            maintenance_status NOT NULL DEFAULT 'pending',
  approved_by       UUID REFERENCES profiles(id),
  photos            TEXT[],                          -- array paths ใน Storage
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);


-- ══════════════════════════════════════════════════════════════════
-- SECTION 6 — INDEXES (ประสิทธิภาพ query)
-- ══════════════════════════════════════════════════════════════════

-- members
CREATE INDEX idx_members_village    ON members(village_id);
CREATE INDEX idx_members_status     ON members(status);
CREATE INDEX idx_members_meter_no   ON members(meter_no);
CREATE INDEX idx_members_national   ON members(national_id);
CREATE INDEX idx_members_name       ON members USING gin(
  to_tsvector('simple', first_name || ' ' || last_name)
);

-- meter_readings
CREATE INDEX idx_readings_member    ON meter_readings(member_id);
CREATE INDEX idx_readings_date      ON meter_readings(reading_date DESC);
CREATE INDEX idx_readings_bill      ON meter_readings(bill_id);
CREATE INDEX idx_readings_anomaly   ON meter_readings(anomaly) WHERE anomaly IS NOT NULL;

-- bills
CREATE INDEX idx_bills_member       ON bills(member_id);
CREATE INDEX idx_bills_period       ON bills(period_year DESC, period_month DESC);
CREATE INDEX idx_bills_status       ON bills(status);
CREATE INDEX idx_bills_due          ON bills(due_date) WHERE status IN ('pending','overdue');

-- payments
CREATE INDEX idx_payments_bill      ON payments(bill_id);
CREATE INDEX idx_payments_member    ON payments(member_id);
CREATE INDEX idx_payments_status    ON payments(status);
CREATE INDEX idx_payments_paid_at   ON payments(paid_at DESC);

-- maintenance
CREATE INDEX idx_mnt_status         ON maintenance_jobs(status);
CREATE INDEX idx_mnt_village        ON maintenance_jobs(village_id);
CREATE INDEX idx_mnt_member         ON maintenance_jobs(member_id);


-- ══════════════════════════════════════════════════════════════════
-- SECTION 7 — TRIGGERS & FUNCTIONS
-- ══════════════════════════════════════════════════════════════════

-- ─── auto-update updated_at ───────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_updated
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_members_updated
  BEFORE UPDATE ON members
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_bills_updated
  BEFORE UPDATE ON bills
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_payments_updated
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_mnt_updated
  BEFORE UPDATE ON maintenance_jobs
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ─── auto-create profile เมื่อ user signup ────────────────────────
CREATE OR REPLACE FUNCTION fn_handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'meter_reader')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION fn_handle_new_user();

-- ─── sync member.status จาก bills ────────────────────────────────
-- เมื่อบิลถูกอัปเดต ให้ sync status ของสมาชิก:
--   ถ้ามีบิล overdue → member = overdue
--   ถ้าไม่มีบิล overdue → member = normal (ยกเว้น closed/suspended)
CREATE OR REPLACE FUNCTION fn_sync_member_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_member_id BIGINT;
  v_has_overdue BOOLEAN;
BEGIN
  v_member_id := COALESCE(NEW.member_id, OLD.member_id);

  SELECT EXISTS (
    SELECT 1 FROM bills
    WHERE member_id = v_member_id AND status = 'overdue'
  ) INTO v_has_overdue;

  UPDATE members
  SET status = CASE
    WHEN status IN ('closed','suspended') THEN status  -- ไม่แก้ถ้า closed/suspended
    WHEN v_has_overdue THEN 'overdue'
    ELSE 'normal'
  END
  WHERE id = v_member_id
    AND status NOT IN ('closed','suspended');

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_bill_status_changed
  AFTER INSERT OR UPDATE OF status OR DELETE ON bills
  FOR EACH ROW EXECUTE FUNCTION fn_sync_member_status();

-- ─── auto approve เมื่อชำระเงินสด ────────────────────────────────
-- payment channel=cash → status=approved ทันที และ bill → paid
CREATE OR REPLACE FUNCTION fn_auto_approve_cash()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.channel = 'cash' AND NEW.status = 'pending' THEN
    NEW.status      := 'approved';
    NEW.approved_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cash_auto_approve
  BEFORE INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION fn_auto_approve_cash();

-- ─── เมื่อ payment approved → bill = paid ─────────────────────────
CREATE OR REPLACE FUNCTION fn_payment_approved()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'approved' AND (OLD IS NULL OR OLD.status <> 'approved') THEN
    UPDATE bills SET status = 'paid'
    WHERE id = NEW.bill_id AND status <> 'cancelled';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payment_approved
  AFTER INSERT OR UPDATE OF status ON payments
  FOR EACH ROW EXECUTE FUNCTION fn_payment_approved();

-- ─── update member.last_read เมื่อมีการอ่านมิเตอร์ใหม่ ─────────
CREATE OR REPLACE FUNCTION fn_update_last_read()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE members
  SET last_read      = NEW.curr_reading,
      last_read_date = NEW.reading_date,
      updated_at     = now()
  WHERE id = NEW.member_id
    AND (last_read_date IS NULL OR NEW.reading_date >= last_read_date);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_update_last_read
  AFTER INSERT ON meter_readings
  FOR EACH ROW EXECUTE FUNCTION fn_update_last_read();


-- ══════════════════════════════════════════════════════════════════
-- SECTION 8 — ROW LEVEL SECURITY (RLS)
-- ══════════════════════════════════════════════════════════════════

-- เปิด RLS ทุก table
ALTER TABLE villages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_tiers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE members           ENABLE ROW LEVEL SECURITY;
ALTER TABLE meter_readings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE bills             ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_production  ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_quality     ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_jobs  ENABLE ROW LEVEL SECURITY;

-- Helper function: ดึง role ของ user ปัจจุบัน
CREATE OR REPLACE FUNCTION auth_role()
RETURNS user_role LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$;

-- Helper function: ดึง village_id ของ user ปัจจุบัน
CREATE OR REPLACE FUNCTION auth_village()
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT village_id FROM profiles WHERE id = auth.uid()
$$;

-- ─── villages ─────────────────────────────────────────────────────
-- ทุกคนอ่านได้, เฉพาะ super_admin แก้ไขได้
CREATE POLICY "villages: all read"
  ON villages FOR SELECT USING (true);

CREATE POLICY "villages: super_admin write"
  ON villages FOR ALL USING (auth_role() = 'super_admin');

-- ─── profiles ─────────────────────────────────────────────────────
CREATE POLICY "profiles: own row"
  ON profiles FOR SELECT
  USING (id = auth.uid() OR auth_role() IN ('super_admin','finance'));

CREATE POLICY "profiles: super_admin manage"
  ON profiles FOR ALL USING (auth_role() = 'super_admin');

-- ─── rate_tiers ───────────────────────────────────────────────────
CREATE POLICY "rate_tiers: all read"
  ON rate_tiers FOR SELECT USING (true);

CREATE POLICY "rate_tiers: super_admin write"
  ON rate_tiers FOR ALL USING (auth_role() = 'super_admin');

-- ─── members ──────────────────────────────────────────────────────
-- super_admin / finance: ทั้งหมด
-- village_admin / meter_reader: เฉพาะหมู่บ้านตัวเอง
CREATE POLICY "members: read by role"
  ON members FOR SELECT USING (
    auth_role() IN ('super_admin','finance')
    OR village_id = auth_village()
  );

CREATE POLICY "members: insert by admin"
  ON members FOR INSERT WITH CHECK (
    auth_role() IN ('super_admin','village_admin')
  );

CREATE POLICY "members: update by admin"
  ON members FOR UPDATE USING (
    auth_role() IN ('super_admin','village_admin')
    AND (auth_role() = 'super_admin' OR village_id = auth_village())
  );

CREATE POLICY "members: delete by super"
  ON members FOR DELETE USING (auth_role() = 'super_admin');

-- ─── meter_readings ───────────────────────────────────────────────
CREATE POLICY "readings: read by role"
  ON meter_readings FOR SELECT USING (
    auth_role() IN ('super_admin','finance')
    OR member_id IN (
      SELECT id FROM members WHERE village_id = auth_village()
    )
  );

CREATE POLICY "readings: insert by reader"
  ON meter_readings FOR INSERT WITH CHECK (
    auth_role() IN ('super_admin','village_admin','meter_reader')
    AND member_id IN (
      SELECT id FROM members WHERE village_id = auth_village()
      UNION SELECT id FROM members WHERE auth_role() = 'super_admin'
    )
  );

-- ─── bills ────────────────────────────────────────────────────────
CREATE POLICY "bills: read by role"
  ON bills FOR SELECT USING (
    auth_role() IN ('super_admin','finance')
    OR member_id IN (
      SELECT id FROM members WHERE village_id = auth_village()
    )
  );

CREATE POLICY "bills: manage by admin"
  ON bills FOR ALL USING (
    auth_role() IN ('super_admin','village_admin','finance')
  );

-- ─── payments ─────────────────────────────────────────────────────
CREATE POLICY "payments: read by role"
  ON payments FOR SELECT USING (
    auth_role() IN ('super_admin','finance')
    OR member_id IN (
      SELECT id FROM members WHERE village_id = auth_village()
    )
  );

CREATE POLICY "payments: insert by finance or admin"
  ON payments FOR INSERT WITH CHECK (
    auth_role() IN ('super_admin','village_admin','finance')
  );

CREATE POLICY "payments: approve by finance or super"
  ON payments FOR UPDATE USING (
    auth_role() IN ('super_admin','finance')
  );

-- ─── water_production, water_quality ─────────────────────────────
CREATE POLICY "wp: read all"   ON water_production FOR SELECT USING (true);
CREATE POLICY "wp: admin write" ON water_production FOR ALL USING (
  auth_role() IN ('super_admin','village_admin')
);

CREATE POLICY "wq: read all"   ON water_quality FOR SELECT USING (true);
CREATE POLICY "wq: admin write" ON water_quality FOR ALL USING (
  auth_role() IN ('super_admin','village_admin')
);

-- ─── maintenance_jobs ─────────────────────────────────────────────
CREATE POLICY "mnt: read by role"
  ON maintenance_jobs FOR SELECT USING (
    auth_role() IN ('super_admin','finance')
    OR village_id = auth_village()
    OR village_id IS NULL
  );

CREATE POLICY "mnt: manage by admin"
  ON maintenance_jobs FOR ALL USING (
    auth_role() IN ('super_admin','village_admin')
  );


-- ══════════════════════════════════════════════════════════════════
-- SECTION 9 — VIEWS (สรุปข้อมูลสำหรับ Dashboard)
-- ══════════════════════════════════════════════════════════════════

-- ─── dashboard_summary — KPI หน้าหลัก ────────────────────────────
CREATE OR REPLACE VIEW v_dashboard_summary AS
SELECT
  COUNT(DISTINCT m.id)                                    AS total_members,
  COUNT(DISTINCT m.id) FILTER (WHERE m.status = 'normal') AS normal_members,
  COUNT(DISTINCT m.id) FILTER (WHERE m.status = 'overdue') AS overdue_members,
  COUNT(b.id)                                             AS total_bills,
  COUNT(b.id) FILTER (WHERE b.status = 'paid')            AS paid_bills,
  COUNT(b.id) FILTER (WHERE b.status = 'overdue')         AS overdue_bills,
  COALESCE(SUM(b.total) FILTER (WHERE b.status = 'overdue'), 0)  AS total_debt,
  COALESCE(SUM(b.total) FILTER (WHERE b.status = 'paid'), 0)     AS total_collected,
  ROUND(
    COUNT(b.id) FILTER (WHERE b.status = 'paid')::NUMERIC
    / NULLIF(COUNT(b.id), 0) * 100, 1
  )                                                       AS collection_rate_pct,
  COALESCE(SUM(mr.usage), 0)                              AS total_usage_m3
FROM members m
LEFT JOIN bills b ON b.member_id = m.id
LEFT JOIN meter_readings mr ON mr.member_id = m.id;

-- ─── village_usage_summary — เปรียบเทียบรายหมู่บ้าน ──────────────
CREATE OR REPLACE VIEW v_village_usage AS
SELECT
  v.id,
  v.name                                          AS village_name,
  COUNT(DISTINCT m.id)                            AS member_count,
  COUNT(DISTINCT m.id) FILTER (WHERE m.status = 'overdue') AS overdue_count,
  COALESCE(SUM(mr.usage), 0)                      AS total_usage_m3,
  COALESCE(SUM(b.total) FILTER (WHERE b.status = 'overdue'), 0) AS total_debt
FROM villages v
LEFT JOIN members m ON m.village_id = v.id
LEFT JOIN meter_readings mr ON mr.member_id = m.id
LEFT JOIN bills b ON b.member_id = m.id
GROUP BY v.id, v.name
ORDER BY v.moo_number;

-- ─── member_bill_status — สถานะล่าสุดต่อสมาชิก ───────────────────
CREATE OR REPLACE VIEW v_member_bill_latest AS
SELECT DISTINCT ON (m.id)
  m.id            AS member_id,
  m.first_name,
  m.last_name,
  m.meter_no,
  m.status        AS member_status,
  v.name          AS village_name,
  b.id            AS latest_bill_id,
  b.period_label,
  b.total,
  b.due_date,
  b.status        AS bill_status
FROM members m
JOIN villages v ON v.id = m.village_id
LEFT JOIN bills b ON b.member_id = m.id
ORDER BY m.id, b.period_year DESC, b.period_month DESC;

-- ─── top_debtors ──────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_top_debtors AS
SELECT
  m.id            AS member_id,
  m.first_name,
  m.last_name,
  m.house_no,
  v.name          AS village_name,
  m.phone,
  COUNT(b.id)     AS overdue_months,
  SUM(b.total)    AS total_debt,
  MIN(b.due_date) AS oldest_due_date
FROM members m
JOIN villages v ON v.id = m.village_id
JOIN bills b ON b.member_id = m.id AND b.status = 'overdue'
GROUP BY m.id, m.first_name, m.last_name, m.house_no, v.name, m.phone
ORDER BY total_debt DESC;

-- ─── anomaly_readings — ค่าผิดปกติล่าสุด ─────────────────────────
CREATE OR REPLACE VIEW v_anomaly_readings AS
SELECT
  mr.id,
  mr.reading_date,
  mr.anomaly,
  mr.usage,
  mr.anomaly_notes,
  m.id            AS member_id,
  m.first_name,
  m.last_name,
  m.house_no,
  m.meter_no,
  v.name          AS village_name
FROM meter_readings mr
JOIN members m ON m.id = mr.member_id
JOIN villages v ON v.id = m.village_id
WHERE mr.anomaly IS NOT NULL
ORDER BY mr.reading_date DESC;


-- ══════════════════════════════════════════════════════════════════
-- SECTION 10 — STORAGE BUCKETS (คำสั่งแนะนำ ทำใน Supabase Dashboard)
-- ══════════════════════════════════════════════════════════════════

-- สร้าง Bucket ใน Supabase Dashboard → Storage:
--
-- 1. meter-photos
--    Public: false
--    Path pattern: {village_id}/{member_id}/{reading_id}.jpg
--    Max size: 5MB
--    Allowed MIME: image/jpeg, image/png, image/webp
--
-- 2. payment-slips
--    Public: false
--    Path pattern: {year}/{month}/{payment_id}.jpg
--    Max size: 5MB
--    Allowed MIME: image/jpeg, image/png, image/webp
--
-- Storage Policy: ทำผ่าน Supabase Dashboard → Storage → Policies ง่ายกว่า SQL


-- ══════════════════════════════════════════════════════════════════
-- SECTION 11 — SEED DATA (ข้อมูลตั้งต้น)
-- ══════════════════════════════════════════════════════════════════

-- หมู่บ้าน
INSERT INTO villages (name, moo_number, gps_lat, gps_lng) VALUES
  ('หมู่ 1 บ้านป่า',   1, 18.7883, 98.9853),
  ('หมู่ 2 บ้านคลอง',  2, 18.7860, 98.9840),
  ('หมู่ 3 หนองใหญ่',  3, 18.7900, 98.9870),
  ('หมู่ 3 ท่าช้าง',   3, 18.7920, 98.9890),
  ('หมู่ 4 โคกสูง',    4, 18.7940, 98.9850);

-- อัตราค่าน้ำ (4 tiers)
INSERT INTO rate_tiers (from_unit, to_unit, rate_per_unit, svc_charge_small, svc_charge_large, late_fee_per_month) VALUES
  ( 0, 10,   5.00, 20, 30, 50),
  (11, 30,   8.50, 20, 30, 50),
  (31, 60,  12.00, 20, 30, 50),
  (61, NULL, 15.00, 20, 30, 50);


-- ══════════════════════════════════════════════════════════════════
-- SECTION 12 — USEFUL RPC FUNCTIONS
-- ══════════════════════════════════════════════════════════════════

-- คำนวณค่าน้ำแบบ progressive (ใช้แทน calcWaterCharge ใน JS)
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
BEGIN
  SELECT CASE
    WHEN p_meter_size IN ('1.0','1.5') THEN svc_charge_large
    ELSE svc_charge_small
  END INTO v_svc
  FROM rate_tiers ORDER BY effective_from DESC LIMIT 1;

  FOR t IN (
    SELECT from_unit, to_unit, rate_per_unit
    FROM rate_tiers
    ORDER BY from_unit
  ) LOOP
    EXIT WHEN v_rem <= 0;
    DECLARE
      tier_qty NUMERIC;
    BEGIN
      tier_qty := CASE
        WHEN t.to_unit IS NULL THEN v_rem
        ELSE LEAST(v_rem, t.to_unit - GREATEST(t.from_unit - 1, 0))
      END;
      v_charge := v_charge + tier_qty * t.rate_per_unit;
      v_rem    := v_rem - tier_qty;
    END;
  END LOOP;

  RETURN QUERY SELECT
    ROUND(v_charge, 2),
    COALESCE(v_svc, 20),
    ROUND(v_charge + COALESCE(v_svc, 20), 2);
END;
$$;

-- ดึงประวัติบิลของสมาชิก (ใช้แทน openMemberQuickView)
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
