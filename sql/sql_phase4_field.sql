-- ══════════════════════════════════════════════════════════════
-- Phase 4 — งานจดมิเตอร์ภาคสนาม
-- (รันหลัง sql_phase3_accounting.sql)
--
--   1. มิเตอร์วนรอบ (เช่น 9990 → 0010): เก็บ prev_reading เลื่อนไป 1 รอบ (−10)
--      เพื่อให้ usage = curr − prev ถูกต้องโดยไม่ต้องแก้คอลัมน์ generated/view เดิม
--      แอปแปลงกลับเป็นเลขจริงตอนแสดงผล (คอลัมน์ rollover, meter_max)
--   2. บันทึกเหตุผลที่จดไม่ได้ (บ้านปิด/มิเตอร์เสีย/สุนัข/ประตูล็อก) — มิเตอร์เสียเปิดงานซ่อมให้อัตโนมัติ
--   3. ลำดับเส้นทางเดินจดมิเตอร์ (members.route_order)
--
-- วิธีติดตั้ง: SQL Editor → รันไฟล์นี้ทั้งไฟล์ (transaction เดียว, รันซ้ำได้)
-- ══════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.members ADD COLUMN IF NOT EXISTS route_order INT;
ALTER TABLE public.meter_readings
  ADD COLUMN IF NOT EXISTS rollover  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS meter_max INT;

-- ความถูกต้องของการวนรอบ: prev ที่เก็บต้องติดลบ และไม่เกิน 1 รอบ
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reading_rollover_valid') THEN
    ALTER TABLE public.meter_readings ADD CONSTRAINT reading_rollover_valid CHECK (
      NOT rollover OR (meter_max > 0 AND prev_reading < 0 AND prev_reading >= -(meter_max + 1) AND curr_reading <= meter_max)
    ) NOT VALID;
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════
-- จดไม่ได้
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.meter_skips (
  id           BIGSERIAL PRIMARY KEY,
  member_id    BIGINT NOT NULL REFERENCES public.members(id),
  period_year  SMALLINT NOT NULL,
  period_month SMALLINT NOT NULL,
  reason       TEXT NOT NULL CHECK (reason IN ('house_closed', 'meter_broken', 'dog', 'locked', 'other')),
  note         TEXT,
  created_by   UUID REFERENCES public.profiles(id),
  created_by_name TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (member_id, period_year, period_month)
);

DROP FUNCTION IF EXISTS public.record_meter_skip(BIGINT, TEXT, TEXT);
CREATE FUNCTION public.record_meter_skip(p_member_id BIGINT, p_reason TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_today DATE := app_private.today_th();
  v_y     INT  := extract(year FROM v_today)::INT + 543;
  v_m     INT  := extract(month FROM v_today)::INT;
  v_uid   UUID := app_private.jwt_profile_id();
  v_mem   public.members%ROWTYPE;
  v_row   public.meter_skips%ROWTYPE;
  v_job   TEXT;
BEGIN
  IF app_private.staff_role() IS NULL THEN RAISE EXCEPTION 'SESSION_REVOKED' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_mem FROM public.members WHERE id = p_member_id AND NOT COALESCE(is_deleted, false);
  IF v_mem.id IS NULL THEN RAISE EXCEPTION 'ไม่พบสมาชิก'; END IF;
  IF EXISTS (SELECT 1 FROM public.bills WHERE member_id = p_member_id AND period_year = v_y AND period_month = v_m
             AND status::TEXT <> 'cancelled') THEN
    RAISE EXCEPTION 'รอบนี้จดมิเตอร์/ออกบิลแล้ว';
  END IF;

  INSERT INTO public.meter_skips AS s (member_id, period_year, period_month, reason, note, created_by, created_by_name)
  VALUES (p_member_id, v_y, v_m, p_reason, NULLIF(trim(p_note), ''), v_uid, (SELECT full_name FROM public.profiles WHERE id = v_uid))
  ON CONFLICT (member_id, period_year, period_month) DO UPDATE
    SET reason = excluded.reason, note = excluded.note, created_by = excluded.created_by,
        created_by_name = excluded.created_by_name, created_at = now()
  RETURNING * INTO v_row;

  -- มิเตอร์เสีย → เปิดงานเปลี่ยนมิเตอร์ (ถ้ายังไม่มีงานค้าง) + แจ้งผู้ดูแล
  IF p_reason = 'meter_broken' AND NOT EXISTS (
    SELECT 1 FROM public.maintenance_jobs WHERE member_id = p_member_id AND type::TEXT = 'meter_replace'
      AND status::TEXT IN ('pending', 'in_progress')) THEN
    v_job := 'MNT-S' || (extract(epoch FROM clock_timestamp()) * 1000)::BIGINT;
    INSERT INTO public.maintenance_jobs (id, type, description, location, village_id, member_id, reported_by_type,
                                         reported_by, reported_date, status)
    VALUES (v_job, 'meter_replace', 'มิเตอร์เสีย (พบตอนจดมิเตอร์)' || COALESCE(': ' || NULLIF(trim(p_note), ''), ''),
            'บ้านเลขที่ ' || v_mem.house_no, v_mem.village_id, p_member_id, 'staff', v_uid, v_today, 'pending');
    PERFORM app_private.notify_roles(ARRAY['super_admin', 'village_admin'], 'meter_broken',
      'มิเตอร์เสีย ต้องเปลี่ยน', v_mem.first_name || ' ' || v_mem.last_name || ' · มิเตอร์ ' || v_mem.meter_no,
      'maintenance', v_job);
  END IF;

  RETURN to_jsonb(v_row) || jsonb_build_object('maintenance_job', v_job);
END;
$$;

-- ลำดับเส้นทาง: ตามลำดับใน array (ภายในหมู่บ้านเดียวกัน)
DROP FUNCTION IF EXISTS public.set_route_order(BIGINT[]);
CREATE FUNCTION public.set_route_order(p_member_ids BIGINT[])
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n INT;
BEGIN
  IF app_private.staff_role() IS NULL THEN RAISE EXCEPTION 'SESSION_REVOKED' USING ERRCODE = '28000'; END IF;
  UPDATE public.members m SET route_order = x.ord
  FROM unnest(p_member_ids) WITH ORDINALITY AS x(id, ord)
  WHERE m.id = x.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

ALTER TABLE public.meter_skips ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meter_skips FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.meter_skips_id_seq FROM anon, authenticated;
GRANT SELECT ON public.meter_skips TO authenticated;
DROP POLICY IF EXISTS staff_select ON public.meter_skips;
CREATE POLICY staff_select ON public.meter_skips FOR SELECT TO authenticated
  USING ((SELECT app_private.staff_role()) IS NOT NULL);

DROP TRIGGER IF EXISTS trg_audit_row ON public.meter_skips;
CREATE TRIGGER trg_audit_row AFTER INSERT OR UPDATE OR DELETE ON public.meter_skips
  FOR EACH ROW EXECUTE FUNCTION app_private.tg_audit_row();

REVOKE EXECUTE ON FUNCTION public.record_meter_skip(BIGINT, TEXT, TEXT), public.set_route_order(BIGINT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_meter_skip(BIGINT, TEXT, TEXT), public.set_route_order(BIGINT[]) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'meter_skips') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.meter_skips;
  END IF;
END $$;

COMMIT;
