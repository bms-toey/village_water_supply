-- ══════════════════════════════════════════════════════
-- BATCH 1/3 — ENUMs + Tables (Sections 1–5)
-- รันก่อน ต้องสำเร็จก่อนรัน batch 2
-- ══════════════════════════════════════════════════════

-- SECTION 1 — ENUMS
-- DROP ก่อนเพื่อให้รันซ้ำได้ (CASCADE จะ drop table ที่ใช้ type นี้ด้วย)
DROP TABLE IF EXISTS maintenance_jobs, water_quality, water_production, payments, bills, meter_readings, members, rate_tiers, profiles, villages CASCADE;
DROP TYPE  IF EXISTS reporter_type, quality_result, sent_channel, maintenance_status, maintenance_type, anomaly_type, reading_method, payment_channel, payment_status, bill_status, meter_size_type, member_type, member_status, user_role CASCADE;

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

-- SECTION 2 — CORE TABLES
CREATE TABLE villages (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  moo_number  SMALLINT,
  description TEXT,
  gps_lat     DOUBLE PRECISION,
  gps_lng     DOUBLE PRECISION,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   TEXT NOT NULL,
  role        user_role NOT NULL DEFAULT 'meter_reader',
  village_id  INT REFERENCES villages(id),
  phone       TEXT,
  avatar_url  TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE rate_tiers (
  id                  SERIAL PRIMARY KEY,
  from_unit           SMALLINT NOT NULL,
  to_unit             SMALLINT,
  rate_per_unit       NUMERIC(6,2) NOT NULL,
  svc_charge_small    NUMERIC(8,2) NOT NULL DEFAULT 20,
  svc_charge_large    NUMERIC(8,2) NOT NULL DEFAULT 30,
  late_fee_per_month  NUMERIC(8,2) NOT NULL DEFAULT 50,
  effective_from      DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by          UUID REFERENCES profiles(id),
  created_at          TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT tier_range_valid CHECK (to_unit IS NULL OR to_unit > from_unit)
);

-- SECTION 3 — MEMBERS & METERS
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
  meter_no            TEXT NOT NULL UNIQUE,
  meter_size          meter_size_type NOT NULL DEFAULT '0.5',
  meter_brand         TEXT,
  meter_install_date  DATE,
  meter_expire_date   DATE,
  last_read           NUMERIC(10,2) NOT NULL DEFAULT 0,
  last_read_date      DATE,
  status              member_status NOT NULL DEFAULT 'normal',
  notes               TEXT,
  created_by          UUID REFERENCES profiles(id),
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE meter_readings (
  id              TEXT PRIMARY KEY,
  member_id       BIGINT NOT NULL REFERENCES members(id),
  meter_no        TEXT NOT NULL,
  reading_date    DATE NOT NULL,
  prev_reading    NUMERIC(10,2) NOT NULL DEFAULT 0,
  curr_reading    NUMERIC(10,2) NOT NULL,
  usage           NUMERIC(10,2) GENERATED ALWAYS AS (curr_reading - prev_reading) STORED,
  water_charge    NUMERIC(10,2),
  service_charge  NUMERIC(8,2),
  read_by         UUID REFERENCES profiles(id),
  method          reading_method NOT NULL DEFAULT 'manual',
  anomaly         anomaly_type,
  anomaly_notes   TEXT,
  photo_url       TEXT,
  bill_id         TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT reading_non_negative CHECK (curr_reading >= prev_reading)
);

-- SECTION 4 — BILLING & PAYMENTS
CREATE TABLE bills (
  id              TEXT PRIMARY KEY,
  member_id       BIGINT NOT NULL REFERENCES members(id),
  period_year     SMALLINT NOT NULL,
  period_month    SMALLINT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_label    TEXT NOT NULL,
  issue_date      DATE NOT NULL,
  due_date        DATE NOT NULL,
  usage           NUMERIC(10,2) NOT NULL DEFAULT 0,
  water_charge    NUMERIC(10,2) NOT NULL DEFAULT 0,
  service_charge  NUMERIC(8,2)  NOT NULL DEFAULT 0,
  late_fee        NUMERIC(8,2)  NOT NULL DEFAULT 0,
  discount        NUMERIC(8,2)  NOT NULL DEFAULT 0,
  total           NUMERIC(10,2) GENERATED ALWAYS AS (water_charge + service_charge + late_fee - discount) STORED,
  status          bill_status NOT NULL DEFAULT 'pending',
  sent_via        sent_channel NOT NULL DEFAULT 'none',
  issued_by       UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (member_id, period_year, period_month)
);

ALTER TABLE meter_readings
  ADD CONSTRAINT fk_reading_bill
  FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE SET NULL;

CREATE TABLE payments (
  id              TEXT PRIMARY KEY,
  bill_id         TEXT NOT NULL REFERENCES bills(id),
  member_id       BIGINT NOT NULL REFERENCES members(id),
  paid_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  amount          NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  channel         payment_channel NOT NULL,
  tx_ref          TEXT,
  payer_name      TEXT,
  slip_url        TEXT,
  status          payment_status NOT NULL DEFAULT 'pending',
  approved_by     UUID REFERENCES profiles(id),
  approved_at     TIMESTAMPTZ,
  reject_reason   TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- SECTION 5 — OPERATIONS
CREATE TABLE water_production (
  id                  TEXT PRIMARY KEY,
  period_year         SMALLINT NOT NULL,
  period_month        SMALLINT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_label        TEXT NOT NULL,
  raw_water_in        NUMERIC(12,2),
  water_produced      NUMERIC(12,2),
  water_distributed   NUMERIC(12,2),
  total_meter_usage   NUMERIC(12,2),
  nrw                 NUMERIC(12,2) GENERATED ALWAYS AS (water_distributed - total_meter_usage) STORED,
  nrw_pct             NUMERIC(5,2)
    GENERATED ALWAYS AS (
      CASE WHEN COALESCE(water_distributed, 0) > 0
        THEN ROUND((water_distributed - total_meter_usage) / water_distributed * 100, 2)
        ELSE 0
      END
    ) STORED,
  electricity_cost    NUMERIC(10,2) NOT NULL DEFAULT 0,
  chemical_cost       NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_cost          NUMERIC(10,2) GENERATED ALWAYS AS (electricity_cost + chemical_cost) STORED,
  recorded_by         UUID REFERENCES profiles(id),
  recorded_date       DATE,
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE (period_year, period_month)
);

CREATE TABLE water_quality (
  id            TEXT PRIMARY KEY,
  test_date     DATE NOT NULL,
  sample_point  TEXT NOT NULL,
  village_id    INT REFERENCES villages(id),
  ph            NUMERIC(4,2),
  turbidity     NUMERIC(6,3),
  chlorine      NUMERIC(5,3),
  ec            NUMERIC(8,2),
  coliform      NUMERIC(8,2),
  result        quality_result NOT NULL DEFAULT 'pass',
  tested_by     UUID REFERENCES profiles(id),
  lab_ref       TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE maintenance_jobs (
  id                TEXT PRIMARY KEY,
  type              maintenance_type NOT NULL,
  description       TEXT NOT NULL,
  location          TEXT,
  village_id        INT REFERENCES villages(id),
  member_id         BIGINT REFERENCES members(id),
  reported_by_type  reporter_type NOT NULL DEFAULT 'staff',
  reported_by       UUID REFERENCES profiles(id),
  reported_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  assigned_to       UUID REFERENCES profiles(id),
  assigned_name     TEXT,
  start_date        DATE,
  completed_date    DATE,
  materials         TEXT,
  cost              NUMERIC(10,2) NOT NULL DEFAULT 0,
  status            maintenance_status NOT NULL DEFAULT 'pending',
  approved_by       UUID REFERENCES profiles(id),
  photos            TEXT[],
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);
