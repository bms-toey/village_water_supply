-- ══════════════════════════════════════════════════════════════
-- Phase 2 — การแจ้งเตือน + Portal ผู้ใช้น้ำ + LINE OA (ผ่านคิว outbox)
-- (รันหลัง sql_phase1_documents.sql)
--
--   1. แจ้งเตือนในระบบสำหรับเจ้าหน้าที่ (สลิปรอตรวจ, ค่ามิเตอร์ผิดปกติ, แจ้งซ่อม, ค้างชำระใหม่)
--   2. Portal ผู้ใช้น้ำ: เข้าด้วยเลขมิเตอร์ + รหัส 6 หลัก (พิมพ์บนใบแจ้ง)
--      ดูบิล/สแกนจ่าย/ส่งสลิป/แจ้งซ่อม — token ของสมาชิกไม่ผ่านสิทธิ์เจ้าหน้าที่ใดๆ
--   3. คิวข้อความถึงสมาชิก (notification_outbox) — LINE / SMS
--      ข้อความถูกเข้าคิวเสมอ แล้ว Edge Function ส่งออก (ดู supabase/functions/)
--      ยังไม่มี LINE OA ก็ไม่เป็นไร — คิวจะรอจนกว่าตั้งค่าเสร็จ
--
-- วิธีติดตั้ง: SQL Editor → รันไฟล์นี้ทั้งไฟล์ (transaction เดียว, รันซ้ำได้)
-- ══════════════════════════════════════════════════════════════

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ฟังก์ชันจากยุค Supabase Auth ที่แอปไม่ใช้แล้ว (บางตัวเปิดเผยอีเมลผู้ใช้)
DROP FUNCTION IF EXISTS public.admin_create_user(TEXT, TEXT, TEXT, TEXT, TEXT, user_role, INT);
DROP FUNCTION IF EXISTS public.admin_set_user_password(UUID, TEXT);
DROP FUNCTION IF EXISTS public.get_email_by_identifier(TEXT);
DROP FUNCTION IF EXISTS public.get_email_by_username(TEXT);

-- ══════════════════════════════════════════════════════════════
-- 1. แจ้งเตือนเจ้าหน้าที่
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.notifications (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  link_page  TEXT,
  link_ref   TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  read_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, created_at DESC);

-- ส่งถึงผู้ใช้ที่เปิดใช้งานใน role ที่ระบุ
CREATE OR REPLACE FUNCTION app_private.notify_roles(p_roles TEXT[], p_kind TEXT, p_title TEXT,
                                                   p_body TEXT DEFAULT NULL, p_page TEXT DEFAULT NULL, p_ref TEXT DEFAULT NULL)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n INT;
BEGIN
  INSERT INTO public.notifications (user_id, kind, title, body, link_page, link_ref)
  SELECT p.id, p_kind, p_title, p_body, p_page, p_ref
  FROM public.profiles p WHERE p.is_active AND p.role::TEXT = ANY (p_roles);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

DROP FUNCTION IF EXISTS public.mark_notifications_read(BIGINT[]);
CREATE FUNCTION public.mark_notifications_read(p_ids BIGINT[] DEFAULT NULL)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n INT;
BEGIN
  UPDATE public.notifications SET read_at = now()
  WHERE user_id = app_private.jwt_profile_id() AND read_at IS NULL
    AND (p_ids IS NULL OR id = ANY (p_ids));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 2. Portal ผู้ใช้น้ำ
-- ══════════════════════════════════════════════════════════════
-- รหัส portal + LINE ID แยกตาราง — staff/สมาชิกอ่านตรงไม่ได้ (เข้าถึงผ่าน RPC เท่านั้น)
CREATE TABLE IF NOT EXISTS public.member_access (
  member_id      BIGINT PRIMARY KEY REFERENCES public.members(id) ON DELETE CASCADE,
  portal_code    TEXT NOT NULL,
  line_user_id   TEXT UNIQUE,
  line_linked_at TIMESTAMPTZ
);

-- token ของสมาชิกไม่ใช่เจ้าหน้าที่ — กันไม่ให้ trigger บันทึก sub เป็น created_by/ผู้ทำรายการ
CREATE OR REPLACE FUNCTION app_private.jwt_profile_id()
RETURNS UUID LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN auth.jwt() ->> 'app_role' = 'member' THEN NULL
    WHEN auth.jwt() ->> 'sub' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (auth.jwt() ->> 'sub')::UUID
  END;
$$;

CREATE OR REPLACE FUNCTION app_private.tg_audit_stamp()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor TEXT;
BEGIN
  SELECT COALESCE(p.username, p.email, p.full_name) INTO v_actor
  FROM public.profiles p WHERE p.id = app_private.jwt_profile_id();
  IF v_actor IS NULL AND auth.jwt() ->> 'app_role' = 'member' THEN
    v_actor := 'member:' || (auth.jwt() ->> 'member_id');
  END IF;
  IF v_actor IS NOT NULL THEN
    NEW.performed_by := v_actor;
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END;
$$;

-- รหัส 6 ตัว ไม่มีตัวที่สับสนง่าย (0/O, 1/I)
CREATE OR REPLACE FUNCTION app_private.new_portal_code()
RETURNS TEXT LANGUAGE sql VOLATILE SET search_path = '' AS $$
  SELECT string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + (get_byte(b, i) % 32), 1), '')
  FROM extensions.gen_random_bytes(6) b, generate_series(0, 5) i;
$$;

CREATE OR REPLACE FUNCTION app_private.tg_member_access()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.member_access (member_id, portal_code) VALUES (NEW.id, app_private.new_portal_code())
  ON CONFLICT (member_id) DO NOTHING;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_member_access ON public.members;
CREATE TRIGGER trg_member_access AFTER INSERT ON public.members
  FOR EACH ROW EXECUTE FUNCTION app_private.tg_member_access();

-- เติมรหัสให้สมาชิกเดิม
INSERT INTO public.member_access (member_id, portal_code)
SELECT m.id, app_private.new_portal_code() FROM public.members m
ON CONFLICT (member_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.portal_login_attempts (
  meter_no     TEXT PRIMARY KEY,
  fail_count   INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ
);

-- member_id จาก token ของสมาชิก (NULL ถ้าไม่ใช่สมาชิก / ถูกลบ / รหัสถูกเปลี่ยนแล้ว)
CREATE OR REPLACE FUNCTION app_private.jwt_member_id()
RETURNS BIGINT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.id FROM public.members m JOIN public.member_access a ON a.member_id = m.id
  WHERE auth.jwt() ->> 'app_role' = 'member'
    AND auth.jwt() ->> 'member_id' ~ '^[0-9]{1,18}$'
    AND m.id = (auth.jwt() ->> 'member_id')::BIGINT
    AND NOT COALESCE(m.is_deleted, false)
    AND left(md5(a.portal_code), 8) = auth.jwt() ->> 'pc';
$$;

CREATE OR REPLACE FUNCTION app_private.require_member()
RETURNS BIGINT LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE v BIGINT := app_private.jwt_member_id();
BEGIN
  IF v IS NULL THEN RAISE EXCEPTION 'SESSION_REVOKED' USING ERRCODE = '28000'; END IF;
  RETURN v;
END;
$$;

-- token สมาชิก: sub เป็น uuid ที่ไม่ตรงกับเจ้าหน้าที่คนใด → ไม่ผ่าน staff_role() ทุกกรณี
CREATE OR REPLACE FUNCTION app_private.issue_member_session(p_member_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c_ttl CONSTANT INT := 30 * 86400;
  v     public.members%ROWTYPE;
  v_pc  TEXT;
  v_now BIGINT := extract(epoch FROM now())::BIGINT;
BEGIN
  SELECT * INTO v FROM public.members WHERE id = p_member_id;
  SELECT portal_code INTO v_pc FROM public.member_access WHERE member_id = p_member_id;
  RETURN jsonb_build_object(
    'token', app_private.sign_jwt(jsonb_build_object(
      'sub',       md5('aquaflow-member:' || v.id)::UUID,
      'role',      'authenticated',
      'aud',       'authenticated',
      'iat',       v_now,
      'exp',       v_now + c_ttl,
      'app_role',  'member',
      'member_id', v.id,
      'pc',        left(md5(v_pc), 8)
    )),
    'expires_at', v_now + c_ttl,
    'member', jsonb_build_object('id', v.id, 'name', v.first_name || ' ' || v.last_name, 'meter_no', v.meter_no)
  );
END;
$$;

DROP FUNCTION IF EXISTS public.member_login(TEXT, TEXT);
CREATE FUNCTION public.member_login(p_meter TEXT, p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c_fail  CONSTANT TEXT := 'เลขมิเตอร์หรือรหัสไม่ถูกต้อง';
  v_meter TEXT := upper(trim(COALESCE(p_meter, '')));
  v_code  TEXT := upper(regexp_replace(COALESCE(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_att   public.portal_login_attempts%ROWTYPE;
  v_id    BIGINT;
BEGIN
  IF v_meter = '' OR v_code = '' THEN RETURN jsonb_build_object('error', 'กรุณากรอกเลขมิเตอร์และรหัส'); END IF;

  SELECT * INTO v_att FROM public.portal_login_attempts WHERE meter_no = v_meter;
  IF v_att.locked_until > now() THEN
    RETURN jsonb_build_object('error', 'ใส่รหัสผิดหลายครั้ง กรุณาลองใหม่ภายหลัง หรือติดต่อเจ้าหน้าที่');
  END IF;

  SELECT m.id INTO v_id FROM public.members m JOIN public.member_access a ON a.member_id = m.id
  WHERE upper(m.meter_no) = v_meter AND a.portal_code = v_code AND NOT COALESCE(m.is_deleted, false);

  IF v_id IS NULL THEN
    INSERT INTO public.portal_login_attempts AS a (meter_no, fail_count, locked_until)
    VALUES (v_meter, 1, NULL)
    ON CONFLICT (meter_no) DO UPDATE
      SET fail_count   = a.fail_count + 1,
          locked_until = CASE WHEN a.fail_count + 1 >= 5 THEN now() + INTERVAL '15 minutes' ELSE NULL END;
    RETURN jsonb_build_object('error', c_fail);
  END IF;

  DELETE FROM public.portal_login_attempts WHERE meter_no = v_meter;
  RETURN app_private.issue_member_session(v_id);
END;
$$;

-- ข้อมูลหน่วยงานที่เปิดให้ผู้ใช้น้ำเห็น (ไม่รวม key/token)
CREATE OR REPLACE FUNCTION app_private.public_org_info()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_object_agg(key, value), '{}'::JSONB) FROM public.system_config
  WHERE key IN ('org_name', 'org_address', 'org_phone', 'promptpay_id', 'promptpay_name', 'bank_info', 'receipt_footer');
$$;

DROP FUNCTION IF EXISTS public.member_overview();
CREATE FUNCTION public.member_overview()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id BIGINT := app_private.require_member();
BEGIN
  RETURN (
    SELECT jsonb_build_object(
      'member', jsonb_build_object('id', m.id, 'name', m.first_name || ' ' || m.last_name,
                                   'house_no', m.house_no, 'village', v.name, 'meter_no', m.meter_no,
                                   'status', m.status, 'line_linked', EXISTS (SELECT 1 FROM public.member_access a WHERE a.member_id = m.id AND a.line_user_id IS NOT NULL)),
      'org', app_private.public_org_info(),
      'bills', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', b.id, 'period', b.period_label, 'year', b.period_year, 'month', b.period_month,
          'usage', b.usage, 'total', b.total, 'status', b.status, 'due_date', b.due_date,
          'late_fee', b.late_fee, 'water_charge', b.water_charge, 'service_charge', b.service_charge,
          'pending_payment', EXISTS (SELECT 1 FROM public.payments p WHERE p.bill_id = b.id AND p.status::TEXT = 'pending'),
          'receipt_no', (SELECT p.receipt_no FROM public.payments p WHERE p.bill_id = b.id AND p.status::TEXT = 'approved' LIMIT 1)
        ) ORDER BY b.period_year DESC, b.period_month DESC)
        FROM (SELECT * FROM public.bills WHERE member_id = v_id AND status::TEXT <> 'cancelled'
              ORDER BY period_year DESC, period_month DESC LIMIT 24) b), '[]'::JSONB),
      'issues', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', j.id, 'type', j.type, 'description', j.description,
                                            'status', j.status, 'reported_date', j.reported_date) ORDER BY j.created_at DESC)
        FROM (SELECT * FROM public.maintenance_jobs WHERE member_id = v_id ORDER BY created_at DESC LIMIT 20) j), '[]'::JSONB)
    )
    FROM public.members m LEFT JOIN public.villages v ON v.id = m.village_id
    WHERE m.id = v_id
  );
END;
$$;

-- แจ้งชำระเงินพร้อมสลิป → รายการรอตรวจสอบ (เจ้าหน้าที่อนุมัติแล้วจึงออกใบเสร็จ)
DROP FUNCTION IF EXISTS public.member_submit_payment(TEXT, NUMERIC, TEXT, TEXT);
CREATE FUNCTION public.member_submit_payment(p_bill_id TEXT, p_amount NUMERIC, p_ref TEXT, p_slip_path TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id   BIGINT := app_private.require_member();
  v_bill public.bills%ROWTYPE;
  v_pid  TEXT := 'PAY-M' || (extract(epoch FROM clock_timestamp()) * 1000)::BIGINT;
BEGIN
  SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id AND member_id = v_id;
  IF v_bill.id IS NULL THEN RAISE EXCEPTION 'ไม่พบบิล'; END IF;
  IF v_bill.status::TEXT NOT IN ('pending', 'overdue') THEN RAISE EXCEPTION 'บิลนี้ไม่อยู่ในสถานะรอชำระ'; END IF;
  IF EXISTS (SELECT 1 FROM public.payments WHERE bill_id = p_bill_id AND status::TEXT = 'pending') THEN
    RAISE EXCEPTION 'บิลนี้แจ้งชำระแล้ว รอเจ้าหน้าที่ตรวจสอบ';
  END IF;
  IF round(COALESCE(p_amount, 0), 2) <> round(v_bill.total, 2) THEN
    RAISE EXCEPTION 'ยอดชำระต้องเท่ากับยอดบิล (฿%)', v_bill.total;
  END IF;
  IF COALESCE(p_slip_path, '') !~ ('^m' || v_id || '/[A-Za-z0-9._-]+$') THEN
    RAISE EXCEPTION 'กรุณาแนบสลิปการโอน';
  END IF;

  INSERT INTO public.payments (id, bill_id, member_id, amount, channel, tx_ref, payer_name, slip_url, status, received_by_name)
  VALUES (v_pid, p_bill_id, v_id, v_bill.total, 'promptpay', NULLIF(trim(p_ref), ''),
          (SELECT first_name || ' ' || last_name FROM public.members WHERE id = v_id),
          'member-uploads:' || p_slip_path, 'pending', 'แจ้งชำระออนไลน์');
  RETURN v_pid;
END;
$$;

DROP FUNCTION IF EXISTS public.member_report_issue(TEXT, TEXT, TEXT, TEXT);
CREATE FUNCTION public.member_report_issue(p_type TEXT, p_description TEXT, p_location TEXT, p_photo_path TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id  BIGINT := app_private.require_member();
  v_job TEXT := 'MNT-M' || (extract(epoch FROM clock_timestamp()) * 1000)::BIGINT;
  v_m   public.members%ROWTYPE;
BEGIN
  IF NULLIF(trim(p_description), '') IS NULL THEN RAISE EXCEPTION 'กรุณาอธิบายปัญหา'; END IF;
  IF (SELECT count(*) FROM public.maintenance_jobs
      WHERE member_id = v_id AND created_at > now() - INTERVAL '1 day') >= 5 THEN
    RAISE EXCEPTION 'แจ้งซ่อมได้ไม่เกิน 5 ครั้งต่อวัน';
  END IF;
  IF COALESCE(p_photo_path, '') <> '' AND p_photo_path !~ ('^m' || v_id || '/[A-Za-z0-9._-]+$') THEN
    RAISE EXCEPTION 'รูปไม่ถูกต้อง';
  END IF;
  SELECT * INTO v_m FROM public.members WHERE id = v_id;
  INSERT INTO public.maintenance_jobs (id, type, description, location, village_id, member_id,
                                       reported_by_type, reported_date, status, photos)
  VALUES (v_job,
          CASE WHEN p_type IN ('pipe_repair', 'meter_replace', 'leak_fix', 'other') THEN p_type ELSE 'other' END::public.maintenance_type,
          left(trim(p_description), 1000),
          COALESCE(NULLIF(trim(p_location), ''), 'บ้านเลขที่ ' || v_m.house_no),
          v_m.village_id, v_id, 'member', app_private.today_th(), 'pending',
          CASE WHEN COALESCE(p_photo_path, '') <> '' THEN ARRAY['member-uploads:' || p_photo_path] END);
  RETURN v_job;
END;
$$;

-- เจ้าหน้าที่: สร้างรหัสใหม่ (token เดิมของสมาชิกใช้ไม่ได้ทันที)
DROP FUNCTION IF EXISTS public.regenerate_portal_code(BIGINT);
CREATE FUNCTION public.regenerate_portal_code(p_member_id BIGINT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v TEXT := app_private.new_portal_code();
BEGIN
  PERFORM app_private.require_role(ARRAY['super_admin', 'village_admin', 'finance']);
  IF NOT EXISTS (SELECT 1 FROM public.members WHERE id = p_member_id) THEN RAISE EXCEPTION 'ไม่พบสมาชิก'; END IF;
  INSERT INTO public.member_access AS a (member_id, portal_code) VALUES (p_member_id, v)
  ON CONFLICT (member_id) DO UPDATE SET portal_code = excluded.portal_code;
  RETURN v;
END;
$$;

-- เจ้าหน้าที่: รหัส portal ของสมาชิก (สำหรับพิมพ์ใบแจ้ง) — คอลัมน์นี้ไม่ส่งไปกับข้อมูลสมาชิกปกติ
DROP FUNCTION IF EXISTS public.get_portal_codes(BIGINT[]);
CREATE FUNCTION public.get_portal_codes(p_member_ids BIGINT[])
RETURNS TABLE (member_id BIGINT, portal_code TEXT, line_linked BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF app_private.staff_role() IS NULL THEN RAISE EXCEPTION 'SESSION_REVOKED' USING ERRCODE = '28000'; END IF;
  RETURN QUERY SELECT a.member_id, a.portal_code, a.line_user_id IS NOT NULL FROM public.member_access a WHERE a.member_id = ANY (p_member_ids);
END;
$$;


-- ══════════════════════════════════════════════════════════════
-- 3. คิวข้อความถึงสมาชิก (LINE / SMS)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id          BIGSERIAL PRIMARY KEY,
  channel     TEXT NOT NULL CHECK (channel IN ('line', 'sms')),
  member_id   BIGINT REFERENCES public.members(id),
  recipient   TEXT NOT NULL,
  kind        TEXT NOT NULL,
  payload     JSONB NOT NULL,
  dedupe_key  TEXT UNIQUE,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts    INT NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  sent_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON public.notification_outbox(status, created_at) WHERE status IN ('pending', 'sending');

CREATE TABLE IF NOT EXISTS public.announcements (
  id         BIGSERIAL PRIMARY KEY,
  title      TEXT NOT NULL,
  message    TEXT NOT NULL,
  village_id INT REFERENCES public.villages(id),
  recipients INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- เข้าคิวถึงสมาชิกหนึ่งคน: LINE ถ้าผูกแล้ว, ไม่งั้น SMS (ถ้าเปิดใช้) — คืนช่องทาง หรือ NULL
CREATE OR REPLACE FUNCTION app_private.enqueue_member(p_member_id BIGINT, p_kind TEXT, p_payload JSONB, p_dedupe TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v      public.members%ROWTYPE;
  v_line TEXT;
  v_n    INT;
BEGIN
  SELECT * INTO v FROM public.members WHERE id = p_member_id AND NOT COALESCE(is_deleted, false);
  IF v.id IS NULL THEN RETURN NULL; END IF;
  SELECT line_user_id INTO v_line FROM public.member_access WHERE member_id = v.id;

  IF v_line IS NOT NULL THEN
    INSERT INTO public.notification_outbox (channel, member_id, recipient, kind, payload, dedupe_key)
    VALUES ('line', v.id, v_line, p_kind, p_payload, p_dedupe)
    ON CONFLICT (dedupe_key) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN CASE WHEN v_n > 0 THEN 'line' END;
  END IF;

  IF (SELECT value FROM public.system_config WHERE key = 'sms_enabled') = 'true'
     AND length(regexp_replace(COALESCE(v.phone, ''), '[^0-9]', '', 'g')) = 10 THEN
    INSERT INTO public.notification_outbox (channel, member_id, recipient, kind, payload, dedupe_key)
    VALUES ('sms', v.id, regexp_replace(v.phone, '[^0-9]', '', 'g'), p_kind, p_payload, p_dedupe)
    ON CONFLICT (dedupe_key) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN CASE WHEN v_n > 0 THEN 'sms' END;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.bill_payload(p_bill public.bills)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('bill_id', p_bill.id, 'period', p_bill.period_label, 'total', p_bill.total,
                            'usage', p_bill.usage, 'due_date', p_bill.due_date, 'status', p_bill.status);
$$;

-- ── trigger: บิลใหม่ → แจ้งสมาชิก ─────────────────────────────
CREATE OR REPLACE FUNCTION app_private.tg_bill_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status::TEXT IN ('pending', 'overdue') THEN
    PERFORM app_private.enqueue_member(NEW.member_id, 'bill_issued', app_private.bill_payload(NEW), 'bill:' || NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_bill_notify ON public.bills;
CREATE TRIGGER trg_bill_notify AFTER INSERT ON public.bills
  FOR EACH ROW EXECUTE FUNCTION app_private.tg_bill_notify();

-- ── trigger: การชำระเงิน → แจ้งสมาชิก + แจ้งเจ้าหน้าที่เมื่อมีสลิปรอตรวจ ──
CREATE OR REPLACE FUNCTION app_private.tg_payment_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_name TEXT;
BEGIN
  IF NEW.status::TEXT = 'approved' AND (TG_OP = 'INSERT' OR OLD.status::TEXT <> 'approved') THEN
    PERFORM app_private.enqueue_member(NEW.member_id, 'payment_received',
      jsonb_build_object('bill_id', NEW.bill_id, 'amount', NEW.amount, 'receipt_no', NEW.receipt_no, 'paid_at', NEW.paid_at),
      'paid:' || NEW.id);
  END IF;
  IF NEW.status::TEXT = 'pending' AND (TG_OP = 'INSERT' OR OLD.status::TEXT <> 'pending') THEN
    SELECT first_name || ' ' || last_name INTO v_name FROM public.members WHERE id = NEW.member_id;
    PERFORM app_private.notify_roles(ARRAY['super_admin', 'village_admin', 'finance'], 'slip_pending',
      'สลิปรอตรวจสอบ ฿' || to_char(NEW.amount, 'FM999,999,990.00'),
      COALESCE(v_name, '') || ' · บิล ' || NEW.bill_id, 'payments', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_payment_notify ON public.payments;
CREATE TRIGGER trg_payment_notify AFTER INSERT OR UPDATE OF status ON public.payments
  FOR EACH ROW EXECUTE FUNCTION app_private.tg_payment_notify();

-- ── trigger: ค่ามิเตอร์ผิดปกติ → แจ้งผู้ดูแล ─────────────────────
CREATE OR REPLACE FUNCTION app_private.tg_reading_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_name TEXT;
BEGIN
  IF NEW.anomaly IS NOT NULL THEN
    SELECT first_name || ' ' || last_name INTO v_name FROM public.members WHERE id = NEW.member_id;
    PERFORM app_private.notify_roles(ARRAY['super_admin', 'village_admin'], 'meter_anomaly',
      CASE NEW.anomaly::TEXT WHEN 'high_usage' THEN 'ใช้น้ำสูงผิดปกติ' WHEN 'suspected_leak' THEN 'สงสัยน้ำรั่ว' ELSE 'มิเตอร์ผิดปกติ' END,
      COALESCE(v_name, '') || ' · มิเตอร์ ' || NEW.meter_no || ' · ' || (NEW.curr_reading - NEW.prev_reading) || ' ลบ.ม.',
      'meter', NEW.member_id::TEXT);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_reading_notify ON public.meter_readings;
CREATE TRIGGER trg_reading_notify AFTER INSERT ON public.meter_readings
  FOR EACH ROW EXECUTE FUNCTION app_private.tg_reading_notify();

-- ── trigger: ผู้ใช้น้ำแจ้งซ่อม → แจ้งผู้ดูแล ─────────────────────
CREATE OR REPLACE FUNCTION app_private.tg_issue_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.reported_by_type::TEXT = 'member' THEN
    PERFORM app_private.notify_roles(ARRAY['super_admin', 'village_admin'], 'member_issue',
      'ผู้ใช้น้ำแจ้งซ่อม', left(NEW.description, 120) || COALESCE(' · ' || NEW.location, ''), 'maintenance', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_issue_notify ON public.maintenance_jobs;
CREATE TRIGGER trg_issue_notify AFTER INSERT ON public.maintenance_jobs
  FOR EACH ROW EXECUTE FUNCTION app_private.tg_issue_notify();

-- ── งานรายวัน: เตือนก่อนครบกำหนด 3 วัน + แจ้งเลยกำหนด ─────────────
CREATE OR REPLACE FUNCTION app_private.run_daily_notifications()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_today DATE := app_private.today_th();
  b       public.bills%ROWTYPE;
  v_due   INT := 0;
  v_over  INT := 0;
  v_new_overdue INT;
BEGIN
  FOR b IN SELECT * FROM public.bills WHERE status::TEXT = 'pending' AND due_date = v_today + 3 LOOP
    IF app_private.enqueue_member(b.member_id, 'due_soon', app_private.bill_payload(b), 'due3:' || b.id) IS NOT NULL THEN
      v_due := v_due + 1;
    END IF;
  END LOOP;
  FOR b IN SELECT * FROM public.bills WHERE status::TEXT = 'overdue' AND due_date >= v_today - 3 LOOP
    IF app_private.enqueue_member(b.member_id, 'overdue', app_private.bill_payload(b), 'overdue:' || b.id) IS NOT NULL THEN
      v_over := v_over + 1;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_new_overdue FROM public.bills
  WHERE status::TEXT = 'overdue' AND due_date = v_today - 1;
  IF v_new_overdue > 0 THEN
    PERFORM app_private.notify_roles(ARRAY['super_admin', 'village_admin', 'finance'], 'new_overdue',
      'บิลเลยกำหนดชำระใหม่ ' || v_new_overdue || ' รายการ', NULL, 'debtors', NULL);
  END IF;
  RETURN jsonb_build_object('due_soon', v_due, 'overdue', v_over, 'new_overdue', v_new_overdue);
END;
$$;

-- run_daily_billing (เฟส 0) เรียกงานแจ้งเตือนต่อท้าย
CREATE OR REPLACE FUNCTION app_private.run_daily_billing()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_today   DATE := app_private.today_th();
  v_fee     NUMERIC;
  v_overdue INT;
  v_fees    INT;
  v_notify  JSONB;
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

  -- ส่งแจ้งเตือนวันละครั้ง (แอปเรียกฟังก์ชันนี้ได้หลายครั้ง — กันซ้ำด้วยวันที่)
  IF (SELECT value FROM public.system_config WHERE key = 'last_notify_date') IS DISTINCT FROM v_today::TEXT THEN
    v_notify := app_private.run_daily_notifications();
    INSERT INTO public.system_config AS c (key, value, updated_at) VALUES ('last_notify_date', v_today::TEXT, now())
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now();
  END IF;

  RETURN jsonb_build_object('overdue', v_overdue, 'late_fee_updated', v_fees, 'date', v_today, 'notify', v_notify);
END;
$$;

-- ── เจ้าหน้าที่: ประกาศ / เตือนค้างชำระ ───────────────────────
DROP FUNCTION IF EXISTS public.broadcast_announcement(TEXT, TEXT, INT);
CREATE FUNCTION public.broadcast_announcement(p_title TEXT, p_message TEXT, p_village_id INT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id    BIGINT;
  v_sent  INT := 0;
  v_total INT := 0;
  m       RECORD;
BEGIN
  PERFORM app_private.require_role(ARRAY['super_admin', 'village_admin']);
  IF NULLIF(trim(p_title), '') IS NULL OR NULLIF(trim(p_message), '') IS NULL THEN
    RAISE EXCEPTION 'กรุณากรอกหัวข้อและข้อความ';
  END IF;
  INSERT INTO public.announcements (title, message, village_id, created_by)
  VALUES (trim(p_title), trim(p_message), p_village_id, app_private.jwt_profile_id()) RETURNING id INTO v_id;

  FOR m IN SELECT id FROM public.members
           WHERE NOT COALESCE(is_deleted, false) AND status::TEXT <> 'closed'
             AND (p_village_id IS NULL OR village_id = p_village_id) LOOP
    v_total := v_total + 1;
    IF app_private.enqueue_member(m.id, 'announcement',
         jsonb_build_object('title', trim(p_title), 'message', trim(p_message)), 'ann:' || v_id || ':' || m.id) IS NOT NULL THEN
      v_sent := v_sent + 1;
    END IF;
  END LOOP;
  UPDATE public.announcements SET recipients = v_sent WHERE id = v_id;
  RETURN jsonb_build_object('id', v_id, 'queued', v_sent, 'members', v_total, 'no_channel', v_total - v_sent);
END;
$$;

DROP FUNCTION IF EXISTS public.send_overdue_reminders(BIGINT[]);
CREATE FUNCTION public.send_overdue_reminders(p_member_ids BIGINT[] DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_today DATE := app_private.today_th();
  r       RECORD;
  v_sent  INT := 0;
  v_total INT := 0;
BEGIN
  PERFORM app_private.require_role(ARRAY['super_admin', 'village_admin', 'finance']);
  FOR r IN
    SELECT b.member_id, count(*) AS n, sum(b.total) AS total, min(b.due_date) AS oldest,
           string_agg(b.period_label, ', ' ORDER BY b.period_year, b.period_month) AS periods
    FROM public.bills b
    WHERE b.status::TEXT = 'overdue' AND (p_member_ids IS NULL OR b.member_id = ANY (p_member_ids))
    GROUP BY b.member_id
  LOOP
    v_total := v_total + 1;
    IF app_private.enqueue_member(r.member_id, 'overdue_reminder',
         jsonb_build_object('count', r.n, 'total', r.total, 'oldest_due', r.oldest, 'periods', r.periods),
         'remind:' || r.member_id || ':' || v_today) IS NOT NULL THEN
      v_sent := v_sent + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('queued', v_sent, 'debtors', v_total, 'no_channel', v_total - v_sent);
END;
$$;

DROP FUNCTION IF EXISTS public.get_outbox_stats();
CREATE FUNCTION public.get_outbox_stats()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_role(ARRAY['super_admin', 'village_admin', 'finance']);
  RETURN jsonb_build_object(
    'members_total',  (SELECT count(*) FROM public.members WHERE NOT COALESCE(is_deleted, false)),
    'members_line',   (SELECT count(*) FROM public.member_access a JOIN public.members m ON m.id = a.member_id
                       WHERE a.line_user_id IS NOT NULL AND NOT COALESCE(m.is_deleted, false)),
    'by_status',      (SELECT COALESCE(jsonb_object_agg(status, n), '{}'::JSONB)
                       FROM (SELECT status, count(*) n FROM public.notification_outbox GROUP BY status) s),
    'recent',         (SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::JSONB) FROM (
                         SELECT o.id, o.channel, o.kind, o.status, o.attempts, o.last_error, o.created_at, o.sent_at,
                                m.first_name || ' ' || m.last_name AS member
                         FROM public.notification_outbox o LEFT JOIN public.members m ON m.id = o.member_id
                         ORDER BY o.created_at DESC LIMIT 30) x),
    'announcements',  (SELECT COALESCE(jsonb_agg(a ORDER BY a.created_at DESC), '[]'::JSONB) FROM (
                         SELECT id, title, village_id, recipients, created_at FROM public.announcements
                         ORDER BY created_at DESC LIMIT 10) a)
  );
END;
$$;

-- ── สำหรับ Edge Function (service_role เท่านั้น) ─────────────────
DROP FUNCTION IF EXISTS public.outbox_claim(INT);
CREATE FUNCTION public.outbox_claim(p_limit INT DEFAULT 50)
RETURNS SETOF public.notification_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- รายการที่ค้าง "sending" เกิน 10 นาที (function ล่มกลางทาง) กลับมาส่งใหม่
  UPDATE public.notification_outbox SET status = 'pending'
  WHERE status = 'sending' AND created_at < now() - INTERVAL '10 minutes' AND attempts < 5;
  RETURN QUERY
    UPDATE public.notification_outbox o SET status = 'sending', attempts = o.attempts + 1
    WHERE o.id IN (SELECT id FROM public.notification_outbox
                   WHERE status = 'pending' ORDER BY created_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
    RETURNING o.*;
END;
$$;

DROP FUNCTION IF EXISTS public.outbox_complete(BIGINT, BOOLEAN, TEXT);
CREATE FUNCTION public.outbox_complete(p_id BIGINT, p_ok BOOLEAN, p_error TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.notification_outbox
  SET status     = CASE WHEN p_ok THEN 'sent' WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
      sent_at    = CASE WHEN p_ok THEN now() END,
      last_error = CASE WHEN p_ok THEN NULL ELSE left(p_error, 500) END
  WHERE id = p_id;
END;
$$;

-- ผูก/ยกเลิก LINE (เรียกจาก webhook ด้วย service_role)
DROP FUNCTION IF EXISTS public.line_link_member(TEXT, TEXT, TEXT);
CREATE FUNCTION public.line_link_member(p_line_user_id TEXT, p_meter TEXT, p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_login JSONB := public.member_login(p_meter, p_code);   -- ใช้การตรวจรหัส + จำกัดการเดาเดียวกับ portal
  v_id    BIGINT;
BEGIN
  IF v_login ? 'error' THEN RETURN v_login; END IF;
  v_id := (v_login -> 'member' ->> 'id')::BIGINT;
  UPDATE public.member_access SET line_user_id = NULL, line_linked_at = NULL WHERE line_user_id = p_line_user_id AND member_id <> v_id;
  UPDATE public.member_access SET line_user_id = p_line_user_id, line_linked_at = now() WHERE member_id = v_id;
  RETURN jsonb_build_object('member', v_login -> 'member');
END;
$$;

DROP FUNCTION IF EXISTS public.line_unlink(TEXT);
CREATE FUNCTION public.line_unlink(p_line_user_id TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.member_access SET line_user_id = NULL, line_linked_at = NULL WHERE line_user_id = p_line_user_id;
END;
$$;

-- สรุปยอดค้างสำหรับตอบในแชท LINE
DROP FUNCTION IF EXISTS public.line_member_summary(TEXT);
CREATE FUNCTION public.line_member_summary(p_line_user_id TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'member_id', m.id, 'name', m.first_name || ' ' || m.last_name, 'meter_no', m.meter_no,
    'portal_code', a.portal_code,
    'unpaid', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'period', b.period_label, 'total', b.total, 'due_date', b.due_date, 'status', b.status)
                        ORDER BY b.period_year, b.period_month)
                        FROM public.bills b WHERE b.member_id = m.id AND b.status::TEXT IN ('pending', 'overdue')), '[]'::JSONB),
    'org', app_private.public_org_info())
  FROM public.member_access a JOIN public.members m ON m.id = a.member_id WHERE a.line_user_id = p_line_user_id;
$$;

-- ══════════════════════════════════════════════════════════════
-- 4. Storage: ไฟล์ที่ผู้ใช้น้ำอัปโหลด (สลิป/รูปแจ้งซ่อม) — path ต้องขึ้นต้นด้วย m{member_id}/
-- ══════════════════════════════════════════════════════════════
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('member-uploads', 'member-uploads', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

DROP POLICY IF EXISTS aquaflow_member_upload ON storage.objects;
DROP POLICY IF EXISTS aquaflow_member_read   ON storage.objects;
DROP POLICY IF EXISTS aquaflow_staff_read_member_uploads ON storage.objects;
CREATE POLICY aquaflow_member_upload ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'member-uploads'
              AND name LIKE 'm' || COALESCE((SELECT app_private.jwt_member_id())::TEXT, '-') || '/%');
CREATE POLICY aquaflow_member_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'member-uploads'
         AND name LIKE 'm' || COALESCE((SELECT app_private.jwt_member_id())::TEXT, '-') || '/%');
CREATE POLICY aquaflow_staff_read_member_uploads ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'member-uploads' AND (SELECT app_private.staff_role()) IS NOT NULL);

-- ══════════════════════════════════════════════════════════════
-- 5. สิทธิ์ + RLS + realtime
-- ══════════════════════════════════════════════════════════════
ALTER TABLE public.notifications         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_outbox   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_access         ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notifications, public.notification_outbox, public.announcements, public.portal_login_attempts,
  public.member_access FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.notifications_id_seq, public.notification_outbox_id_seq, public.announcements_id_seq
  FROM anon, authenticated;
GRANT SELECT ON public.notifications TO authenticated;
DROP POLICY IF EXISTS own_select ON public.notifications;
CREATE POLICY own_select ON public.notifications FOR SELECT TO authenticated
  USING (user_id = app_private.jwt_profile_id() AND (SELECT app_private.staff_role()) IS NOT NULL);

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC, anon;
GRANT  EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private TO authenticated;

DO $$
DECLARE f TEXT;
BEGIN
  -- staff / member RPCs
  FOREACH f IN ARRAY ARRAY['mark_notifications_read(bigint[])', 'member_overview()',
    'member_submit_payment(text,numeric,text,text)', 'member_report_issue(text,text,text,text)',
    'regenerate_portal_code(bigint)', 'get_portal_codes(bigint[])', 'broadcast_announcement(text,text,integer)',
    'send_overdue_reminders(bigint[])', 'get_outbox_stats()'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
  -- portal login: เปิดให้ผู้ที่ยังไม่ login
  REVOKE EXECUTE ON FUNCTION public.member_login(text, text) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.member_login(text, text) TO anon, authenticated;
  -- เฉพาะ Edge Function (service_role)
  FOREACH f IN ARRAY ARRAY['outbox_claim(integer)', 'outbox_complete(bigint,boolean,text)',
    'line_link_member(text,text,text)', 'line_unlink(text)', 'line_member_summary(text)'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
    END IF;
  END LOOP;
END $$;

-- ตารางทุกตัวที่แอป subscribe ต้องอยู่ใน publication — ถ้าขาดแม้ตัวเดียว
-- Realtime จะไม่ส่งการเปลี่ยนแปลงของ "ทุกตาราง" ในช่องนั้น (และไม่แจ้ง error)
DO $$
DECLARE t TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN RETURN; END IF;
  FOREACH t IN ARRAY ARRAY['members', 'bills', 'payments', 'meter_readings', 'maintenance_jobs', 'water_production',
                           'water_quality', 'villages', 'rate_tiers', 'master_data', 'billing_periods',
                           'bill_adjustments', 'notifications'] LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

COMMIT;

-- ══════════════════════════════════════════════════════════════
-- 6. (ทำหลังสร้าง LINE OA และ deploy Edge Function แล้ว — ดู docs/LINE_SETUP.md)
--    ตั้งเวลาเรียก line-dispatch ทุกนาทีเพื่อส่งข้อความในคิว
-- ══════════════════════════════════════════════════════════════
-- SELECT vault.create_secret('https://<project-ref>.supabase.co/functions/v1', 'aquaflow_functions_url');
-- SELECT vault.create_secret('<สุ่มข้อความยาวๆ เดียวกับ DISPATCH_SECRET ของ function>', 'aquaflow_dispatch_secret');
-- CREATE EXTENSION IF NOT EXISTS pg_net;
-- SELECT cron.schedule('aquaflow-line-dispatch', '* * * * *', $cron$
--   SELECT net.http_post(
--     url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'aquaflow_functions_url') || '/line-dispatch',
--     headers := jsonb_build_object('Content-Type', 'application/json',
--                  'x-dispatch-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'aquaflow_dispatch_secret')),
--     body    := '{}'::jsonb)
--   WHERE EXISTS (SELECT 1 FROM public.notification_outbox WHERE status = 'pending');
-- $cron$);
