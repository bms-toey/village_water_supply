-- ══════════════════════════════════════════════════════════════
-- Phase 0 — ความถูกต้องทางการเงิน
-- (รันหลัง sql_secure_auth.sql)
--
--   1. เลขที่เอกสารออกโดย server  — บิล B-YYMM-NNNN, ใบเสร็จ R-YYMM-NNNN,
--      ใบลดหนี้ CN-YYMM-NNNN, ใบเพิ่มหนี้ DN-YYMM-NNNN (YY = ปี พ.ศ.)
--      ไม่ซ้ำแม้หลายคนบันทึกพร้อมกัน
--   2. ปิดงวดบิล — งวดที่ปิดแล้วแก้ยอด/ยกเลิกบิลไม่ได้
--      ต้องปรับผ่านใบลดหนี้/ใบเพิ่มหนี้ (adjust_bill)
--   3. สถานะค้างชำระ + ค่าปรับล่าช้า คำนวณที่ server ทุกวัน (pg_cron)
--   4. Audit log อัตโนมัติทุกการเปลี่ยนแปลงของบิล/การชำระเงิน
--   5. export_backup() — ส่งออกข้อมูลทั้งหมดเป็น JSON
--
-- วิธีติดตั้ง: SQL Editor → รันไฟล์นี้ทั้งไฟล์ (transaction เดียว, รันซ้ำได้)
-- ถ้ายังไม่ได้เปิด pg_cron: Dashboard → Database → Extensions → pg_cron
-- (ถ้าไม่เปิด ระบบยังทำงานได้ — แอปจะสั่งคำนวณเองทุกครั้งที่เปิด)
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- 0. Helpers
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION app_private.today_th()
RETURNS DATE LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (now() AT TIME ZONE 'Asia/Bangkok')::DATE;
$$;

-- ผู้ใช้ปัจจุบันต้องมี role ใด role หนึ่งที่ระบุ
CREATE OR REPLACE FUNCTION app_private.require_role(p_roles TEXT[])
RETURNS VOID LANGUAGE plpgsql STABLE SET search_path = '' AS $$
BEGIN
  IF app_private.staff_role() IS NULL OR NOT (app_private.staff_role() = ANY (p_roles)) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ดำเนินการนี้' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- trigger เดิม (fn_sync_member_status ฯลฯ) อ้างชื่อตารางไม่ระบุ schema — ถ้าถูกเรียกต่อจาก
-- ฟังก์ชันที่ตั้ง search_path = '' จะหาตารางไม่เจอ จึงกำหนด search_path ให้ชัดเจน
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS fn
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prorettype = 'trigger'::regtype AND p.proconfig IS NULL
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions', r.fn);
  END LOOP;
END $$;

-- master_data ใช้รหัสขนาดมิเตอร์ '1' แต่ enum มีแค่ '1.0' → บันทึกสมาชิกมิเตอร์ 1" ไม่ได้
DO $$
BEGIN
  IF to_regtype('public.meter_size_type') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_enum WHERE enumtypid = 'public.meter_size_type'::regtype AND enumlabel = '1'
  ) THEN
    ALTER TYPE public.meter_size_type ADD VALUE '1';
  END IF;
END $$;

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS receipt_no TEXT;
ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_by  TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at  TIMESTAMPTZ;

-- ══════════════════════════════════════════════════════════════
-- 1. เลขที่เอกสาร
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.doc_counters (
  kind    TEXT NOT NULL,          -- B / R / CN / DN
  period  TEXT NOT NULL,          -- YYMM (พ.ศ.)
  last_no INT  NOT NULL,
  PRIMARY KEY (kind, period)
);

-- คืนเลขถัดไป เช่น R-6910-0001 — ครั้งแรกของแต่ละเดือนจะต่อจากเลขสูงสุดที่มีอยู่แล้ว
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
  IF p_kind NOT IN ('B', 'R', 'CN', 'DN') THEN
    RAISE EXCEPTION 'ประเภทเอกสารไม่ถูกต้อง: %', p_kind;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.doc_counters WHERE kind = p_kind AND period = v_period) THEN
    SELECT COALESCE(max(substring(x FROM length(v_prefix) + 1)::INT), 0) INTO v_seed
    FROM (
      SELECT id AS x FROM public.bills WHERE p_kind = 'B'
      UNION ALL SELECT receipt_no FROM public.payments WHERE p_kind = 'R'
      UNION ALL SELECT doc_no FROM public.bill_adjustments WHERE p_kind IN ('CN', 'DN')
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

-- ══════════════════════════════════════════════════════════════
-- 2. งวดบิล + ใบลดหนี้/เพิ่มหนี้
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.billing_periods (
  period_year  SMALLINT NOT NULL,
  period_month SMALLINT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at    TIMESTAMPTZ,
  closed_by    UUID REFERENCES public.profiles(id),
  note         TEXT,
  updated_at   TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (period_year, period_month)
);

CREATE TABLE IF NOT EXISTS public.bill_adjustments (
  id         BIGSERIAL PRIMARY KEY,
  doc_no     TEXT NOT NULL UNIQUE,
  bill_id    TEXT NOT NULL REFERENCES public.bills(id),
  amount     NUMERIC(10,2) NOT NULL CHECK (amount <> 0),  -- + เพิ่มหนี้, − ลดหนี้
  reason     TEXT NOT NULL,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bill_adjustments_bill ON public.bill_adjustments(bill_id);

CREATE OR REPLACE FUNCTION app_private.period_closed(p_year INT, p_month INT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.billing_periods
                 WHERE period_year = p_year AND period_month = p_month AND status = 'closed');
$$;

-- ── Trigger บน bills: เลขบิล + ล็อกงวด ─────────────────────────
CREATE OR REPLACE FUNCTION app_private.tg_bills_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_label TEXT;
BEGIN
  IF TG_OP = 'INSERT' AND COALESCE(NEW.id, '') = '' THEN
    NEW.id := app_private.next_doc_no('B');
  END IF;

  IF current_setting('app.bypass_period_lock', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') AND app_private.period_closed(OLD.period_year, OLD.period_month) THEN
    v_label := OLD.period_label;
    IF TG_OP = 'DELETE'
       OR NEW.member_id      IS DISTINCT FROM OLD.member_id
       OR NEW.period_year    IS DISTINCT FROM OLD.period_year
       OR NEW.period_month   IS DISTINCT FROM OLD.period_month
       OR NEW.usage          IS DISTINCT FROM OLD.usage
       OR NEW.water_charge   IS DISTINCT FROM OLD.water_charge
       OR NEW.service_charge IS DISTINCT FROM OLD.service_charge
       OR NEW.discount       IS DISTINCT FROM OLD.discount
       OR NEW.issue_date     IS DISTINCT FROM OLD.issue_date
       OR NEW.due_date       IS DISTINCT FROM OLD.due_date
       OR (NEW.status = 'cancelled') <> (OLD.status = 'cancelled')
    THEN
      RAISE EXCEPTION 'งวด % ปิดแล้ว — แก้ไขหรือยกเลิกบิลไม่ได้ ให้ใช้ "ปรับปรุงยอด" (ใบลดหนี้/เพิ่มหนี้) แทน', v_label
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND app_private.period_closed(NEW.period_year, NEW.period_month)
     AND (TG_OP = 'INSERT' OR NEW.period_year <> OLD.period_year OR NEW.period_month <> OLD.period_month) THEN
    RAISE EXCEPTION 'งวด % ปิดแล้ว — ออกบิลใหม่ในงวดนี้ไม่ได้', NEW.period_label USING ERRCODE = '55000';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_bills_guard ON public.bills;
CREATE TRIGGER trg_bills_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.bills
  FOR EACH ROW EXECUTE FUNCTION app_private.tg_bills_guard();

-- ── Trigger บน payments: ออกเลขใบเสร็จเมื่ออนุมัติ ───────────────
-- (ชื่อขึ้นต้น trg_payment_r… ให้ทำงานหลัง trg_cash_auto_approve)
CREATE OR REPLACE FUNCTION app_private.tg_payment_receipt_no()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status::TEXT = 'approved' AND COALESCE(NEW.receipt_no, '') = '' THEN
    NEW.receipt_no := app_private.next_doc_no('R');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_receipt_no ON public.payments;
CREATE TRIGGER trg_payment_receipt_no
  BEFORE INSERT OR UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION app_private.tg_payment_receipt_no();

DO $$
BEGIN
  IF EXISTS (SELECT receipt_no FROM public.payments WHERE receipt_no IS NOT NULL
             GROUP BY receipt_no HAVING count(*) > 1) THEN
    RAISE NOTICE 'พบเลขใบเสร็จซ้ำในข้อมูลเดิม — ยังไม่สร้าง unique index (ตรวจด้วย: SELECT receipt_no, count(*) FROM payments GROUP BY 1 HAVING count(*) > 1)';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_receipt_no ON public.payments(receipt_no) WHERE receipt_no IS NOT NULL;
  END IF;
END $$;

-- ── RPC: รายการงวด + สรุปยอด ─────────────────────────────────
DROP FUNCTION IF EXISTS public.get_billing_periods();
CREATE FUNCTION public.get_billing_periods()
RETURNS TABLE (
  period_year   SMALLINT,
  period_month  SMALLINT,
  period_label  TEXT,
  status        TEXT,
  bill_count    INT,
  billed_total  NUMERIC,
  paid_total    NUMERIC,
  unpaid_total  NUMERIC,
  closed_at     TIMESTAMPTZ,
  closed_by     TEXT,
  note          TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF app_private.staff_role() IS NULL THEN
    RAISE EXCEPTION 'SESSION_REVOKED' USING ERRCODE = '28000';
  END IF;
  RETURN QUERY
    WITH b AS (
      SELECT x.period_year, x.period_month, max(x.period_label) AS period_label,
             count(*) FILTER (WHERE x.status <> 'cancelled')::INT AS bill_count,
             COALESCE(sum(x.total) FILTER (WHERE x.status <> 'cancelled'), 0) AS billed_total,
             COALESCE(sum(x.total) FILTER (WHERE x.status = 'paid'), 0) AS paid_total,
             COALESCE(sum(x.total) FILTER (WHERE x.status IN ('pending', 'overdue')), 0) AS unpaid_total
      FROM public.bills x
      GROUP BY x.period_year, x.period_month
    )
    SELECT COALESCE(b.period_year, p.period_year), COALESCE(b.period_month, p.period_month),
           b.period_label, COALESCE(p.status, 'open'),
           COALESCE(b.bill_count, 0), COALESCE(b.billed_total, 0),
           COALESCE(b.paid_total, 0), COALESCE(b.unpaid_total, 0),
           p.closed_at, pr.full_name, p.note
    FROM b
    FULL JOIN public.billing_periods p
      ON p.period_year = b.period_year AND p.period_month = b.period_month
    LEFT JOIN public.profiles pr ON pr.id = p.closed_by
    ORDER BY 1 DESC, 2 DESC;
END;
$$;

DROP FUNCTION IF EXISTS public.close_billing_period(INT, INT, TEXT);
CREATE FUNCTION public.close_billing_period(p_year INT, p_month INT, p_note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_today DATE := app_private.today_th();
BEGIN
  PERFORM app_private.require_role(ARRAY['super_admin', 'village_admin', 'finance']);
  IF p_month NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'เดือนไม่ถูกต้อง'; END IF;
  IF (p_year - 543) * 12 + p_month > extract(year FROM v_today) * 12 + extract(month FROM v_today) THEN
    RAISE EXCEPTION 'ปิดงวดล่วงหน้าไม่ได้';
  END IF;

  INSERT INTO public.billing_periods AS bp (period_year, period_month, status, closed_at, closed_by, note, updated_at)
  VALUES (p_year, p_month, 'closed', now(), app_private.jwt_profile_id(), NULLIF(trim(p_note), ''), now())
  ON CONFLICT (period_year, period_month) DO UPDATE
    SET status = 'closed', closed_at = now(), closed_by = app_private.jwt_profile_id(),
        note = COALESCE(NULLIF(trim(p_note), ''), bp.note), updated_at = now();
END;
$$;

DROP FUNCTION IF EXISTS public.reopen_billing_period(INT, INT, TEXT);
CREATE FUNCTION public.reopen_billing_period(p_year INT, p_month INT, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_super_admin();
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'กรุณาระบุเหตุผลการเปิดงวด'; END IF;
  UPDATE public.billing_periods
  SET status = 'open', note = 'เปิดงวดใหม่: ' || trim(p_reason), updated_at = now()
  WHERE period_year = p_year AND period_month = p_month AND status = 'closed';
  IF NOT FOUND THEN RAISE EXCEPTION 'งวดนี้ยังไม่ได้ปิด'; END IF;
END;
$$;

-- ปรับปรุงยอดบิลที่ยังไม่ชำระ: p_amount > 0 เพิ่มหนี้, < 0 ลดหนี้
-- ทำได้แม้งวดปิดแล้ว — มีเลขเอกสาร CN/DN และบันทึก audit ทุกครั้ง
DROP FUNCTION IF EXISTS public.adjust_bill(TEXT, NUMERIC, TEXT);
CREATE FUNCTION public.adjust_bill(p_bill_id TEXT, p_amount NUMERIC, p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_bill   public.bills%ROWTYPE;
  v_doc    TEXT;
  v_amount NUMERIC := round(COALESCE(p_amount, 0), 2);
BEGIN
  PERFORM app_private.require_role(ARRAY['super_admin', 'village_admin', 'finance']);
  IF v_amount = 0 THEN RAISE EXCEPTION 'จำนวนเงินต้องไม่เป็น 0'; END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'กรุณาระบุเหตุผล'; END IF;

  SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
  IF v_bill.id IS NULL THEN RAISE EXCEPTION 'ไม่พบบิล %', p_bill_id; END IF;
  IF v_bill.status::TEXT NOT IN ('pending', 'overdue') THEN
    RAISE EXCEPTION 'ปรับปรุงยอดได้เฉพาะบิลที่ยังไม่ชำระ';
  END IF;
  IF v_bill.total + v_amount < 0 THEN
    RAISE EXCEPTION 'ลดหนี้ได้ไม่เกินยอดบิล (฿%)', v_bill.total;
  END IF;

  v_doc := app_private.next_doc_no(CASE WHEN v_amount < 0 THEN 'CN' ELSE 'DN' END);
  INSERT INTO public.bill_adjustments (doc_no, bill_id, amount, reason, created_by)
  VALUES (v_doc, p_bill_id, v_amount, trim(p_reason), app_private.jwt_profile_id());

  PERFORM set_config('app.bypass_period_lock', 'on', true);
  UPDATE public.bills SET discount = discount - v_amount, updated_at = now() WHERE id = p_bill_id;
  PERFORM set_config('app.bypass_period_lock', 'off', true);

  RETURN jsonb_build_object(
    'doc_no', v_doc,
    'bill', (SELECT jsonb_build_object('id', id, 'discount', discount, 'total', total)
             FROM public.bills WHERE id = p_bill_id));
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 3. ค้างชำระ + ค่าปรับล่าช้า (สูตรเดียวกับที่แอปเคยคำนวณ)
--    ค่าปรับ = ceil(วันที่เลยกำหนด / 30) × late_fee_per_month (ขั้นต่ำ 1 เดือน)
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION app_private.run_daily_billing()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_today   DATE := app_private.today_th();
  v_fee     NUMERIC;
  v_overdue INT;
  v_fees    INT;
BEGIN
  SELECT NULLIF(value, '')::NUMERIC INTO v_fee FROM public.system_config
  WHERE key = 'late_fee_per_month' AND value ~ '^[0-9]+(\.[0-9]+)?$';
  IF v_fee IS NULL THEN
    SELECT late_fee_per_month INTO v_fee FROM public.rate_tiers
    WHERE late_fee_per_month IS NOT NULL ORDER BY from_unit LIMIT 1;
  END IF;
  v_fee := COALESCE(v_fee, 50);

  UPDATE public.bills SET status = 'overdue', updated_at = now()
  WHERE status = 'pending' AND due_date < v_today;
  GET DIAGNOSTICS v_overdue = ROW_COUNT;

  UPDATE public.bills
  SET late_fee = greatest(1, ceil((v_today - due_date) / 30.0)) * v_fee, updated_at = now()
  WHERE status = 'overdue'
    AND late_fee IS DISTINCT FROM greatest(1, ceil((v_today - due_date) / 30.0)) * v_fee;
  GET DIAGNOSTICS v_fees = ROW_COUNT;

  RETURN jsonb_build_object('overdue', v_overdue, 'late_fee_updated', v_fees, 'date', v_today);
END;
$$;

-- แอปเรียกตอนเปิด (สำรองกรณีไม่มี pg_cron) — idempotent
DROP FUNCTION IF EXISTS public.refresh_billing_status();
CREATE FUNCTION public.refresh_billing_status()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF app_private.staff_role() IS NULL THEN
    RAISE EXCEPTION 'SESSION_REVOKED' USING ERRCODE = '28000';
  END IF;
  RETURN app_private.run_daily_billing();
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 4. Audit log อัตโนมัติ
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION app_private.tg_audit_row()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_old JSONB := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) - 'updated_at' END;
  v_new JSONB := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) - 'updated_at' END;
  v_action TEXT := lower(TG_OP);
BEGIN
  IF TG_OP = 'UPDATE' AND v_old = v_new THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND (v_new ->> 'status') = 'cancelled'
     AND (v_old ->> 'status') IS DISTINCT FROM 'cancelled' THEN
    v_action := 'cancel';
  END IF;
  INSERT INTO public.audit_logs (table_name, record_id, action, old_data, new_data, performed_by)
  VALUES (TG_TABLE_NAME, COALESCE(v_new ->> 'id', v_old ->> 'id',
                                  (v_new ->> 'period_year') || '-' || (v_new ->> 'period_month')),
          v_action, v_old, v_new, 'system');
  RETURN NULL;
END;
$$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['bills', 'payments', 'bill_adjustments', 'billing_periods'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_row ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_audit_row AFTER INSERT OR UPDATE OR DELETE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION app_private.tg_audit_row()', t);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_audit_logs_table_time ON public.audit_logs(table_name, created_at DESC);

-- ══════════════════════════════════════════════════════════════
-- 5. สำรองข้อมูล — คืน JSON ของทุกตาราง (ไม่รวมรหัสผ่านและ API key)
-- ══════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.export_backup();
CREATE FUNCTION public.export_backup()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t      TEXT;
  v_rows JSONB;
  v_out  JSONB := jsonb_build_object('exported_at', now(), 'format', 'aquaflow-backup-v1');
BEGIN
  PERFORM app_private.require_role(ARRAY['super_admin', 'village_admin']);

  FOREACH t IN ARRAY ARRAY['villages', 'members', 'meter_readings', 'bills', 'payments',
                           'bill_adjustments', 'billing_periods', 'rate_tiers', 'master_data',
                           'maintenance_jobs', 'meter_replacements', 'water_production',
                           'water_quality', 'audit_logs'] LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;
    EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(x)), ''[]'') FROM public.%I x', t) INTO v_rows;
    v_out := v_out || jsonb_build_object(t, v_rows);
  END LOOP;

  SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]') INTO v_rows FROM public.system_config c
  WHERE c.key !~* '(token|secret|api_key|password)';
  v_out := v_out || jsonb_build_object('system_config', v_rows);

  SELECT COALESCE(jsonb_agg(to_jsonb(p) - 'password_hash' - 'failed_login_count' - 'locked_until'), '[]')
  INTO v_rows FROM public.profiles p;
  v_out := v_out || jsonb_build_object('profiles', v_rows);

  INSERT INTO public.system_config AS c (key, value, updated_at)
  VALUES ('last_backup_at', now()::TEXT, now())
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now();

  RETURN v_out;
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 6. สิทธิ์ + RLS ของตารางใหม่ (เขียนผ่าน RPC เท่านั้น)
-- ══════════════════════════════════════════════════════════════
ALTER TABLE public.doc_counters     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_periods  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_adjustments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.doc_counters, public.billing_periods, public.bill_adjustments FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.bill_adjustments_id_seq FROM anon, authenticated;
GRANT SELECT ON public.billing_periods, public.bill_adjustments TO authenticated;

DROP POLICY IF EXISTS staff_select ON public.billing_periods;
CREATE POLICY staff_select ON public.billing_periods FOR SELECT TO authenticated
  USING ((SELECT app_private.staff_role()) IS NOT NULL);
DROP POLICY IF EXISTS staff_select ON public.bill_adjustments;
CREATE POLICY staff_select ON public.bill_adjustments FOR SELECT TO authenticated
  USING ((SELECT app_private.staff_role()) IS NOT NULL);

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC, anon;
GRANT  EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_billing_periods(), public.close_billing_period(INT, INT, TEXT),
  public.reopen_billing_period(INT, INT, TEXT), public.adjust_bill(TEXT, NUMERIC, TEXT),
  public.refresh_billing_status(), public.export_backup() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_billing_periods(), public.close_billing_period(INT, INT, TEXT),
  public.reopen_billing_period(INT, INT, TEXT), public.adjust_bill(TEXT, NUMERIC, TEXT),
  public.refresh_billing_status(), public.export_backup() TO authenticated;

-- แจ้ง Realtime ให้ส่งการเปลี่ยนแปลงของงวด/ใบปรับปรุงยอดด้วย
DO $$
DECLARE t TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY['billing_periods', 'bill_adjustments'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END LOOP;
  END IF;
END $$;

-- คำนวณสถานะ/ค่าปรับครั้งแรกทันที
SELECT app_private.run_daily_billing();

COMMIT;

-- ══════════════════════════════════════════════════════════════
-- 7. ตั้งเวลาทุกวัน 00:05 น. (เวลาไทย) — รันแยกหลัง COMMIT
--    ถ้า error ว่าไม่มี pg_cron ให้เปิด extension ก่อน (ดูหัวไฟล์) แล้วรันส่วนนี้ใหม่
-- ══════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
    PERFORM cron.schedule('aquaflow-daily-billing', '5 17 * * *',
                          'SELECT app_private.run_daily_billing()');
  ELSE
    RAISE NOTICE 'pg_cron ไม่พร้อมใช้งาน — แอปจะคำนวณค่าปรับเองทุกครั้งที่เปิด';
  END IF;
END $$;
