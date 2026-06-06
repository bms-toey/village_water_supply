-- ─── Migration: Soft Delete for Members ─────────────────────
-- รันใน Supabase SQL Editor ก่อนใช้งาน Feature นี้
-- วันที่: 2026-06-06
-- ──────────────────────────────────────────────────────────────

-- 1. เพิ่ม Column สำหรับ Soft Delete
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS is_deleted   BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by   UUID REFERENCES auth.users(id);

-- 2. Index เพื่อกรอง Active Members เร็ว
CREATE INDEX IF NOT EXISTS idx_members_not_deleted
  ON members (id) WHERE is_deleted = FALSE;

-- 3. View สำหรับ Query Active Members โดยไม่ต้องใส่ WHERE ทุกครั้ง
CREATE OR REPLACE VIEW active_members AS
  SELECT * FROM members WHERE is_deleted = FALSE;

-- 4. ตรวจสอบ: ดูโครงสร้างที่เพิ่มแล้ว
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'members'
--   AND column_name IN ('is_deleted', 'deleted_at', 'deleted_by');
