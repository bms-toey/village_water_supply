-- ══════════════════════════════════════════════════════════════
-- Phase 3 — บัญชีและรายงานสำหรับคณะกรรมการ
-- (รันหลัง sql_phase2_notify.sql)
--
--   1. สมุดเงินสด: รายรับอื่น (ค่าแรกเข้า ค่าติดตั้ง ค่าต่อน้ำ เงินสนับสนุน)
--      + รายจ่าย (ค่าไฟสูบน้ำ สารเคมี ซ่อมบำรุง ค่าตอบแทน ...)
--      ลบไม่ได้ — ยกเลิก (void) พร้อมเหตุผลเท่านั้น
--      รายรับค่าน้ำมาจากตาราง payments อัตโนมัติ (ไม่ต้องบันทึกซ้ำ)
--   2. บันทึกการผลิตน้ำรายเดือน → คำนวณน้ำสูญเสีย (NRW) จากหน่วยที่ออกบิลจริง
--   3. รายงานคำนวณที่ server: สรุปประจำเดือน, สมุดเงินสด, อายุลูกหนี้, น้ำสูญเสีย, สรุปประจำปี
--   ยอดกองทุนยกมา: ตั้งค่า fund_opening_balance + fund_opening_date (ตั้งค่าทั่วไป)
--
-- วิธีติดตั้ง: SQL Editor → รันไฟล์นี้ทั้งไฟล์ (transaction เดียว, รันซ้ำได้)
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- 1. สมุดเงินสด
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.cashbook_entries (
  id          BIGSERIAL PRIMARY KEY,
  doc_no      TEXT NOT NULL UNIQUE,
  entry_date  DATE NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
  category    TEXT NOT NULL,
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  description TEXT NOT NULL,
  payee       TEXT,
  ref_no      TEXT,
  attachment  TEXT,
  created_by  UUID REFERENCES public.profiles(id),
  created_by_name TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  voided_at   TIMESTAMPTZ,
  voided_by   TEXT,
  void_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_cashbook_date ON public.cashbook_entries(entry_date) WHERE voided_at IS NULL;

-- หมวดรายรับ/รายจ่าย (แก้ไขเพิ่มได้ในหน้า ตั้งค่า → master data)
INSERT INTO public.master_data (category, code, name_th, icon, sort_order) VALUES
  ('expense_category', 'electricity',  'ค่าไฟฟ้าสูบน้ำ',          'ti-bolt',          1),
  ('expense_category', 'chemical',     'สารเคมี (คลอรีน/สารส้ม)',  'ti-flask',         2),
  ('expense_category', 'repair',       'ค่าซ่อมบำรุง/อะไหล่',      'ti-tool',          3),
  ('expense_category', 'wage',         'ค่าตอบแทน/ค่าจ้าง',        'ti-user-dollar',   4),
  ('expense_category', 'supplies',     'วัสดุสำนักงาน/เครื่องเขียน', 'ti-pencil',        5),
  ('expense_category', 'meter',        'ซื้อมิเตอร์/ท่อ',          'ti-gauge',         6),
  ('expense_category', 'other',        'รายจ่ายอื่นๆ',              'ti-dots',          99),
  ('income_category',  'entry_fee',    'ค่าแรกเข้า/ค่าสมาชิก',     'ti-user-plus',     1),
  ('income_category',  'install_fee',  'ค่าติดตั้งมิเตอร์',         'ti-gauge',         2),
  ('income_category',  'reconnect',    'ค่าต่อน้ำใหม่',            'ti-plug-connected', 3),
  ('income_category',  'grant',        'เงินสนับสนุน/อุดหนุน',     'ti-gift',          4),
  ('income_category',  'interest',     'ดอกเบี้ยเงินฝาก',          'ti-building-bank', 5),
  ('income_category',  'other',        'รายรับอื่นๆ',               'ti-dots',          99)
ON CONFLICT (category, code) DO NOTHING;

CREATE OR REPLACE FUNCTION app_private.require_finance()
RETURNS VOID LANGUAGE plpgsql STABLE SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_role(ARRAY['super_admin', 'village_admin', 'finance']);
END;
$$;

-- เลขที่เอกสาร: รายรับอื่น RV-YYMM-NNNN, รายจ่าย PV-YYMM-NNNN
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
  IF p_kind NOT IN ('B', 'R', 'CN', 'DN', 'CC', 'RV', 'PV') THEN
    RAISE EXCEPTION 'ประเภทเอกสารไม่ถูกต้อง: %', p_kind;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.doc_counters WHERE kind = p_kind AND period = v_period) THEN
    SELECT COALESCE(max(substring(x FROM length(v_prefix) + 1)::INT), 0) INTO v_seed
    FROM (
      SELECT id AS x FROM public.bills WHERE p_kind = 'B'
      UNION ALL SELECT receipt_no FROM public.payments WHERE p_kind = 'R'
      UNION ALL SELECT doc_no FROM public.bill_adjustments WHERE p_kind IN ('CN', 'DN')
      UNION ALL SELECT doc_no FROM public.cash_closings WHERE p_kind = 'CC'
      UNION ALL SELECT doc_no FROM public.cashbook_entries WHERE p_kind IN ('RV', 'PV')
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

DROP FUNCTION IF EXISTS public.cashbook_add(TEXT, DATE, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT);
CREATE FUNCTION public.cashbook_add(p_kind TEXT, p_date DATE, p_category TEXT, p_amount NUMERIC,
                                   p_description TEXT, p_payee TEXT DEFAULT NULL, p_ref TEXT DEFAULT NULL,
                                   p_attachment TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_row public.cashbook_entries%ROWTYPE;
  v_uid UUID := app_private.jwt_profile_id();
BEGIN
  PERFORM app_private.require_finance();
  IF p_kind NOT IN ('income', 'expense') THEN RAISE EXCEPTION 'ประเภทไม่ถูกต้อง'; END IF;
  IF COALESCE(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'จำนวนเงินต้องมากกว่า 0'; END IF;
  IF NULLIF(trim(p_description), '') IS NULL THEN RAISE EXCEPTION 'กรุณาระบุรายละเอียด'; END IF;
  IF p_date IS NULL OR p_date > app_private.today_th() THEN RAISE EXCEPTION 'วันที่ไม่ถูกต้อง'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.master_data
                 WHERE category = p_kind || '_category' AND code = p_category) THEN
    RAISE EXCEPTION 'หมวดไม่ถูกต้อง';
  END IF;
  IF p_date < COALESCE((SELECT NULLIF(value, '')::DATE FROM public.system_config
                        WHERE key = 'fund_opening_date' AND value ~ '^\d{4}-\d{2}-\d{2}$'), '1900-01-01') THEN
    RAISE EXCEPTION 'วันที่ก่อนวันยกยอดกองทุน';
  END IF;

  INSERT INTO public.cashbook_entries (doc_no, entry_date, kind, category, amount, description, payee, ref_no,
                                       attachment, created_by, created_by_name)
  VALUES (app_private.next_doc_no(CASE p_kind WHEN 'income' THEN 'RV' ELSE 'PV' END), p_date, p_kind, p_category,
          round(p_amount, 2), trim(p_description), NULLIF(trim(p_payee), ''), NULLIF(trim(p_ref), ''),
          NULLIF(p_attachment, ''), v_uid, (SELECT full_name FROM public.profiles WHERE id = v_uid))
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END;
$$;

DROP FUNCTION IF EXISTS public.cashbook_void(BIGINT, TEXT);
CREATE FUNCTION public.cashbook_void(p_id BIGINT, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_role(ARRAY['super_admin', 'finance']);
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'กรุณาระบุเหตุผล'; END IF;
  UPDATE public.cashbook_entries
  SET voided_at = now(), void_reason = trim(p_reason),
      voided_by = (SELECT full_name FROM public.profiles WHERE id = app_private.jwt_profile_id())
  WHERE id = p_id AND voided_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบรายการ หรือถูกยกเลิกแล้ว'; END IF;
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 2. การผลิตน้ำรายเดือน (NRW)
-- ══════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.save_water_production(INT, INT, NUMERIC, NUMERIC, NUMERIC, TEXT);
CREATE FUNCTION public.save_water_production(p_year INT, p_month INT, p_raw NUMERIC, p_produced NUMERIC,
                                            p_distributed NUMERIC, p_notes TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_usage NUMERIC;
  v_row   public.water_production%ROWTYPE;
BEGIN
  PERFORM app_private.require_role(ARRAY['super_admin', 'village_admin']);
  IF p_month NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'เดือนไม่ถูกต้อง'; END IF;
  IF COALESCE(p_distributed, 0) <= 0 THEN RAISE EXCEPTION 'กรุณากรอกปริมาณน้ำจ่ายเข้าระบบ'; END IF;
  SELECT COALESCE(sum(usage), 0) INTO v_usage FROM public.bills
  WHERE period_year = p_year AND period_month = p_month AND status::TEXT <> 'cancelled';

  INSERT INTO public.water_production AS w (id, period_year, period_month, period_label, raw_water_in, water_produced,
                                            water_distributed, total_meter_usage, recorded_by, recorded_date, notes)
  VALUES ('WP-' || p_year || '-' || lpad(p_month::TEXT, 2, '0'), p_year, p_month,
          (ARRAY['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'])[p_month] || ' ' || p_year,
          p_raw, p_produced, p_distributed, v_usage, app_private.jwt_profile_id(), app_private.today_th(), NULLIF(trim(p_notes), ''))
  ON CONFLICT (period_year, period_month) DO UPDATE
    SET raw_water_in = excluded.raw_water_in, water_produced = excluded.water_produced,
        water_distributed = excluded.water_distributed, total_meter_usage = excluded.total_meter_usage,
        recorded_by = excluded.recorded_by, recorded_date = excluded.recorded_date, notes = excluded.notes
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 3. รายงาน
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION app_private.fund_opening()
RETURNS TABLE (opening_date DATE, opening_balance NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT value::DATE FROM public.system_config WHERE key = 'fund_opening_date' AND value ~ '^\d{4}-\d{2}-\d{2}$'), '1900-01-01'::DATE),
         COALESCE((SELECT value::NUMERIC FROM public.system_config WHERE key = 'fund_opening_balance' AND value ~ '^-?[0-9]+(\.[0-9]+)?$'), 0);
$$;

-- เงินเข้า/ออกจริงในช่วงวันที่ [p_from, p_to] (รวมค่าน้ำที่อนุมัติแล้ว + สมุดเงินสด)
CREATE OR REPLACE FUNCTION app_private.cash_flow(p_from DATE, p_to DATE)
RETURNS TABLE (water_income NUMERIC, other_income NUMERIC, expense NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT
    COALESCE((SELECT sum(amount) FROM public.payments
              WHERE status::TEXT = 'approved' AND app_private.paid_date_th(paid_at) BETWEEN p_from AND p_to), 0),
    COALESCE((SELECT sum(amount) FROM public.cashbook_entries
              WHERE kind = 'income' AND voided_at IS NULL AND entry_date BETWEEN p_from AND p_to), 0),
    COALESCE((SELECT sum(amount) FROM public.cashbook_entries
              WHERE kind = 'expense' AND voided_at IS NULL AND entry_date BETWEEN p_from AND p_to), 0);
$$;

-- ยอดกองทุน ณ ต้นวัน p_date
CREATE OR REPLACE FUNCTION app_private.fund_balance_before(p_date DATE)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT o.opening_balance + COALESCE(f.water_income + f.other_income - f.expense, 0)
  FROM app_private.fund_opening() o
  LEFT JOIN LATERAL app_private.cash_flow(o.opening_date, p_date - 1) f ON p_date > o.opening_date;
$$;

DROP FUNCTION IF EXISTS public.report_monthly(INT, INT);
CREATE FUNCTION public.report_monthly(p_year INT, p_month INT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_from DATE := make_date(p_year - 543, p_month, 1);
  v_to   DATE := (make_date(p_year - 543, p_month, 1) + INTERVAL '1 month - 1 day')::DATE;
  v_open NUMERIC;
  v_flow RECORD;
BEGIN
  PERFORM app_private.require_finance();
  v_open := app_private.fund_balance_before(v_from);
  SELECT * INTO v_flow FROM app_private.cash_flow(v_from, v_to);

  RETURN jsonb_build_object(
    'year', p_year, 'month', p_month, 'from', v_from, 'to', v_to,
    'billing', (SELECT jsonb_build_object(
        'bills',       count(*),
        'usage',       COALESCE(sum(usage), 0),
        'billed',      COALESCE(sum(total), 0),
        'paid',        COALESCE(sum(total) FILTER (WHERE status::TEXT = 'paid'), 0),
        'outstanding', COALESCE(sum(total) FILTER (WHERE status::TEXT IN ('pending', 'overdue')), 0),
        'paid_count',  count(*) FILTER (WHERE status::TEXT = 'paid'))
      FROM public.bills WHERE period_year = p_year AND period_month = p_month AND status::TEXT <> 'cancelled'),
    'cash', jsonb_build_object(
        'opening', v_open, 'water_income', v_flow.water_income, 'other_income', v_flow.other_income,
        'expense', v_flow.expense, 'closing', v_open + v_flow.water_income + v_flow.other_income - v_flow.expense,
        'income_by_category', COALESCE((SELECT jsonb_agg(jsonb_build_object('category', c.category, 'name', md.name_th, 'amount', c.amt) ORDER BY c.amt DESC)
            FROM (SELECT category, sum(amount) amt FROM public.cashbook_entries
                  WHERE kind = 'income' AND voided_at IS NULL AND entry_date BETWEEN v_from AND v_to GROUP BY category) c
            LEFT JOIN public.master_data md ON md.category = 'income_category' AND md.code = c.category), '[]'::JSONB),
        'expense_by_category', COALESCE((SELECT jsonb_agg(jsonb_build_object('category', c.category, 'name', md.name_th, 'amount', c.amt) ORDER BY c.amt DESC)
            FROM (SELECT category, sum(amount) amt FROM public.cashbook_entries
                  WHERE kind = 'expense' AND voided_at IS NULL AND entry_date BETWEEN v_from AND v_to GROUP BY category) c
            LEFT JOIN public.master_data md ON md.category = 'expense_category' AND md.code = c.category), '[]'::JSONB)),
    'water', (SELECT jsonb_build_object('produced', w.water_produced, 'distributed', w.water_distributed,
                                        'billed_usage', w.total_meter_usage, 'nrw', w.nrw, 'nrw_pct', w.nrw_pct)
              FROM public.water_production w WHERE w.period_year = p_year AND w.period_month = p_month),
    'members', jsonb_build_object(
        'total',     (SELECT count(*) FROM public.members WHERE NOT COALESCE(is_deleted, false) AND status::TEXT <> 'closed'),
        'new',       (SELECT count(*) FROM public.members WHERE NOT COALESCE(is_deleted, false)
                      AND COALESCE(registration_date, (created_at AT TIME ZONE 'Asia/Bangkok')::DATE) BETWEEN v_from AND v_to),
        'suspended', (SELECT count(*) FROM public.members WHERE NOT COALESCE(is_deleted, false) AND status::TEXT = 'suspended')),
    'debtors', (SELECT jsonb_build_object('members', count(DISTINCT member_id), 'amount', COALESCE(sum(total), 0))
                FROM public.bills WHERE status::TEXT = 'overdue')
  );
END;
$$;

DROP FUNCTION IF EXISTS public.report_cashbook(DATE, DATE);
CREATE FUNCTION public.report_cashbook(p_from DATE, p_to DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_open NUMERIC;
BEGIN
  PERFORM app_private.require_finance();
  IF p_to < p_from OR p_to - p_from > 400 THEN RAISE EXCEPTION 'ช่วงวันที่ไม่ถูกต้อง (ไม่เกิน 400 วัน)'; END IF;
  v_open := app_private.fund_balance_before(p_from);
  RETURN jsonb_build_object('from', p_from, 'to', p_to, 'opening', v_open, 'rows', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('date', d, 'doc_no', doc_no, 'id', id, 'kind', kind, 'category', category,
                                        'description', description, 'income', income, 'expense', expense,
                                        'balance', v_open + running) ORDER BY d, sort, doc_no)
    FROM (SELECT x.*, sum(income - expense) OVER (ORDER BY d, sort, doc_no) AS running FROM (
      -- ค่าน้ำรวมเป็นรายการเดียวต่อวัน
      SELECT app_private.paid_date_th(paid_at) AS d, NULL::TEXT AS doc_no, NULL::BIGINT AS id, 'water' AS kind, 'water' AS category,
             'รับชำระค่าน้ำ ' || count(*) || ' ราย' AS description, sum(amount) AS income, 0::NUMERIC AS expense, 0 AS sort
      FROM public.payments
      WHERE status::TEXT = 'approved' AND app_private.paid_date_th(paid_at) BETWEEN p_from AND p_to
      GROUP BY 1
      UNION ALL
      SELECT entry_date, doc_no, id, kind, category, description || COALESCE(' — ' || payee, ''),
             CASE WHEN kind = 'income' THEN amount ELSE 0 END, CASE WHEN kind = 'expense' THEN amount ELSE 0 END, 1
      FROM public.cashbook_entries
      WHERE voided_at IS NULL AND entry_date BETWEEN p_from AND p_to
    ) x) y), '[]'::JSONB));
END;
$$;

DROP FUNCTION IF EXISTS public.report_aging(DATE);
CREATE FUNCTION public.report_aging(p_as_of DATE DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_d DATE := COALESCE(p_as_of, app_private.today_th());
BEGIN
  PERFORM app_private.require_finance();
  RETURN COALESCE((
    SELECT jsonb_agg(r ORDER BY r.total DESC) FROM (
      SELECT m.id AS member_id, m.first_name || ' ' || m.last_name AS name, m.house_no, v.name AS village, m.meter_no, m.phone,
             m.status, count(*) AS bills,
             COALESCE(sum(b.total) FILTER (WHERE v_d - b.due_date <= 30), 0)                   AS d0_30,
             COALESCE(sum(b.total) FILTER (WHERE v_d - b.due_date BETWEEN 31 AND 60), 0)       AS d31_60,
             COALESCE(sum(b.total) FILTER (WHERE v_d - b.due_date BETWEEN 61 AND 90), 0)       AS d61_90,
             COALESCE(sum(b.total) FILTER (WHERE v_d - b.due_date > 90), 0)                    AS d90_plus,
             sum(b.total) AS total, min(b.due_date) AS oldest_due
      FROM public.bills b JOIN public.members m ON m.id = b.member_id
      LEFT JOIN public.villages v ON v.id = m.village_id
      WHERE b.status::TEXT = 'overdue'
      GROUP BY m.id, v.name
    ) r), '[]'::JSONB);
END;
$$;

DROP FUNCTION IF EXISTS public.report_annual(INT);
CREATE FUNCTION public.report_annual(p_year INT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_finance();
  RETURN (
    SELECT jsonb_build_object(
      'year', p_year,
      'opening', app_private.fund_balance_before(make_date(p_year - 543, 1, 1)),
      'months', jsonb_agg(jsonb_build_object(
        'month', mo,
        'billed',      COALESCE((SELECT sum(total) FROM public.bills WHERE period_year = p_year AND period_month = mo AND status::TEXT <> 'cancelled'), 0),
        'usage',       COALESCE((SELECT sum(usage) FROM public.bills WHERE period_year = p_year AND period_month = mo AND status::TEXT <> 'cancelled'), 0),
        'outstanding', COALESCE((SELECT sum(total) FROM public.bills WHERE period_year = p_year AND period_month = mo AND status::TEXT IN ('pending', 'overdue')), 0),
        'water_income', f.water_income, 'other_income', f.other_income, 'expense', f.expense,
        'produced',    (SELECT water_distributed FROM public.water_production WHERE period_year = p_year AND period_month = mo),
        'nrw_pct',     (SELECT nrw_pct FROM public.water_production WHERE period_year = p_year AND period_month = mo)
      ) ORDER BY mo))
    FROM generate_series(1, 12) mo
    CROSS JOIN LATERAL app_private.cash_flow(make_date(p_year - 543, mo, 1),
                                             (make_date(p_year - 543, mo, 1) + INTERVAL '1 month - 1 day')::DATE) f
  );
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 4. สิทธิ์ + RLS + audit + storage
-- ══════════════════════════════════════════════════════════════
ALTER TABLE public.cashbook_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cashbook_entries FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.cashbook_entries_id_seq FROM anon, authenticated;
GRANT SELECT ON public.cashbook_entries TO authenticated;
DROP POLICY IF EXISTS finance_select ON public.cashbook_entries;
CREATE POLICY finance_select ON public.cashbook_entries FOR SELECT TO authenticated
  USING ((SELECT app_private.staff_role()) IN ('super_admin', 'village_admin', 'finance'));

DROP TRIGGER IF EXISTS trg_audit_row ON public.cashbook_entries;
CREATE TRIGGER trg_audit_row AFTER INSERT OR UPDATE OR DELETE ON public.cashbook_entries
  FOR EACH ROW EXECUTE FUNCTION app_private.tg_audit_row();
DROP TRIGGER IF EXISTS trg_audit_row ON public.water_production;
CREATE TRIGGER trg_audit_row AFTER INSERT OR UPDATE OR DELETE ON public.water_production
  FOR EACH ROW EXECUTE FUNCTION app_private.tg_audit_row();

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('finance-docs', 'finance-docs', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
DROP POLICY IF EXISTS aquaflow_finance_docs_read   ON storage.objects;
DROP POLICY IF EXISTS aquaflow_finance_docs_upload ON storage.objects;
CREATE POLICY aquaflow_finance_docs_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'finance-docs' AND (SELECT app_private.staff_role()) IN ('super_admin', 'village_admin', 'finance'));
CREATE POLICY aquaflow_finance_docs_upload ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'finance-docs' AND (SELECT app_private.staff_role()) IN ('super_admin', 'village_admin', 'finance'));

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC, anon;
GRANT  EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private TO authenticated;
DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['cashbook_add(text,date,text,numeric,text,text,text,text)', 'cashbook_void(bigint,text)',
    'save_water_production(integer,integer,numeric,numeric,numeric,text)', 'report_monthly(integer,integer)',
    'report_cashbook(date,date)', 'report_aging(date)', 'report_annual(integer)'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- backup รวมสมุดเงินสด
CREATE OR REPLACE FUNCTION public.export_backup()
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
                           'water_quality', 'cash_closings', 'cashbook_entries', 'announcements', 'audit_logs'] LOOP
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
REVOKE EXECUTE ON FUNCTION public.export_backup() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.export_backup() TO authenticated;

COMMIT;
