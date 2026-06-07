-- ══════════════════════════════════════════════════════════════
-- FIX: last_read ไม่ reset เมื่อลบ meter_readings ออกจาก DB
--
-- รัน SQL นี้ใน Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════════════════

-- ── STEP 1: Reset last_read สำหรับสมาชิกทุกคน ────────────────
-- คำนวณใหม่จาก meter_readings ที่เหลืออยู่
-- ถ้าไม่มี reading เหลือ → reset เป็น 0
UPDATE public.members m
SET
  last_read      = COALESCE(
    (SELECT curr_reading
     FROM public.meter_readings
     WHERE member_id = m.id
     ORDER BY reading_date DESC, id DESC
     LIMIT 1),
    0
  ),
  last_read_date = (
    SELECT reading_date
    FROM public.meter_readings
    WHERE member_id = m.id
    ORDER BY reading_date DESC, id DESC
    LIMIT 1
  ),
  updated_at     = now()
WHERE m.is_deleted = false;

-- ── STEP 2: เพิ่ม trigger ที่ยัง missing ─────────────────────
-- trigger เดิม (trg_update_last_read) ทำงานแค่ AFTER INSERT
-- เพิ่ม trigger สำหรับ DELETE ด้วย — เมื่อลบ reading ออก
-- ให้ last_read คืนค่าจาก reading ที่เหลือ (หรือ 0)

CREATE OR REPLACE FUNCTION public.fn_update_last_read_on_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.members
  SET
    last_read      = COALESCE(
      (SELECT curr_reading
       FROM public.meter_readings
       WHERE member_id = OLD.member_id
       ORDER BY reading_date DESC, id DESC
       LIMIT 1),
      0
    ),
    last_read_date = (
      SELECT reading_date
      FROM public.meter_readings
      WHERE member_id = OLD.member_id
      ORDER BY reading_date DESC, id DESC
      LIMIT 1
    ),
    updated_at = now()
  WHERE id = OLD.member_id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_last_read_delete ON public.meter_readings;

CREATE TRIGGER trg_update_last_read_delete
  AFTER DELETE ON public.meter_readings
  FOR EACH ROW EXECUTE FUNCTION public.fn_update_last_read_on_delete();

-- ══════════════════════════════════════════════════════════════
-- หลังรันแล้ว: reload แอปใหม่ — ค่า last_read จะถูกต้อง
-- ══════════════════════════════════════════════════════════════
