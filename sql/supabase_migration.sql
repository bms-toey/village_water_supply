-- ═══════════════════════════════════════════════════════════════
--  AquaFlow Pro — Supabase Migration
--  รัน SQL นี้ใน Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- ─── 0. members: อนุญาตให้ village_id เป็น NULL ได้ ──────────
-- (กรณีสมาชิกยังไม่ได้ระบุหมู่บ้าน หรือ village lookup ไม่เจอ)
ALTER TABLE members
  ALTER COLUMN village_id DROP NOT NULL;

-- ─── 1. payments: เพิ่มคอลัมน์เลขที่ใบเสร็จ ──────────────────
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS receipt_no TEXT;

-- ─── 2. bills: เพิ่มคอลัมน์สำหรับยกเลิกบิล ───────────────────
ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_by  TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at  TIMESTAMPTZ;

-- ─── 3. RLS — เปิดสิทธิ์ write สำหรับ user ที่ login แล้ว ────
-- (ถ้า RLS เปิดอยู่แต่ไม่มี policy → write พัง)
-- DROP ก่อนแล้ว CREATE ใหม่ (PostgreSQL 15 ไม่มี CREATE POLICY IF NOT EXISTS)

DROP POLICY IF EXISTS "auth_write_members"       ON members;
DROP POLICY IF EXISTS "auth_write_bills"         ON bills;
DROP POLICY IF EXISTS "auth_write_payments"      ON payments;
DROP POLICY IF EXISTS "auth_write_meter_readings" ON meter_readings;
DROP POLICY IF EXISTS "auth_write_maintenance"   ON maintenance_jobs;

CREATE POLICY "auth_write_members"
  ON members FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "auth_write_bills"
  ON bills FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "auth_write_payments"
  ON payments FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "auth_write_meter_readings"
  ON meter_readings FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "auth_write_maintenance"
  ON maintenance_jobs FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ─── 4. ตรวจสอบว่า RLS เปิดอยู่บน tables เหล่านี้ ──────────
-- ถ้า RLS ไม่ได้เปิด → policies ข้างบนไม่มีผล → ไม่ต้องทำอะไร
-- ถ้าต้องการเปิด RLS:
-- ALTER TABLE members       ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE bills         ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE payments      ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE meter_readings ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE maintenance_jobs ENABLE ROW LEVEL SECURITY;

-- ─── 5. หลัง migrate แล้ว: เปิด receipt_no ใน code ──────────
-- ไปที่ src/services/db-mapper.service.js → ฟังก์ชัน _pToDB
-- uncomment บรรทัด:  receipt_no: p.receiptNo || null,
