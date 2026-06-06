-- ═══════════════════════════════════════════════════════════════
--  AquaFlow Pro — System Settings Migration
--  รัน SQL นี้ใน Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. master_data — ตารางข้อมูล Master / Lookup ─────────────
CREATE TABLE IF NOT EXISTS master_data (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  category     TEXT        NOT NULL,
  code         TEXT        NOT NULL,
  name_th      TEXT        NOT NULL,
  name_en      TEXT,
  description  TEXT,
  icon         TEXT,
  color        TEXT,
  metadata     JSONB       DEFAULT '{}',
  sort_order   INTEGER     DEFAULT 0,
  is_active    BOOLEAN     DEFAULT true,
  created_by   TEXT        DEFAULT 'system',
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_by   TEXT,
  updated_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(category, code)
);

-- ─── 2. audit_logs — บันทึกประวัติการเปลี่ยนแปลง ───────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  table_name   TEXT        NOT NULL,
  record_id    TEXT,
  action       TEXT        NOT NULL,
  old_data     JSONB,
  new_data     JSONB,
  performed_by TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- ─── 3. system_config — ตั้งค่าระบบทั่วไป ──────────────────────
CREATE TABLE IF NOT EXISTS system_config (
  key          TEXT        PRIMARY KEY,
  value        TEXT,
  value_json   JSONB,
  description  TEXT,
  updated_by   TEXT,
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- ─── 4. villages: เพิ่ม is_active ────────────────────────────
ALTER TABLE villages ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE villages ADD COLUMN IF NOT EXISTS description TEXT;

-- ─── 5. Seed: ประเภทสมาชิก ────────────────────────────────────
INSERT INTO master_data (category, code, name_th, name_en, icon, color, sort_order, metadata) VALUES
  ('member_type', 'residential', 'บ้านอยู่อาศัย',  'Residential', 'ti-home',          '#0058be', 1, '{"cls":"mtype-residential"}'),
  ('member_type', 'commercial',  'พาณิชยกรรม',      'Commercial',  'ti-building-store','#d97706', 2, '{"cls":"mtype-commercial"}'),
  ('member_type', 'agriculture', 'เกษตรกรรม',       'Agriculture', 'ti-plant',         '#16a34a', 3, '{"cls":"mtype-agriculture"}'),
  ('member_type', 'institution', 'หน่วยงาน',        'Institution', 'ti-building',      '#7c3aed', 4, '{"cls":"mtype-institution"}')
ON CONFLICT (category, code) DO NOTHING;

-- ─── 6. Seed: ขนาดมิเตอร์ ─────────────────────────────────────
INSERT INTO master_data (category, code, name_th, name_en, icon, color, sort_order, metadata) VALUES
  ('meter_size', '0.5',  '½" (13 มม.)',   'Half Inch',             'ti-gauge','#0058be', 1, '{"display":"½\"","svc":"small"}'),
  ('meter_size', '0.75', '¾" (19 มม.)',   'Three Quarter Inch',    'ti-gauge','#16a34a', 2, '{"display":"¾\"","svc":"small"}'),
  ('meter_size', '1',    '1" (25 มม.)',   'One Inch',              'ti-gauge','#d97706', 3, '{"display":"1\"","svc":"large"}'),
  ('meter_size', '1.5',  '1½" (38 มม.)',  'One and Half Inch',     'ti-gauge','#dc2626', 4, '{"display":"1½\"","svc":"large"}')
ON CONFLICT (category, code) DO NOTHING;

-- ─── 7. Seed: ช่องทางชำระเงิน ──────────────────────────────────
INSERT INTO master_data (category, code, name_th, name_en, icon, color, sort_order) VALUES
  ('payment_channel', 'promptpay', 'PromptPay',    'PromptPay',     'ti-qrcode',         '#0058be', 1),
  ('payment_channel', 'bank',      'โอนธนาคาร',   'Bank Transfer', 'ti-building-bank',  '#16a34a', 2),
  ('payment_channel', 'cash',      'เงินสด',       'Cash',          'ti-cash',           '#d97706', 3),
  ('payment_channel', 'mobile',    'Mobile App',   'Mobile App',    'ti-device-mobile',  '#7c3aed', 4)
ON CONFLICT (category, code) DO NOTHING;

-- ─── 8. Seed: ประเภทงานซ่อมบำรุง ──────────────────────────────
INSERT INTO master_data (category, code, name_th, name_en, icon, color, sort_order, metadata) VALUES
  ('maintenance_type', 'pipe_repair',   'ซ่อมท่อ',          'Pipe Repair',    'ti-tool',               '#dc2626', 1, '{"cls":"pill-overdue"}'),
  ('maintenance_type', 'meter_replace', 'เปลี่ยนมิเตอร์',   'Meter Replace',  'ti-gauge',              '#d97706', 2, '{"cls":"pill-pending"}'),
  ('maintenance_type', 'tank_clean',    'ล้างถังพัก',        'Tank Clean',     'ti-droplet',            '#0058be', 3, '{"cls":"pill-pending"}'),
  ('maintenance_type', 'pump_service',  'บำรุงปั๊มน้ำ',      'Pump Service',   'ti-engine',             '#16a34a', 4, '{"cls":"pill-pending"}'),
  ('maintenance_type', 'leak_fix',      'แก้ไขรั่วซึม',      'Leak Fix',       'ti-droplet-exclamation','#dc2626', 5, '{"cls":"pill-overdue"}'),
  ('maintenance_type', 'other',         'อื่น ๆ',            'Other',          'ti-dots',               '#6b7280', 6, '{"cls":"pill-normal"}')
ON CONFLICT (category, code) DO NOTHING;

-- ─── 9. Seed: ประเภทความผิดปกติ ────────────────────────────────
INSERT INTO master_data (category, code, name_th, name_en, icon, color, sort_order) VALUES
  ('anomaly_type', 'high_usage',     'ใช้สูงผิดปกติ', 'High Usage',     'ti-flame',               '#dc2626', 1),
  ('anomaly_type', 'meter_fault',    'มิเตอร์เสีย',   'Meter Fault',    'ti-gauge-off',           '#d97706', 2),
  ('anomaly_type', 'suspected_leak', 'สงสัยรั่ว',     'Suspected Leak', 'ti-droplet-exclamation', '#0058be', 3)
ON CONFLICT (category, code) DO NOTHING;

-- ─── 10. Seed: วิธีจดมิเตอร์ ──────────────────────────────────
INSERT INTO master_data (category, code, name_th, name_en, icon, color, sort_order) VALUES
  ('reading_method', 'manual',  'จดด้วยมือ', 'Manual',    'ti-pencil',     '#444651', 1),
  ('reading_method', 'ai_scan', 'AI Scan',   'AI Scan',   'ti-robot',      '#7c3aed', 2),
  ('reading_method', 'remote',  'Remote IoT','Remote',    'ti-wifi',       '#0058be', 3)
ON CONFLICT (category, code) DO NOTHING;

-- ─── 11. Seed: system_config ──────────────────────────────────
INSERT INTO system_config (key, value, description) VALUES
  ('org_name',           'ประปาหมู่บ้าน',     'ชื่อองค์กร'),
  ('org_address',        '',                  'ที่อยู่องค์กร'),
  ('org_phone',          '',                  'เบอร์โทรติดต่อ'),
  ('billing_due_days',   '15',                'จำนวนวันครบกำหนดชำระ นับจากวันออกบิล'),
  ('line_notify_token',  '',                  'LINE Notify Token สำหรับส่งการแจ้งเตือน'),
  ('late_fee_per_month', '50',                'ค่าปรับล่าช้าต่อเดือน (บาท)'),
  ('svc_charge_small',   '20',                'ค่าบริการรายเดือน มิเตอร์ขนาดเล็ก ½" และ ¾" (บาท)'),
  ('svc_charge_large',   '30',                'ค่าบริการรายเดือน มิเตอร์ขนาดใหญ่ 1" และ 1½" (บาท)')
ON CONFLICT (key) DO NOTHING;

-- ─── 12. RLS for new tables ────────────────────────────────────
DROP POLICY IF EXISTS "auth_read_master_data"  ON master_data;
DROP POLICY IF EXISTS "auth_write_master_data" ON master_data;
DROP POLICY IF EXISTS "auth_read_audit_logs"   ON audit_logs;
DROP POLICY IF EXISTS "auth_write_audit_logs"  ON audit_logs;
DROP POLICY IF EXISTS "auth_read_system_config"  ON system_config;
DROP POLICY IF EXISTS "auth_write_system_config" ON system_config;

CREATE POLICY "auth_read_master_data"  ON master_data   FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_master_data" ON master_data   FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_read_audit_logs"   ON audit_logs    FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_audit_logs"  ON audit_logs    FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_read_system_config"  ON system_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_system_config" ON system_config FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- Enable RLS if not already
ALTER TABLE master_data   ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;

-- ─── 13. Index for performance ────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_master_data_category ON master_data(category, sort_order);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created   ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table     ON audit_logs(table_name, created_at DESC);

-- ─── 14. ตรวจ rate_tiers: tier สุดท้ายต้องมี to_unit = NULL ──
-- หาก rate_tiers table มีอยู่แล้ว — แก้ tier ที่ from_unit=61 ให้ to_unit=NULL
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='rate_tiers') THEN
    UPDATE rate_tiers SET to_unit = NULL WHERE from_unit = 61 AND to_unit IS NOT NULL;
    -- สร้าง tier 61+ ถ้ายังไม่มี
    INSERT INTO rate_tiers (from_unit, to_unit, rate_per_unit)
    VALUES (61, NULL, 15)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
