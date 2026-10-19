-- ══════════════════════════════════════════════════════════════
-- Phase 1 — เอกสาร การรับเงิน และการปิดยอดแคชเชียร์
-- (รันหลัง sql_phase0_finance.sql)
--
--   1. บันทึกผู้รับเงิน/ผู้อนุมัติ/ผู้ยกเลิก จาก JWT อัตโนมัติ (ปลอมไม่ได้)
--   2. นับจำนวนครั้งที่พิมพ์ใบเสร็จ → ครั้งแรก "ต้นฉบับ" ครั้งต่อไป "สำเนา"
--   3. Storage: payment-slips (สลิปโอนเงิน), meter-photos (รูปมิเตอร์) — staff เท่านั้น
--   4. ปิดยอดประจำวันแคชเชียร์ + ใบนำส่งเงิน (เลขที่ CC-YYMM-NNNN)
--      หลังปิดยอด: รับเงินสด/ยกเลิกใบเสร็จของวันนั้นไม่ได้ จนกว่าผู้ดูแลจะเปิดยอดใหม่
--
-- วิธีติดตั้ง: SQL Editor → รันไฟล์นี้ทั้งไฟล์ (transaction เดียว, รันซ้ำได้)
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- 1. ผู้ทำรายการบน payments
-- ══════════════════════════════════════════════════════════════
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS created_by       UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS received_by_name TEXT,
  ADD COLUMN IF NOT EXISTS print_count      INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_by     TEXT;

CREATE INDEX IF NOT EXISTS idx_payments_created_by_paid ON public.payments(created_by, paid_at);

CREATE TABLE IF NOT EXISTS public.cash_closings (
  id             BIGSERIAL PRIMARY KEY,
  doc_no         TEXT NOT NULL UNIQUE,
  close_date     DATE NOT NULL,
  cashier_id     UUID NOT NULL REFERENCES public.profiles(id),
  cashier_name   TEXT,
  cash_count     INT NOT NULL DEFAULT 0,
  cash_total     NUMERIC(12,2) NOT NULL DEFAULT 0,
  transfer_count INT NOT NULL DEFAULT 0,
  transfer_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  counted_cash   NUMERIC(12,2) NOT NULL,
  diff           NUMERIC(12,2) GENERATED ALWAYS AS (counted_cash - cash_total) STORED,
  note           TEXT,
  created_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (close_date, cashier_id)
);

CREATE OR REPLACE FUNCTION app_private.paid_date_th(p_ts TIMESTAMPTZ)
RETURNS DATE LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT (p_ts AT TIME ZONE 'Asia/Bangkok')::DATE;
$$;

CREATE OR REPLACE FUNCTION app_private.cash_day_closed(p_cashier UUID, p_date DATE)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.cash_closings WHERE cashier_id = p_cashier AND close_date = p_date);
$$;

-- (ชื่อ trg_payment_a… ให้ทำงานหลัง trg_cash_auto_approve และก่อน trg_payment_receipt_no)
CREATE OR REPLACE FUNCTION app_private.tg_payment_actor()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid  UUID := app_private.jwt_profile_id();
  v_name TEXT;
BEGIN
  IF v_uid IS NOT NULL THEN
    SELECT full_name INTO v_name FROM public.profiles WHERE id = v_uid;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by       := COALESCE(v_uid, NEW.created_by);
    NEW.received_by_name := COALESCE(v_name, NEW.received_by_name);
    NEW.print_count      := 0;
    IF NEW.channel::TEXT = 'cash' AND NEW.created_by IS NOT NULL
       AND app_private.cash_day_closed(NEW.created_by, app_private.paid_date_th(COALESCE(NEW.paid_at, now()))) THEN
      RAISE EXCEPTION 'ปิดยอดประจำวันของคุณแล้ว — รับเงินสดเพิ่มไม่ได้ ติดต่อผู้ดูแลเพื่อเปิดยอดใหม่'
        USING ERRCODE = '55000';
    END IF;
  ELSE
    -- ข้อมูลผู้รับเงินและจำนวนครั้งพิมพ์แก้จากหน้าแอปไม่ได้
    NEW.created_by       := OLD.created_by;
    NEW.received_by_name := OLD.received_by_name;
    IF current_setting('app.allow_print_count', true) IS DISTINCT FROM 'on' THEN
      NEW.print_count := OLD.print_count;
    END IF;
  END IF;

  IF NEW.status::TEXT = 'approved' AND (TG_OP = 'INSERT' OR OLD.status::TEXT <> 'approved') THEN
    NEW.approved_by := COALESCE(v_uid, NEW.approved_by);
    NEW.approved_at := COALESCE(NEW.approved_at, now());
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status::TEXT IN ('cancelled', 'rejected') AND OLD.status::TEXT = 'approved' THEN
    IF OLD.channel::TEXT = 'cash' AND OLD.created_by IS NOT NULL
       AND app_private.cash_day_closed(OLD.created_by, app_private.paid_date_th(OLD.paid_at)) THEN
      RAISE EXCEPTION 'ใบเสร็จนี้อยู่ในยอดที่ปิดประจำวันแล้ว — ยกเลิกไม่ได้ ติดต่อผู้ดูแลเพื่อเปิดยอดใหม่'
        USING ERRCODE = '55000';
    END IF;
    NEW.cancelled_by := COALESCE(v_name, NEW.cancelled_by);
    NEW.cancelled_at := COALESCE(NEW.cancelled_at, now());
  END IF;

  RETURN NEW;
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 2. ปิดยอดประจำวัน
-- ══════════════════════════════════════════════════════════════


DROP TRIGGER IF EXISTS trg_payment_actor ON public.payments;
CREATE TRIGGER trg_payment_actor
  BEFORE INSERT OR UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION app_private.tg_payment_actor();

-- เพิ่มประเภทเอกสาร CC (ใบนำส่งเงิน) ให้ตัวออกเลข
CREATE OR REPLACE FUNCTION app_private.next_doc_no(p_kind TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_today  DATE := app_private.today_th();
  v_period TEXT := lpad(((extract(year FROM v_today)::INT + 543) % 100)::TEXT, 2, '0')
                || lpad(extract(month FROM v_today)::TEXT, 2, '0');
  v_prefix TEXT := p_kind || '-' || v_period || '-';
  v_seed   INT;
  v_no     INT;
BEGIN
  IF p_kind NOT IN ('B', 'R', 'CN', 'DN', 'CC') THEN
    RAISE EXCEPTION 'ประเภทเอกสารไม่ถูกต้อง: %', p_kind;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.doc_counters WHERE kind = p_kind AND period = v_period) THEN
    SELECT COALESCE(max(substring(x FROM length(v_prefix) + 1)::INT), 0) INTO v_seed
    FROM (
      SELECT id AS x FROM public.bills WHERE p_kind = 'B'
      UNION ALL SELECT receipt_no FROM public.payments WHERE p_kind = 'R'
      UNION ALL SELECT doc_no FROM public.bill_adjustments WHERE p_kind IN ('CN', 'DN')
      UNION ALL SELECT doc_no FROM public.cash_closings WHERE p_kind = 'CC'
    ) s
    WHERE x LIKE v_prefix || '%' AND substring(x FROM length(v_prefix) + 1) ~ '^[0-9]{1,9}$';
  END IF;

  INSERT INTO public.doc_counters AS c (kind, period, last_no)
  VALUES (p_kind, v_period, COALESCE(v_seed, 0) + 1)
  ON CONFLICT (kind, period) DO UPDATE SET last_no = c.last_no + 1
  RETURNING last_no INTO v_no;

  RETURN v_prefix || lpad(v_no::TEXT, 4, '0');
END;
$$;

-- สรุปยอดรับเงินของแคชเชียร์ในวันหนึ่ง (staff ดูของตัวเอง, admin/finance ดูของทุกคน)
DROP FUNCTION IF EXISTS public.get_cash_summary(DATE, UUID);
CREATE FUNCTION public.get_cash_summary(p_date DATE, p_cashier UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_me      UUID := app_private.jwt_profile_id();
  v_role    TEXT := app_private.staff_role();
  v_cashier UUID := COALESCE(p_cashier, v_me);
BEGIN
  IF v_role IS NULL THEN RAISE EXCEPTION 'SESSION_REVOKED' USING ERRCODE = '28000'; END IF;
  IF v_cashier <> v_me AND v_role NOT IN ('super_admin', 'village_admin', 'finance') THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ดูยอดของผู้อื่น' USING ERRCODE = '42501';
  END IF;

  RETURN (
    WITH p AS (
      SELECT x.*, (x.channel::TEXT = 'cash') AS is_cash
      FROM public.payments x
      WHERE x.created_by = v_cashier
        AND x.status::TEXT = 'approved'
        AND app_private.paid_date_th(x.paid_at) = p_date
    )
    SELECT jsonb_build_object(
      'date',           p_date,
      'cashier_id',     v_cashier,
      'cashier_name',   (SELECT full_name FROM public.profiles WHERE id = v_cashier),
      'cash_count',     (SELECT count(*) FROM p WHERE is_cash),
      'cash_total',     (SELECT COALESCE(sum(amount), 0) FROM p WHERE is_cash),
      'transfer_count', (SELECT count(*) FROM p WHERE NOT is_cash),
      'transfer_total', (SELECT COALESCE(sum(amount), 0) FROM p WHERE NOT is_cash),
      'payments', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'receipt_no', p.receipt_no, 'bill_id', p.bill_id, 'amount', p.amount,
          'channel', p.channel, 'paid_at', p.paid_at,
          'member', m.first_name || ' ' || m.last_name, 'house_no', m.house_no
        ) ORDER BY p.paid_at)
        FROM p LEFT JOIN public.members m ON m.id = p.member_id), '[]'::JSONB),
      'closing', (SELECT to_jsonb(c) FROM public.cash_closings c
                  WHERE c.cashier_id = v_cashier AND c.close_date = p_date)
    )
  );
END;
$$;

-- ปิดยอดของตัวเอง — ระบบคำนวณยอดจากข้อมูลจริง ผู้ใช้กรอกเฉพาะเงินสดที่นับได้
DROP FUNCTION IF EXISTS public.close_cash_day(DATE, NUMERIC, TEXT);
CREATE FUNCTION public.close_cash_day(p_date DATE, p_counted NUMERIC, p_note TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_me  UUID := app_private.jwt_profile_id();
  v_sum JSONB;
  v_row public.cash_closings%ROWTYPE;
BEGIN
  IF app_private.staff_role() IS NULL THEN RAISE EXCEPTION 'SESSION_REVOKED' USING ERRCODE = '28000'; END IF;
  IF p_counted IS NULL OR p_counted < 0 THEN RAISE EXCEPTION 'กรุณากรอกจำนวนเงินสดที่นับได้'; END IF;
  IF p_date > app_private.today_th() THEN RAISE EXCEPTION 'ปิดยอดล่วงหน้าไม่ได้'; END IF;
  IF app_private.cash_day_closed(v_me, p_date) THEN RAISE EXCEPTION 'ปิดยอดวันนี้ไปแล้ว'; END IF;

  v_sum := public.get_cash_summary(p_date, v_me);
  IF round(p_counted - (v_sum ->> 'cash_total')::NUMERIC, 2) <> 0 AND NULLIF(trim(p_note), '') IS NULL THEN
    RAISE EXCEPTION 'ยอดเงินสดไม่ตรงกับระบบ — กรุณาระบุหมายเหตุ';
  END IF;

  INSERT INTO public.cash_closings (doc_no, close_date, cashier_id, cashier_name, cash_count, cash_total,
                                    transfer_count, transfer_total, counted_cash, note)
  VALUES (app_private.next_doc_no('CC'), p_date, v_me, v_sum ->> 'cashier_name',
          (v_sum ->> 'cash_count')::INT, (v_sum ->> 'cash_total')::NUMERIC,
          (v_sum ->> 'transfer_count')::INT, (v_sum ->> 'transfer_total')::NUMERIC,
          round(p_counted, 2), NULLIF(trim(p_note), ''))
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

-- เปิดยอดใหม่ (ลบการปิดยอด) — super_admin/finance พร้อมเหตุผล บันทึกใน audit
DROP FUNCTION IF EXISTS public.reopen_cash_day(BIGINT, TEXT);
CREATE FUNCTION public.reopen_cash_day(p_id BIGINT, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_role(ARRAY['super_admin', 'finance']);
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'กรุณาระบุเหตุผล'; END IF;
  INSERT INTO public.audit_logs (table_name, record_id, action, old_data, new_data, performed_by)
  SELECT 'cash_closings', c.id::TEXT, 'reopen', to_jsonb(c), jsonb_build_object('reason', trim(p_reason)), 'system'
  FROM public.cash_closings c WHERE c.id = p_id;
  DELETE FROM public.cash_closings WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบรายการปิดยอด'; END IF;
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 3. นับการพิมพ์ใบเสร็จ (ต้นฉบับ / สำเนา)
-- ══════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.mark_receipt_printed(TEXT);
CREATE FUNCTION public.mark_receipt_printed(p_payment_id TEXT)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_count INT;
BEGIN
  IF app_private.staff_role() IS NULL THEN RAISE EXCEPTION 'SESSION_REVOKED' USING ERRCODE = '28000'; END IF;
  PERFORM set_config('app.allow_print_count', 'on', true);
  UPDATE public.payments SET print_count = print_count + 1
  WHERE id = p_payment_id
  RETURNING print_count INTO v_count;
  PERFORM set_config('app.allow_print_count', 'off', true);
  IF v_count IS NULL THEN RAISE EXCEPTION 'ไม่พบรายการชำระเงิน'; END IF;
  RETURN v_count;
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 4. Storage — สลิปโอนเงิน + รูปมิเตอร์ (ส่วนตัว, ไฟล์รูปไม่เกิน 5MB)
-- ══════════════════════════════════════════════════════════════
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('payment-slips', 'payment-slips', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('meter-photos',  'meter-photos',  false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

DROP POLICY IF EXISTS aquaflow_staff_read   ON storage.objects;
DROP POLICY IF EXISTS aquaflow_staff_upload ON storage.objects;
CREATE POLICY aquaflow_staff_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id IN ('payment-slips', 'meter-photos') AND (SELECT app_private.staff_role()) IS NOT NULL);
-- อัปโหลดได้อย่างเดียว ไม่มีสิทธิ์แก้/ลบ (หลักฐานต้องไม่ถูกเปลี่ยน)
CREATE POLICY aquaflow_staff_upload ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('payment-slips', 'meter-photos') AND (SELECT app_private.staff_role()) IS NOT NULL);

-- ══════════════════════════════════════════════════════════════
-- 5. สิทธิ์ + RLS + audit + realtime
-- ══════════════════════════════════════════════════════════════
ALTER TABLE public.cash_closings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cash_closings FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.cash_closings_id_seq FROM anon, authenticated;
GRANT SELECT ON public.cash_closings TO authenticated;
DROP POLICY IF EXISTS own_or_finance_select ON public.cash_closings;
CREATE POLICY own_or_finance_select ON public.cash_closings FOR SELECT TO authenticated
  USING (cashier_id = app_private.jwt_profile_id()
         OR (SELECT app_private.staff_role()) IN ('super_admin', 'village_admin', 'finance'));

DROP TRIGGER IF EXISTS trg_audit_row ON public.cash_closings;
CREATE TRIGGER trg_audit_row AFTER INSERT OR UPDATE OR DELETE ON public.cash_closings
  FOR EACH ROW EXECUTE FUNCTION app_private.tg_audit_row();

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC, anon;
GRANT  EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_cash_summary(DATE, UUID), public.close_cash_day(DATE, NUMERIC, TEXT),
  public.reopen_cash_day(BIGINT, TEXT), public.mark_receipt_printed(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cash_summary(DATE, UUID), public.close_cash_day(DATE, NUMERIC, TEXT),
  public.reopen_cash_day(BIGINT, TEXT), public.mark_receipt_printed(TEXT) TO authenticated;

COMMIT;
