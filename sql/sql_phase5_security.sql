-- ══════════════════════════════════════════════════════════════
-- Phase 5 — ความปลอดภัย / เชื่อมข้อมูลด้วย ID / PDPA
-- (รันหลัง sql_phase4_field.sql — และต้องรันไฟล์นี้ซ้ำทุกครั้งที่รันไฟล์เก่าซ้ำ)
--
--   1. สิทธิ์ตามหน้าที่ (บังคับที่ server)
--        meter_reader  จดมิเตอร์ผ่าน save_meter_reading เท่านั้น, แก้สมาชิกได้แค่พิกัด/มิเตอร์,
--                      รับเงินสดได้ แต่โอน/พร้อมเพย์ต้องให้การเงินอนุมัติ
--        finance       ออกบิล/ยกเลิกบิล/อนุมัติ-ยกเลิกใบเสร็จ
--        admin         ทุกอย่าง + ลบสมาชิก
--      ยอดเงินในบิลเปลี่ยนได้ผ่าน "ปรับปรุงยอด" (ใบลดหนี้/เพิ่มหนี้) เท่านั้น
--      ใบเสร็จที่อนุมัติแล้วแก้ยอด/ช่องทาง/วันที่ไม่ได้ — ยกเลิกได้อย่างเดียว
--      บิลจ่ายแล้ว/ยกเลิกใบเสร็จ → server ปรับสถานะบิลเอง
--   2. จดมิเตอร์ = RPC เดียว (บิล + การอ่าน + last_read ใน transaction เดียว, คิดค่าน้ำที่ server)
--   3. เชื่อมด้วย ID: ผู้ทำรายการเป็น uuid (profiles.id), งวดเป็น (ปี, เดือน),
--      FK คู่ payments/meter_readings → bills(id, member_id), unique กันจด/ชำระซ้ำ, server ออก id
--   4. เลขบัตรประชาชนเข้ารหัส (pgcrypto + key ใน Vault) — เห็นแค่ 4 ตัวท้าย, ดูเต็มได้เฉพาะ admin (บันทึก audit)
--   5. audit: บันทึกที่ server ครบทุกตารางหลัก, ตัด secret/เลขบัตรออก, hash chain ตรวจการแก้ไขย้อนหลัง,
--      client เขียน audit ตรงไม่ได้ (ผ่าน log_event เท่านั้น)
--   6. Login: bcrypt cost 12, ข้อความ error เดียวกัน (เดาบัญชีไม่ได้), ออกจากระบบ = เพิกถอน token,
--      session นานสุด 7 วัน, portal สมาชิก 7 วัน
--   7. PDPA: คำขอใช้สิทธิ์เจ้าของข้อมูล, รับทราบประกาศความเป็นส่วนตัว, ข้อมูลของฉัน,
--      ทำข้อมูลนิรนาม, ลบข้อมูลเกินระยะเวลาเก็บ
--   8. ปิดช่องโหว่: API key อ่านไม่ได้, LINE หลุดเมื่อเปลี่ยนรหัส portal, trigger สมัครสมาชิกเก่า,
--      helper ใน app_private (sign_jwt) เรียกจาก client ไม่ได้
--
-- วิธีติดตั้ง: SQL Editor → รันไฟล์นี้ทั้งไฟล์ (transaction เดียว, รันซ้ำได้)
-- หลังรัน: Authentication → Sign In / Providers → ปิด "Allow new users to sign up"
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- 0. Helpers
-- ══════════════════════════════════════════════════════════════
-- เขียนจาก RPC/งานระบบที่เชื่อถือได้ (ไม่ใช่ client ยิงตรง)
CREATE OR REPLACE FUNCTION app_private.trusted()
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE(current_setting('app.trusted', true) = 'on', false)
      OR COALESCE(current_setting('app.bypass_period_lock', true) = 'on', false);
$$;

-- request มาจากเจ้าหน้าที่ยิงตรงผ่าน REST (RLS ให้เฉพาะเจ้าหน้าที่เขียนตรงได้ — RPC ของสมาชิก/งานระบบไม่มี staff_role)
CREATE OR REPLACE FUNCTION app_private.client_write()
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT app_private.staff_role() IS NOT NULL AND NOT app_private.trusted();
$$;

CREATE OR REPLACE FUNCTION app_private.is_finance()
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE(app_private.staff_role() IN ('super_admin', 'village_admin', 'finance'), false);
$$;

CREATE OR REPLACE FUNCTION app_private.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE(app_private.staff_role() IN ('super_admin', 'village_admin'), false);
$$;

-- ชื่อเดือนแบบเดียวกับแอป (currentPeriod) — ป้ายงวดสร้างจาก (ปี, เดือน) เสมอ
CREATE OR REPLACE FUNCTION app_private.period_label(p_year INT, p_month INT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT (ARRAY['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'])[p_month]
         || ' ' || p_year;
$$;

-- id ที่ server ออกให้ (PAY-/MNT-…): เวลา + สุ่ม — ไม่ชนกันแม้หลายเครื่องบันทึกพร้อมกัน
CREATE OR REPLACE FUNCTION app_private.new_id(p_prefix TEXT)
RETURNS TEXT LANGUAGE sql VOLATILE SET search_path = '' AS $$
  SELECT p_prefix || '-' || (extract(epoch FROM clock_timestamp()) * 1000)::BIGINT
         || '-' || encode(extensions.gen_random_bytes(3), 'hex');
$$;

CREATE OR REPLACE FUNCTION app_private.actor_name()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT full_name FROM public.profiles WHERE id = app_private.jwt_profile_id();
$$;

-- ══════════════════════════════════════════════════════════════
-- 1. Session: เพิกถอน token รายเครื่อง (ออกจากระบบ) + อายุสูงสุด
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS app_private.revoked_tokens (
  jti        TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE OR REPLACE FUNCTION app_private.token_revoked()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM app_private.revoked_tokens WHERE jti = auth.jwt() ->> 'jti');
$$;

CREATE OR REPLACE FUNCTION app_private.staff_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.role::TEXT
  FROM public.profiles p
  WHERE p.id = app_private.jwt_profile_id()
    AND p.is_active
    AND p.token_version::TEXT = (auth.jwt() ->> 'tv')
    AND NOT app_private.token_revoked();
$$;

CREATE OR REPLACE FUNCTION app_private.jwt_member_id()
RETURNS BIGINT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.id FROM public.members m JOIN public.member_access a ON a.member_id = m.id
  WHERE auth.jwt() ->> 'app_role' = 'member'
    AND auth.jwt() ->> 'member_id' ~ '^[0-9]{1,18}$'
    AND m.id = (auth.jwt() ->> 'member_id')::BIGINT
    AND NOT COALESCE(m.is_deleted, false)
    AND left(md5(a.portal_code), 8) = auth.jwt() ->> 'pc'
    AND NOT app_private.token_revoked();
$$;

DROP FUNCTION IF EXISTS app_private.issue_session(UUID);
-- session ใหม่: มี jti (ไว้เพิกถอน) และ auth_time (เวลาที่ login จริง — ต่ออายุได้ไม่เกิน 7 วัน)
CREATE OR REPLACE FUNCTION app_private.issue_session(p_profile_id UUID, p_auth_time BIGINT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c_ttl CONSTANT INT := 12 * 3600;
  v     public.profiles%ROWTYPE;
  v_now BIGINT := extract(epoch FROM now())::BIGINT;
BEGIN
  SELECT * INTO v FROM public.profiles WHERE id = p_profile_id;
  RETURN jsonb_build_object(
    'token', app_private.sign_jwt(jsonb_build_object(
      'sub',       v.id,
      'role',      'authenticated',
      'aud',       'authenticated',
      'iat',       v_now,
      'exp',       v_now + c_ttl,
      'jti',       gen_random_uuid(),
      'auth_time', COALESCE(p_auth_time, v_now),
      'tv',        v.token_version,
      'app_role',  v.role
    )),
    'expires_at', v_now + c_ttl,
    'profile', jsonb_build_object(
      'id', v.id, 'full_name', v.full_name, 'email', v.email,
      'username', v.username, 'phone', v.phone, 'role', v.role,
      'village_id', v.village_id, 'is_active', v.is_active
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION app_private.revoke_current_token()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_jti TEXT := auth.jwt() ->> 'jti';
  v_exp TEXT := auth.jwt() ->> 'exp';
BEGIN
  IF v_jti IS NULL THEN RETURN; END IF;
  INSERT INTO app_private.revoked_tokens (jti, expires_at)
  VALUES (v_jti, CASE WHEN v_exp ~ '^[0-9]+$' THEN to_timestamp(v_exp::BIGINT) ELSE now() + INTERVAL '31 days' END)
  ON CONFLICT (jti) DO NOTHING;
END;
$$;

DROP FUNCTION IF EXISTS public.refresh_session();
CREATE FUNCTION public.refresh_session()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c_max_age CONSTANT INT := 7 * 86400;
  v_auth BIGINT := CASE WHEN auth.jwt() ->> 'auth_time' ~ '^[0-9]+$' THEN (auth.jwt() ->> 'auth_time')::BIGINT
                        WHEN auth.jwt() ->> 'iat' ~ '^[0-9]+$' THEN (auth.jwt() ->> 'iat')::BIGINT END;
BEGIN
  IF app_private.staff_role() IS NULL THEN
    RAISE EXCEPTION 'SESSION_REVOKED' USING ERRCODE = '28000';
  END IF;
  IF v_auth IS NULL OR extract(epoch FROM now()) - v_auth > c_max_age THEN
    RAISE EXCEPTION 'SESSION_REVOKED' USING ERRCODE = '28000';
  END IF;
  RETURN app_private.issue_session(app_private.jwt_profile_id(), v_auth);
END;
$$;

-- ออกจากระบบ: token นี้ใช้ไม่ได้ทันที (เครื่องอื่นที่ login อยู่ไม่หลุด)
DROP FUNCTION IF EXISTS public.logout_session();
CREATE FUNCTION public.logout_session()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF app_private.jwt_profile_id() IS NULL AND app_private.jwt_member_id() IS NULL THEN RETURN; END IF;
  PERFORM app_private.revoke_current_token();
END;
$$;

-- ── รหัสผ่าน ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_private.check_password_policy(p_password TEXT)
RETURNS VOID LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF p_password IS NULL OR length(p_password) < 8
     OR p_password !~ '[A-Za-z]' OR p_password !~ '[0-9]' THEN
    RAISE EXCEPTION 'รหัสผ่านต้องมีอย่างน้อย 8 ตัว และมีทั้งตัวอักษรและตัวเลข' USING ERRCODE = '22023';
  END IF;
  IF lower(p_password) IN ('password1', 'password12', 'password123', 'passw0rd', 'passw0rd1', 'p@ssw0rd',
       'abc12345', 'abcd1234', 'qwerty123', 'qwerty12', 'admin123', 'admin1234', 'aquaflow1', 'iloveyou1',
       '12345678a', 'a12345678', '1q2w3e4r', '1qaz2wsx', 'welcome1', 'letmein1', 'test1234')
     OR lower(p_password) ~ '^(.)\1+[0-9]*$' THEN
    RAISE EXCEPTION 'รหัสผ่านนี้เดาง่ายเกินไป กรุณาตั้งใหม่' USING ERRCODE = '22023';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.hash_password(p_password TEXT)
RETURNS TEXT LANGUAGE sql VOLATILE SET search_path = '' AS $$
  SELECT extensions.crypt(p_password, extensions.gen_salt('bf', 12));
$$;

DROP FUNCTION IF EXISTS public.verify_login(TEXT, TEXT);
CREATE FUNCTION public.verify_login(p_identifier TEXT, p_password TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c_max_fail CONSTANT INT := 5;
  c_lock     CONSTANT INTERVAL := INTERVAL '15 minutes';
  -- ข้อความเดียวทุกกรณี (ไม่มีบัญชี / ปิดใช้ / ยังไม่ตั้งรหัส / ล็อก / รหัสผิด) — เดาไม่ได้ว่ามีบัญชีหรือไม่
  c_fail     CONSTANT TEXT := 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง (ใส่ผิด 5 ครั้ง บัญชีจะถูกพัก 15 นาที)';
  c_dummy    CONSTANT TEXT := '$2a$12$C6UzMDM.H6dfI/f/IKcEeO5jHy0iU4mDF7GJbzVmJYLvJS5n3d4cS';
  v          public.profiles%ROWTYPE;
  v_id       TEXT := lower(trim(COALESCE(p_identifier, '')));
  v_digits   TEXT := regexp_replace(COALESCE(p_identifier, ''), '[^0-9]', '', 'g');
  v_ok       BOOLEAN;
BEGIN
  IF v_id = '' OR COALESCE(p_password, '') = '' THEN
    RETURN jsonb_build_object('error', 'กรุณากรอกข้อมูลและรหัสผ่าน');
  END IF;

  SELECT * INTO v
  FROM public.profiles p
  WHERE lower(COALESCE(p.email, ''))    = v_id
     OR lower(COALESCE(p.username, '')) = v_id
     OR (length(v_digits) >= 9
         AND regexp_replace(COALESCE(p.phone, ''), '[^0-9]', '', 'g') = v_digits)
  ORDER BY p.is_active DESC, p.password_hash IS NOT NULL DESC, p.created_at
  LIMIT 1;

  -- ตรวจรหัสเสมอ (ใช้ hash หลอกถ้าไม่มีบัญชี) — เวลาตอบเท่ากัน
  v_ok := COALESCE(v.password_hash, c_dummy) = extensions.crypt(p_password, COALESCE(v.password_hash, c_dummy))
          AND v.password_hash IS NOT NULL;

  IF v.id IS NULL OR NOT v.is_active OR v.password_hash IS NULL THEN
    RETURN jsonb_build_object('error', c_fail);
  END IF;
  IF v.locked_until IS NOT NULL AND v.locked_until > now() THEN
    RETURN jsonb_build_object('error', c_fail);
  END IF;

  IF NOT v_ok THEN
    UPDATE public.profiles
    SET failed_login_count = failed_login_count + 1,
        locked_until = CASE WHEN failed_login_count + 1 >= c_max_fail
                            THEN now() + c_lock ELSE locked_until END
    WHERE id = v.id;
    RETURN jsonb_build_object('error', c_fail);
  END IF;

  UPDATE public.profiles
  SET failed_login_count = 0, locked_until = NULL, last_login_at = now(),
      -- hash รุ่นเก่า (cost < 12) → เข้ารหัสใหม่ตอน login สำเร็จ
      password_hash = CASE WHEN substring(password_hash FROM 5 FOR 2) ~ '^[0-9]{2}$'
                                AND substring(password_hash FROM 5 FOR 2)::INT < 12
                           THEN app_private.hash_password(p_password) ELSE password_hash END
  WHERE id = v.id;

  RETURN app_private.issue_session(v.id);
END;
$$;

DROP FUNCTION IF EXISTS public.change_my_password(TEXT, TEXT);
CREATE FUNCTION public.change_my_password(p_current TEXT, p_new TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid  UUID := app_private.jwt_profile_id();
  v_hash TEXT;
BEGIN
  IF app_private.staff_role() IS NULL THEN
    RAISE EXCEPTION 'SESSION_REVOKED' USING ERRCODE = '28000';
  END IF;
  SELECT password_hash INTO v_hash FROM public.profiles WHERE id = v_uid;
  IF v_hash IS NULL OR v_hash <> extensions.crypt(COALESCE(p_current, ''), v_hash) THEN
    RAISE EXCEPTION 'รหัสผ่านปัจจุบันไม่ถูกต้อง' USING ERRCODE = '28P01';
  END IF;
  PERFORM app_private.check_password_policy(p_new);
  UPDATE public.profiles
  SET password_hash = app_private.hash_password(p_new),
      token_version = token_version + 1,
      updated_at    = now()
  WHERE id = v_uid;
  RETURN app_private.issue_session(v_uid);
END;
$$;

DROP FUNCTION IF EXISTS public.set_profile_password(UUID, TEXT);
CREATE FUNCTION public.set_profile_password(p_user_id UUID, p_password TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_super_admin();
  PERFORM app_private.check_password_policy(p_password);
  UPDATE public.profiles
  SET password_hash      = app_private.hash_password(p_password),
      token_version      = token_version + 1,
      failed_login_count = 0,
      locked_until       = NULL,
      updated_at         = now()
  WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบผู้ใช้'; END IF;
  IF p_user_id = app_private.jwt_profile_id() THEN
    RETURN app_private.issue_session(p_user_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP FUNCTION IF EXISTS public.create_profile_user(TEXT, TEXT, TEXT, TEXT, TEXT, user_role, INT);
CREATE FUNCTION public.create_profile_user(
  p_email     TEXT,
  p_password  TEXT,
  p_full_name TEXT,
  p_username  TEXT      DEFAULT '',
  p_phone     TEXT      DEFAULT '',
  p_role      public.user_role DEFAULT 'meter_reader',
  p_village   INT       DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid      UUID := gen_random_uuid();
  v_username TEXT := NULLIF(trim(p_username), '');
  v_phone    TEXT := NULLIF(trim(p_phone), '');
  v_email    TEXT := NULLIF(lower(trim(p_email)), '');
BEGIN
  PERFORM app_private.require_super_admin();
  PERFORM app_private.check_password_policy(p_password);
  IF NULLIF(trim(p_full_name), '') IS NULL THEN RAISE EXCEPTION 'กรุณากรอกชื่อ-นามสกุล'; END IF;
  IF v_email IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles WHERE lower(COALESCE(email, '')) = v_email) THEN
    RAISE EXCEPTION 'Email นี้มีอยู่ในระบบแล้ว';
  END IF;
  IF v_username IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles WHERE lower(COALESCE(username, '')) = lower(v_username)) THEN
    RAISE EXCEPTION 'Username นี้ถูกใช้แล้ว';
  END IF;
  IF v_phone IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = regexp_replace(v_phone, '[^0-9]', '', 'g')
  ) THEN
    RAISE EXCEPTION 'เบอร์โทรนี้ถูกใช้แล้ว';
  END IF;
  INSERT INTO public.profiles (id, full_name, email, username, phone, role, village_id, is_active,
                               password_hash, created_at, updated_at)
  VALUES (v_uid, trim(p_full_name), v_email, v_username, v_phone, p_role, p_village, true,
          app_private.hash_password(p_password), now(), now());
  RETURN v_uid;
END;
$$;

-- ── portal สมาชิก: token 7 วัน + jti ─────────────────────────
CREATE OR REPLACE FUNCTION app_private.issue_member_session(p_member_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c_ttl CONSTANT INT := 7 * 86400;
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
      'jti',       gen_random_uuid(),
      'app_role',  'member',
      'member_id', v.id,
      'pc',        left(md5(v_pc), 8)
    )),
    'expires_at', v_now + c_ttl,
    'member', jsonb_build_object('id', v.id, 'name', v.first_name || ' ' || v.last_name, 'meter_no', v.meter_no)
  );
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 2. เลขบัตรประชาชน — เข้ารหัส (key ใน Vault), เก็บ hash ไว้กันซ้ำ, แสดงแค่ 4 ตัวท้าย
-- ══════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'app_pii_key') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'base64'), 'app_pii_key',
                                'AquaFlow: กุญแจเข้ารหัสข้อมูลส่วนบุคคล (ห้ามลบ — ลบแล้วถอดรหัสเลขบัตรไม่ได้)');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app_private.pii_key()
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v TEXT;
BEGIN
  SELECT decrypted_secret INTO v FROM vault.decrypted_secrets WHERE name = 'app_pii_key' LIMIT 1;
  IF COALESCE(v, '') = '' THEN RAISE EXCEPTION 'ไม่พบกุญแจเข้ารหัส app_pii_key ใน Vault'; END IF;
  RETURN v;
END;
$$;

-- ค่าที่เข้ารหัสแยกไว้ใน app_private (client อ่านไม่ได้เลย แม้ select * หรือ realtime) — members เก็บแค่ 4 ตัวท้าย
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS national_id_last4 TEXT;
CREATE TABLE IF NOT EXISTS app_private.member_pii (
  member_id        BIGINT PRIMARY KEY REFERENCES public.members(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  national_id_enc  BYTEA NOT NULL,
  national_id_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_member_pii_hash ON app_private.member_pii(national_id_hash);

-- national_id ในตาราง members เป็น NULL เสมอ — ค่าที่ส่งมา: NULL = ไม่เปลี่ยน, '' = ลบ, ตัวเลข = ตั้งใหม่
CREATE OR REPLACE FUNCTION app_private.tg_members_pii()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v      TEXT;
  v_hash TEXT;
BEGIN
  IF NEW.national_id IS NOT NULL THEN
    v := regexp_replace(NEW.national_id, '[^0-9]', '', 'g');
    IF v = '' THEN
      DELETE FROM app_private.member_pii WHERE member_id = NEW.id;
      NEW.national_id_last4 := NULL;
    ELSE
      IF length(v) NOT BETWEEN 6 AND 20 THEN RAISE EXCEPTION 'เลขบัตรประชาชนไม่ถูกต้อง'; END IF;
      v_hash := encode(extensions.hmac(v, app_private.pii_key(), 'sha256'), 'hex');
      IF EXISTS (SELECT 1 FROM app_private.member_pii p JOIN public.members m ON m.id = p.member_id
                 WHERE p.national_id_hash = v_hash AND p.member_id <> NEW.id AND NOT COALESCE(m.is_deleted, false)) THEN
        RAISE EXCEPTION 'เลขบัตรประชาชนนี้มีในระบบแล้ว' USING ERRCODE = '23505';
      END IF;
      INSERT INTO app_private.member_pii AS p (member_id, national_id_enc, national_id_hash)
      VALUES (NEW.id, extensions.pgp_sym_encrypt(v, app_private.pii_key()), v_hash)
      ON CONFLICT (member_id) DO UPDATE SET national_id_enc = excluded.national_id_enc, national_id_hash = excluded.national_id_hash;
      NEW.national_id_last4 := right(v, 4);
    END IF;
    NEW.national_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_members_pii ON public.members;
CREATE TRIGGER trg_members_pii BEFORE INSERT OR UPDATE ON public.members
  FOR EACH ROW EXECUTE FUNCTION app_private.tg_members_pii();

-- ย้ายข้อมูลเดิม (เลขซ้ำในข้อมูลเก่า: เก็บใบแรก ใบที่ซ้ำให้ตรวจเอง)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.members WHERE national_id IS NOT NULL ORDER BY COALESCE(is_deleted, false), id LOOP
    BEGIN
      UPDATE public.members SET national_id = national_id WHERE id = r.id;
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'สมาชิก % มีเลขบัตรประชาชนซ้ำกับคนอื่น — ไม่ได้ย้าย ตรวจสอบเอง', r.id;
    END;
  END LOOP;
END $$;
ALTER TABLE public.members DROP CONSTRAINT IF EXISTS members_national_id_key;

-- ดูเลขบัตรเต็ม — admin เท่านั้น และบันทึก audit ทุกครั้ง
DROP FUNCTION IF EXISTS public.reveal_national_id(BIGINT);
CREATE FUNCTION public.reveal_national_id(p_member_id BIGINT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v BYTEA;
BEGIN
  PERFORM app_private.require_role(ARRAY['super_admin', 'village_admin']);
  SELECT national_id_enc INTO v FROM app_private.member_pii WHERE member_id = p_member_id;
  IF v IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.audit_logs (table_name, record_id, action, new_data)
  VALUES ('members', p_member_id::TEXT, 'reveal_pii', jsonb_build_object('field', 'national_id'));
  RETURN extensions.pgp_sym_decrypt(v, app_private.pii_key());
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 3. คอลัมน์ ID แทนชื่อ + ความถูกต้องของความสัมพันธ์
-- ══════════════════════════════════════════════════════════════
ALTER TABLE public.bills          ADD COLUMN IF NOT EXISTS cancelled_by_id UUID REFERENCES public.profiles(id);
ALTER TABLE public.payments       ADD COLUMN IF NOT EXISTS cancelled_by_id UUID REFERENCES public.profiles(id);
ALTER TABLE public.cashbook_entries
  ADD COLUMN IF NOT EXISTS voided_by_id UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS category_id  UUID REFERENCES public.master_data(id);
ALTER TABLE public.meter_replacements ADD COLUMN IF NOT EXISTS replaced_by_id UUID REFERENCES public.profiles(id);
ALTER TABLE public.master_data
  ADD COLUMN IF NOT EXISTS created_by_id UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS updated_by_id UUID REFERENCES public.profiles(id);
ALTER TABLE public.meter_readings
  ADD COLUMN IF NOT EXISTS period_year  SMALLINT,
  ADD COLUMN IF NOT EXISTS period_month SMALLINT CHECK (period_month BETWEEN 1 AND 12);

-- meter_replacements.member_id: INTEGER → BIGINT ให้ตรง members.id และห้ามลบสมาชิกที่มีประวัติ
ALTER TABLE public.meter_replacements ALTER COLUMN member_id TYPE BIGINT;
ALTER TABLE public.meter_replacements DROP CONSTRAINT IF EXISTS meter_replacements_member_id_fkey;
ALTER TABLE public.meter_replacements ADD CONSTRAINT meter_replacements_member_id_fkey
  FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE RESTRICT;

-- เติมค่าจากข้อมูลเดิม
UPDATE public.meter_readings r SET period_year = b.period_year, period_month = b.period_month
FROM public.bills b WHERE r.bill_id = b.id AND r.period_year IS NULL;
UPDATE public.meter_readings
SET period_year = extract(year FROM reading_date)::INT + 543, period_month = extract(month FROM reading_date)::INT
WHERE period_year IS NULL;

UPDATE public.bills b SET cancelled_by_id = b.cancelled_by::UUID
WHERE b.cancelled_by_id IS NULL
  AND b.cancelled_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id::TEXT = lower(b.cancelled_by));
UPDATE public.cashbook_entries e SET category_id = d.id
FROM public.master_data d WHERE e.category_id IS NULL AND d.category = e.kind || '_category' AND d.code = e.category;

-- ป้ายงวดสร้างจาก (ปี, เดือน) เสมอ — ไม่มีทางไม่ตรงกัน
UPDATE public.bills SET period_label = app_private.period_label(period_year, period_month)
WHERE period_label IS DISTINCT FROM app_private.period_label(period_year, period_month);

-- FK คู่: สมาชิกของการชำระ/การอ่าน ต้องเป็นเจ้าของบิลนั้น
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bills_id_member_key') THEN
    ALTER TABLE public.bills ADD CONSTRAINT bills_id_member_key UNIQUE (id, member_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_bill_member_fkey') THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_bill_member_fkey
      FOREIGN KEY (bill_id, member_id) REFERENCES public.bills(id, member_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'readings_bill_member_fkey') THEN
    ALTER TABLE public.meter_readings ADD CONSTRAINT readings_bill_member_fkey
      FOREIGN KEY (bill_id, member_id) REFERENCES public.bills(id, member_id) NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE public.payments VALIDATE CONSTRAINT payments_bill_member_fkey;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'มีการชำระที่ member_id ไม่ตรงกับบิล — ข้อมูลใหม่ถูกบังคับแล้ว (ตรวจ: SELECT p.id FROM payments p JOIN bills b ON b.id = p.bill_id WHERE b.member_id <> p.member_id)';
  END;
  BEGIN
    ALTER TABLE public.meter_readings VALIDATE CONSTRAINT readings_bill_member_fkey;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'มีการอ่านมิเตอร์ที่ member_id ไม่ตรงกับบิล — ข้อมูลใหม่ถูกบังคับแล้ว';
  END;
  BEGIN
    ALTER TABLE public.members VALIDATE CONSTRAINT members_deleted_by_fkey;
  EXCEPTION WHEN foreign_key_violation OR undefined_object THEN
    RAISE NOTICE 'members.deleted_by มีค่าที่ไม่ใช่ผู้ใช้ในระบบ — ข้อมูลใหม่ถูกบังคับแล้ว';
  END;
  IF NOT EXISTS (SELECT 1 FROM public.members WHERE village_id IS NULL) THEN
    ALTER TABLE public.members ALTER COLUMN village_id SET NOT NULL;
  ELSE
    RAISE NOTICE 'มีสมาชิกที่ไม่มีหมู่บ้าน — ยังไม่บังคับ NOT NULL (ตรวจ: SELECT id FROM members WHERE village_id IS NULL)';
  END IF;
END $$;

-- กันซ้ำ: จดมิเตอร์ได้ครั้งเดียวต่องวด, บิลหนึ่งใบมีใบเสร็จที่อนุมัติได้ใบเดียว, เลขมิเตอร์ซ้ำได้เฉพาะสมาชิกที่ลบแล้ว
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.meter_readings GROUP BY member_id, period_year, period_month HAVING count(*) > 1) THEN
    RAISE NOTICE 'พบการจดมิเตอร์ซ้ำในงวดเดียวกัน — ยังไม่สร้าง unique index (ตรวจ: SELECT member_id, period_year, period_month, count(*) FROM meter_readings GROUP BY 1,2,3 HAVING count(*) > 1)';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_reading_member_period ON public.meter_readings(member_id, period_year, period_month);
  END IF;
  IF EXISTS (SELECT 1 FROM public.payments WHERE status::TEXT = 'approved' GROUP BY bill_id HAVING count(*) > 1) THEN
    RAISE NOTICE 'พบบิลที่มีใบเสร็จอนุมัติมากกว่า 1 ใบ — ยังไม่สร้าง unique index (ตรวจ: SELECT bill_id FROM payments WHERE status = ''approved'' GROUP BY 1 HAVING count(*) > 1)';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_bill_approved ON public.payments(bill_id) WHERE status = 'approved';
  END IF;
  IF EXISTS (SELECT 1 FROM public.members WHERE NOT COALESCE(is_deleted, false) GROUP BY upper(meter_no) HAVING count(*) > 1) THEN
    RAISE NOTICE 'พบเลขมิเตอร์ซ้ำ — คง unique เดิมไว้';
  ELSE
    ALTER TABLE public.members DROP CONSTRAINT IF EXISTS members_meter_no_key;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_members_meter_no ON public.members(upper(meter_no)) WHERE NOT COALESCE(is_deleted, false);
  END IF;
END $$;
ALTER TABLE public.meter_readings ALTER COLUMN period_year SET NOT NULL;
ALTER TABLE public.meter_readings ALTER COLUMN period_month SET NOT NULL;

-- index ของ FK ที่ยังไม่มี
CREATE INDEX IF NOT EXISTS idx_profiles_village        ON public.profiles(village_id);
CREATE INDEX IF NOT EXISTS idx_water_quality_village   ON public.water_quality(village_id);
CREATE INDEX IF NOT EXISTS idx_outbox_member           ON public.notification_outbox(member_id);
CREATE INDEX IF NOT EXISTS idx_announcements_village   ON public.announcements(village_id);
CREATE INDEX IF NOT EXISTS idx_cash_closings_cashier   ON public.cash_closings(cashier_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_village     ON public.maintenance_jobs(village_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_member      ON public.maintenance_jobs(member_id);
CREATE INDEX IF NOT EXISTS idx_readings_bill           ON public.meter_readings(bill_id);
CREATE INDEX IF NOT EXISTS idx_payments_bill           ON public.payments(bill_id);
CREATE INDEX IF NOT EXISTS idx_payments_member         ON public.payments(member_id);

-- ── ผู้ทำรายการ = uuid จาก JWT ───────────────────────────────
CREATE OR REPLACE FUNCTION app_private.tg_actor_ids()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid  UUID := app_private.jwt_profile_id();
  v_name TEXT := app_private.actor_name();
BEGIN
  CASE TG_TABLE_NAME
  WHEN 'meter_replacements' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.replaced_by_id := COALESCE(v_uid, NEW.replaced_by_id);
      NEW.replaced_by    := COALESCE(v_name, NEW.replaced_by);
    END IF;
  WHEN 'master_data' THEN
    IF TG_OP = 'INSERT' THEN NEW.created_by_id := v_uid; END IF;
    NEW.updated_by_id := v_uid;
  WHEN 'cashbook_entries' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.category_id := (SELECT id FROM public.master_data WHERE category = NEW.kind || '_category' AND code = NEW.category);
    ELSIF NEW.voided_at IS NOT NULL AND OLD.voided_at IS NULL THEN
      NEW.voided_by_id := v_uid;
    END IF;
  WHEN 'maintenance_jobs' THEN
    IF TG_OP = 'INSERT' THEN
      IF COALESCE(NEW.id, '') = '' THEN NEW.id := app_private.new_id('MNT'); END IF;
      IF NEW.reported_by_type::TEXT = 'staff' THEN NEW.reported_by := COALESCE(v_uid, NEW.reported_by); END IF;
      -- หมู่บ้านตามสมาชิกที่แจ้ง (ถ้าไม่ได้ระบุ)
      IF NEW.village_id IS NULL AND NEW.member_id IS NOT NULL THEN
        NEW.village_id := (SELECT village_id FROM public.members WHERE id = NEW.member_id);
      END IF;
    END IF;
    IF NEW.assigned_to IS NOT NULL THEN
      NEW.assigned_name := COALESCE((SELECT full_name FROM public.profiles WHERE id = NEW.assigned_to), NEW.assigned_name);
    END IF;
    IF NEW.status::TEXT = 'completed' AND (TG_OP = 'INSERT' OR OLD.status::TEXT <> 'completed') THEN
      NEW.approved_by := COALESCE(v_uid, NEW.approved_by);
    END IF;
  ELSE
    NULL;
  END CASE;
  RETURN NEW;
END;
$$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['meter_replacements', 'master_data', 'cashbook_entries', 'maintenance_jobs'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_actor_ids ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_actor_ids BEFORE INSERT OR UPDATE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION app_private.tg_actor_ids()', t);
  END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════
-- 4. สิทธิ์ตามหน้าที่ — สมาชิก
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION app_private.tg_members_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_role TEXT;
  -- คอลัมน์ที่พนักงานจดมิเตอร์แก้ได้ (พิกัดบ้าน / เปลี่ยนมิเตอร์ / ลำดับเส้นทาง)
  c_reader_cols CONSTANT TEXT[] := ARRAY['gps_lat', 'gps_lng', 'route_order', 'last_read', 'last_read_date',
    'meter_no', 'meter_brand', 'meter_size', 'meter_install_date', 'meter_expire_date', 'updated_at'];
BEGIN
  IF NOT app_private.client_write() THEN RETURN NEW; END IF;
  v_role := app_private.staff_role();

  IF TG_OP = 'INSERT' THEN
    IF NOT app_private.is_finance() THEN
      RAISE EXCEPTION 'ไม่มีสิทธิ์เพิ่มสมาชิก' USING ERRCODE = '42501';
    END IF;
    NEW.created_by := app_private.jwt_profile_id();
    RETURN NEW;
  END IF;

  IF NEW.is_deleted IS DISTINCT FROM OLD.is_deleted THEN
    IF NOT app_private.is_admin() THEN
      RAISE EXCEPTION 'ลบสมาชิกได้เฉพาะผู้ดูแลระบบ' USING ERRCODE = '42501';
    END IF;
    IF NEW.is_deleted THEN
      NEW.deleted_by := app_private.jwt_profile_id();
      NEW.deleted_at := now();
    END IF;
  END IF;

  IF v_role = 'meter_reader' THEN
    -- national_id ที่ส่งมา (ถูกเข้ารหัสแล้วใน trg_members_pii) ถือเป็นการแก้ไข
    IF (to_jsonb(NEW) - c_reader_cols) IS DISTINCT FROM (to_jsonb(OLD) - c_reader_cols) THEN
      RAISE EXCEPTION 'พนักงานจดมิเตอร์แก้ได้เฉพาะพิกัดบ้านและข้อมูลมิเตอร์' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ชื่อ trg_members_r… ให้ทำงานหลัง trg_members_pii (เข้ารหัสก่อนแล้วจึงเทียบ)
DROP TRIGGER IF EXISTS trg_members_role_guard ON public.members;
CREATE TRIGGER trg_members_role_guard BEFORE INSERT OR UPDATE ON public.members
  FOR EACH ROW EXECUTE FUNCTION app_private.tg_members_guard();

-- ══════════════════════════════════════════════════════════════
-- 5. สิทธิ์ตามหน้าที่ — บิล
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION app_private.tg_bills_role_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    NEW.period_label := app_private.period_label(NEW.period_year, NEW.period_month);
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.issued_by := COALESCE(app_private.jwt_profile_id(), NEW.issued_by);
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status::TEXT = 'cancelled' AND OLD.status::TEXT <> 'cancelled' THEN
    NEW.cancelled_by_id := COALESCE(app_private.jwt_profile_id(), NEW.cancelled_by_id);
    NEW.cancelled_by    := COALESCE(app_private.actor_name(), NEW.cancelled_by);
    NEW.cancelled_at    := COALESCE(NEW.cancelled_at, now());
  END IF;

  IF NOT app_private.client_write() THEN RETURN COALESCE(NEW, OLD); END IF;

  -- ไม่มีอะไรเปลี่ยน (เช่น แอปรุ่นเก่าตั้งสถานะซ้ำกับที่ server ตั้งให้แล้ว)
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'updated_at') = (to_jsonb(OLD) - 'updated_at') THEN
    RETURN NEW;
  END IF;

  IF NOT app_private.is_finance() THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์แก้ไขบิล — บันทึกมิเตอร์ผ่านหน้าจดมิเตอร์' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ลบบิลไม่ได้ — ใช้การยกเลิกบิล' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status::TEXT NOT IN ('pending') THEN
      RAISE EXCEPTION 'บิลใหม่ต้องมีสถานะรอชำระ' USING ERRCODE = '42501';
    END IF;
    IF COALESCE(NEW.late_fee, 0) <> 0 OR COALESCE(NEW.discount, 0) <> 0 THEN
      RAISE EXCEPTION 'ส่วนลด/ค่าปรับ ให้ใช้ "ปรับปรุงยอด" (ใบลดหนี้/เพิ่มหนี้)' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.discount IS DISTINCT FROM OLD.discount OR NEW.late_fee IS DISTINCT FROM OLD.late_fee THEN
    RAISE EXCEPTION 'ส่วนลด/ค่าปรับ ให้ใช้ "ปรับปรุงยอด" (ใบลดหนี้/เพิ่มหนี้)' USING ERRCODE = '42501';
  END IF;
  IF NEW.member_id IS DISTINCT FROM OLD.member_id THEN
    RAISE EXCEPTION 'เปลี่ยนเจ้าของบิลไม่ได้' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT ((OLD.status::TEXT IN ('pending', 'overdue') AND NEW.status::TEXT = 'cancelled')
              OR (OLD.status::TEXT = 'cancelled' AND NEW.status::TEXT = 'pending')) THEN
    RAISE EXCEPTION 'เปลี่ยนสถานะบิลเป็น "%" โดยตรงไม่ได้ — สถานะชำระแล้วมาจากใบเสร็จเท่านั้น', NEW.status
      USING ERRCODE = '42501';
  END IF;
  IF OLD.status::TEXT = 'paid'
     AND (NEW.usage, NEW.water_charge, NEW.service_charge, NEW.period_year, NEW.period_month)
         IS DISTINCT FROM (OLD.usage, OLD.water_charge, OLD.service_charge, OLD.period_year, OLD.period_month) THEN
    RAISE EXCEPTION 'บิลที่ชำระแล้วแก้ไขไม่ได้' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bills_role_guard ON public.bills;
CREATE TRIGGER trg_bills_role_guard BEFORE INSERT OR UPDATE OR DELETE ON public.bills
  FOR EACH ROW EXECUTE FUNCTION app_private.tg_bills_role_guard();

-- งวดที่ปิดแล้ว: ค่าปรับ/สถานะ เปลี่ยนได้เฉพาะจากระบบ (ค่าปรับรายวัน, ใบเสร็จ) — client ยิงตรงไม่ได้
CREATE OR REPLACE FUNCTION app_private.tg_bills_closed_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF app_private.client_write() AND app_private.period_closed(OLD.period_year, OLD.period_month)
     AND (NEW.late_fee IS DISTINCT FROM OLD.late_fee OR NEW.status IS DISTINCT FROM OLD.status) THEN
    RAISE EXCEPTION 'งวด % ปิดแล้ว — แก้ไขบิลไม่ได้ ให้ใช้ "ปรับปรุงยอด" (ใบลดหนี้/เพิ่มหนี้) แทน', OLD.period_label
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_bills_closed_guard ON public.bills;
CREATE TRIGGER trg_bills_closed_guard BEFORE UPDATE ON public.bills
  FOR EACH ROW EXECUTE FUNCTION app_private.tg_bills_closed_guard();

-- งานรายวัน (เรียกจากแอปด้วย) แก้สถานะค้างชำระ/ค่าปรับในนามระบบ
DROP FUNCTION IF EXISTS public.refresh_billing_status();
CREATE FUNCTION public.refresh_billing_status()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_prev TEXT := COALESCE(current_setting('app.trusted', true), '');
  v_out  JSONB;
BEGIN
  IF app_private.staff_role() IS NULL THEN
    RAISE EXCEPTION 'SESSION_REVOKED' USING ERRCODE = '28000';
  END IF;
  PERFORM set_config('app.trusted', 'on', true);
  v_out := app_private.run_daily_billing();
  PERFORM set_config('app.trusted', v_prev, true);
  RETURN v_out;
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 6. สิทธิ์ตามหน้าที่ — การชำระเงิน / ใบเสร็จ
-- ══════════════════════════════════════════════════════════════
-- (ชื่อ trg_payment_g… ทำงานหลัง trg_cash_auto_approve, trg_payment_actor และก่อน trg_payment_receipt_no)
CREATE OR REPLACE FUNCTION app_private.tg_payment_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_bill public.bills%ROWTYPE;
  c_frozen CONSTANT TEXT[] := ARRAY['bill_id', 'member_id', 'amount', 'channel', 'paid_at', 'receipt_no', 'slip_url'];
BEGIN
  IF TG_OP = 'INSERT' AND COALESCE(NEW.id, '') = '' THEN
    NEW.id := app_private.new_id('PAY');
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status::TEXT = 'cancelled' AND OLD.status::TEXT <> 'cancelled' THEN
    NEW.cancelled_by_id := COALESCE(app_private.jwt_profile_id(), NEW.cancelled_by_id);
  END IF;

  IF NOT app_private.client_write() THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_bill FROM public.bills WHERE id = NEW.bill_id;
    IF v_bill.id IS NULL THEN RAISE EXCEPTION 'ไม่พบบิล'; END IF;
    NEW.member_id := v_bill.member_id;
    IF v_bill.status::TEXT NOT IN ('pending', 'overdue') THEN
      RAISE EXCEPTION 'บิลนี้ไม่อยู่ในสถานะรอชำระ';
    END IF;
    IF abs(COALESCE(NEW.amount, 0) - v_bill.total) > 0.009 THEN
      RAISE EXCEPTION 'ยอดชำระต้องเท่ากับยอดบิล (฿%)', v_bill.total;
    END IF;
    -- เงินโอน/พร้อมเพย์: พนักงานจดมิเตอร์บันทึกได้ แต่ต้องให้การเงินตรวจสลิปก่อน
    IF NEW.status::TEXT = 'approved' AND NEW.channel::TEXT <> 'cash' AND NOT app_private.is_finance() THEN
      NEW.status := 'pending'; NEW.approved_by := NULL; NEW.approved_at := NULL;
    END IF;
    IF NEW.status::TEXT NOT IN ('pending', 'approved') THEN
      RAISE EXCEPTION 'สถานะเริ่มต้นไม่ถูกต้อง';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF OLD.status::TEXT IN ('approved', 'cancelled', 'rejected')
     AND (SELECT jsonb_object_agg(k, to_jsonb(NEW) -> k) FROM unnest(c_frozen) k)
         IS DISTINCT FROM (SELECT jsonb_object_agg(k, to_jsonb(OLD) -> k) FROM unnest(c_frozen) k) THEN
    RAISE EXCEPTION 'ใบเสร็จที่ออกแล้วแก้ยอด/ช่องทาง/วันที่ไม่ได้ — ยกเลิกแล้วออกใหม่' USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT app_private.is_finance() THEN
      RAISE EXCEPTION 'อนุมัติ/ปฏิเสธ/ยกเลิกใบเสร็จได้เฉพาะเจ้าหน้าที่การเงิน' USING ERRCODE = '42501';
    END IF;
    IF NOT ((OLD.status::TEXT = 'pending' AND NEW.status::TEXT IN ('approved', 'rejected', 'cancelled'))
            OR (OLD.status::TEXT = 'approved' AND NEW.status::TEXT = 'cancelled')) THEN
      RAISE EXCEPTION 'เปลี่ยนสถานะใบเสร็จจาก % เป็น % ไม่ได้', OLD.status, NEW.status USING ERRCODE = '42501';
    END IF;
    IF NEW.status::TEXT = 'approved' THEN
      SELECT * INTO v_bill FROM public.bills WHERE id = NEW.bill_id;
      IF v_bill.status::TEXT NOT IN ('pending', 'overdue') THEN
        RAISE EXCEPTION 'บิลนี้ไม่อยู่ในสถานะรอชำระ (อาจชำระแล้ว)';
      END IF;
    END IF;
  END IF;

  IF OLD.status::TEXT = 'pending' AND (NEW.bill_id, NEW.amount) IS DISTINCT FROM (OLD.bill_id, OLD.amount) THEN
    SELECT * INTO v_bill FROM public.bills WHERE id = NEW.bill_id;
    NEW.member_id := v_bill.member_id;
    IF v_bill.id IS NULL OR abs(COALESCE(NEW.amount, 0) - v_bill.total) > 0.009 THEN
      RAISE EXCEPTION 'ยอดชำระต้องเท่ากับยอดบิล';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_guard ON public.payments;
CREATE TRIGGER trg_payment_guard BEFORE INSERT OR UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION app_private.tg_payment_guard();

-- ล็อกปิดยอดประจำวัน: ตรวจทุกครั้งที่ใบเสร็จเงินสดที่อนุมัติแล้วถูกยกเลิก (ไม่ว่าจะผ่านสถานะใด)
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
    NEW.paid_at          := CASE WHEN v_uid IS NOT NULL THEN now() ELSE COALESCE(NEW.paid_at, now()) END;
    IF NEW.channel::TEXT = 'cash' AND NEW.created_by IS NOT NULL
       AND app_private.cash_day_closed(NEW.created_by, app_private.paid_date_th(NEW.paid_at)) THEN
      RAISE EXCEPTION 'ปิดยอดประจำวันของคุณแล้ว — รับเงินสดเพิ่มไม่ได้ ติดต่อผู้ดูแลเพื่อเปิดยอดใหม่'
        USING ERRCODE = '55000';
    END IF;
  ELSE
    NEW.created_by       := OLD.created_by;
    NEW.received_by_name := OLD.received_by_name;
    IF current_setting('app.allow_print_count', true) IS DISTINCT FROM 'on' THEN
      NEW.print_count := OLD.print_count;
    END IF;
  END IF;

  IF NEW.status::TEXT = 'approved' AND (TG_OP = 'INSERT' OR OLD.status::TEXT <> 'approved') THEN
    NEW.approved_by := COALESCE(v_uid, NEW.approved_by);
    NEW.approved_at := now();
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status::TEXT <> 'approved' AND OLD.status::TEXT = 'approved' THEN
    IF OLD.channel::TEXT = 'cash' AND OLD.created_by IS NOT NULL
       AND app_private.cash_day_closed(OLD.created_by, app_private.paid_date_th(OLD.paid_at)) THEN
      RAISE EXCEPTION 'ใบเสร็จนี้อยู่ในยอดที่ปิดประจำวันแล้ว — ยกเลิกไม่ได้ ติดต่อผู้ดูแลเพื่อเปิดยอดใหม่'
        USING ERRCODE = '55000';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status::TEXT IN ('cancelled', 'rejected') AND OLD.status::TEXT <> NEW.status::TEXT THEN
    NEW.cancelled_by := COALESCE(v_name, NEW.cancelled_by);
    NEW.cancelled_at := CASE WHEN v_uid IS NOT NULL THEN now() ELSE COALESCE(NEW.cancelled_at, now()) END;
  END IF;
  RETURN NEW;
END;
$$;

-- ใบเสร็จอนุมัติ → บิลชำระแล้ว / ยกเลิกใบเสร็จ → บิลกลับเป็นค้าง (server ทำเอง ไม่ต้องให้แอปแก้สถานะบิล)
CREATE OR REPLACE FUNCTION public.fn_payment_approved()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, extensions AS $$
DECLARE
  v_prev TEXT := COALESCE(current_setting('app.trusted', true), '');
BEGIN
  PERFORM set_config('app.trusted', 'on', true);
  IF NEW.status::TEXT = 'approved' AND (TG_OP = 'INSERT' OR OLD.status::TEXT <> 'approved') THEN
    UPDATE public.bills SET status = 'paid'
    WHERE id = NEW.bill_id AND status::TEXT <> 'cancelled';
  ELSIF TG_OP = 'UPDATE' AND OLD.status::TEXT = 'approved' AND NEW.status::TEXT <> 'approved'
        AND NOT EXISTS (SELECT 1 FROM public.payments p
                        WHERE p.bill_id = NEW.bill_id AND p.id <> NEW.id AND p.status::TEXT = 'approved') THEN
    UPDATE public.bills
    SET status = CASE WHEN due_date < (now() AT TIME ZONE 'Asia/Bangkok')::DATE THEN 'overdue' ELSE 'pending' END::public.bill_status
    WHERE id = NEW.bill_id AND status::TEXT = 'paid';
  END IF;
  PERFORM set_config('app.trusted', v_prev, true);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_approved ON public.payments;
CREATE TRIGGER trg_payment_approved
  AFTER INSERT OR UPDATE OF status ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_payment_approved();

-- ══════════════════════════════════════════════════════════════
-- 7. จดมิเตอร์ — RPC เดียว คิดค่าน้ำที่ server
-- ══════════════════════════════════════════════════════════════
-- สูตรเดียวกับ calcWaterCharge ในแอป (ค่าน้ำปัดเป็นบาท)
CREATE OR REPLACE FUNCTION app_private.calc_charges(p_usage NUMERIC, p_meter_size TEXT,
                                                    OUT water_charge NUMERIC, OUT service_charge NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t     RECORD;
  v_rem NUMERIC := greatest(COALESCE(p_usage, 0), 0);
  v_cap NUMERIC;
  v_wc  NUMERIC := 0;
  v_last NUMERIC;
  v_large BOOLEAN := COALESCE(NULLIF(regexp_replace(COALESCE(p_meter_size, ''), '[^0-9.]', '', 'g'), '')::NUMERIC, 0.5) >= 1;
BEGIN
  FOR t IN SELECT from_unit, to_unit, rate_per_unit FROM public.rate_tiers ORDER BY from_unit LOOP
    v_last := t.rate_per_unit;
    EXIT WHEN v_rem <= 0;
    v_cap := CASE WHEN t.to_unit IS NULL THEN v_rem
                  ELSE least(v_rem, t.to_unit - greatest(t.from_unit - 1, 0)) END;
    CONTINUE WHEN v_cap <= 0;
    v_wc  := v_wc + v_cap * t.rate_per_unit;
    v_rem := v_rem - v_cap;
  END LOOP;
  IF v_rem > 0 AND v_last IS NOT NULL THEN v_wc := v_wc + v_rem * v_last; END IF;
  water_charge := round(v_wc);

  SELECT NULLIF(value, '')::NUMERIC INTO service_charge FROM public.system_config
  WHERE key = CASE WHEN v_large THEN 'svc_charge_large' ELSE 'svc_charge_small' END
    AND value ~ '^[0-9]+(\.[0-9]+)?$';
  IF service_charge IS NULL OR service_charge <= 0 THEN
    SELECT CASE WHEN v_large THEN svc_charge_large ELSE svc_charge_small END INTO service_charge
    FROM public.rate_tiers ORDER BY from_unit LIMIT 1;
  END IF;
  service_charge := COALESCE(NULLIF(service_charge, 0), CASE WHEN v_large THEN 30 ELSE 20 END);
END;
$$;

DROP FUNCTION IF EXISTS public.save_meter_reading(BIGINT, INT, INT, DATE, NUMERIC, NUMERIC, BOOLEAN, TEXT, TEXT, TEXT, TEXT);
CREATE FUNCTION public.save_meter_reading(
  p_member_id    BIGINT,
  p_period_year  INT,
  p_period_month INT,
  p_reading_date DATE,
  p_prev         NUMERIC,
  p_curr         NUMERIC,
  p_rollover     BOOLEAN DEFAULT false,
  p_client_ref   TEXT    DEFAULT NULL,
  p_method       TEXT    DEFAULT 'manual',
  p_anomaly      TEXT    DEFAULT NULL,
  p_photo_path   TEXT    DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c_max_roll CONSTANT INT := 1000;
  v_prev_t  TEXT := COALESCE(current_setting('app.trusted', true), '');
  v_today   DATE := app_private.today_th();
  v_member  public.members%ROWTYPE;
  v_bill    public.bills%ROWTYPE;
  v_read    public.meter_readings%ROWTYPE;
  v_max     INT;
  v_usage   NUMERIC;
  v_wc      NUMERIC;
  v_svc     NUMERIC;
  v_due     INT;
  v_id      TEXT;
  v_date    DATE := COALESCE(p_reading_date, app_private.today_th());
BEGIN
  IF app_private.staff_role() IS NULL THEN RAISE EXCEPTION 'SESSION_REVOKED' USING ERRCODE = '28000'; END IF;
  IF p_period_month NOT BETWEEN 1 AND 12 OR p_period_year NOT BETWEEN 2500 AND 2700 THEN
    RAISE EXCEPTION 'งวดไม่ถูกต้อง';
  END IF;
  IF v_date > v_today OR v_date < v_today - 62 THEN RAISE EXCEPTION 'วันที่จดไม่ถูกต้อง'; END IF;
  IF app_private.period_closed(p_period_year, p_period_month) THEN
    RAISE EXCEPTION 'งวด % ปิดแล้ว — บันทึกมิเตอร์/ออกบิลในงวดนี้ไม่ได้', app_private.period_label(p_period_year, p_period_month)
      USING ERRCODE = '55000';
  END IF;
  IF p_client_ref IS NOT NULL AND p_client_ref !~ '^MR-[0-9]{12,16}(-[0-9a-f]{1,8})?$' THEN
    RAISE EXCEPTION 'รหัสอ้างอิงไม่ถูกต้อง';
  END IF;
  IF COALESCE(p_photo_path, '') <> '' AND p_photo_path !~ '^[0-9]{4}-[0-9]{2}/[A-Za-z0-9._-]+$' THEN
    RAISE EXCEPTION 'path รูปไม่ถูกต้อง';
  END IF;

  SELECT * INTO v_member FROM public.members WHERE id = p_member_id FOR UPDATE;
  IF v_member.id IS NULL OR COALESCE(v_member.is_deleted, false) THEN RAISE EXCEPTION 'ไม่พบสมาชิก'; END IF;

  -- ส่งซ้ำ (เช่น ซิงก์ออฟไลน์แล้วไม่ได้รับคำตอบ) → คืนผลเดิม
  IF p_client_ref IS NOT NULL THEN
    SELECT * INTO v_read FROM public.meter_readings WHERE id = p_client_ref;
    IF v_read.id IS NOT NULL THEN
      IF v_read.member_id <> p_member_id THEN RAISE EXCEPTION 'รหัสอ้างอิงซ้ำ'; END IF;
      SELECT * INTO v_bill FROM public.bills WHERE id = v_read.bill_id;
      RETURN jsonb_build_object('bill', to_jsonb(v_bill), 'reading', to_jsonb(v_read), 'duplicate', true);
    END IF;
  END IF;

  PERFORM set_config('app.trusted', 'on', true);

  -- การอ่านเดิมในงวดนี้: ถ้าบิลถูกยกเลิก ลบทิ้งแล้วจดใหม่ (trigger คืน last_read ให้) — ไม่งั้นห้ามจดซ้ำ
  SELECT * INTO v_read FROM public.meter_readings
  WHERE member_id = p_member_id AND period_year = p_period_year AND period_month = p_period_month;
  IF v_read.id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.bills WHERE id = v_read.bill_id AND status::TEXT <> 'cancelled') THEN
      RAISE EXCEPTION 'DUPLICATE_READING: จดมิเตอร์รอบ % ไปแล้ว (% หน่วย)',
        app_private.period_label(p_period_year, p_period_month), v_read.curr_reading USING ERRCODE = '23505';
    END IF;
    DELETE FROM public.meter_readings WHERE id = v_read.id;
    SELECT * INTO v_member FROM public.members WHERE id = p_member_id;
  END IF;

  -- เลขครั้งก่อนต้องตรงกับที่ server รู้ (กันคนอื่นจดไปก่อน / แก้เลขเดิมเพื่อลดหน่วย)
  IF abs(COALESCE(p_prev, -1) - v_member.last_read) > 0.009 THEN
    RAISE EXCEPTION 'PREV_MISMATCH: เลขครั้งก่อนในระบบคือ % (ในเครื่อง %) — รีเฟรชแล้วจดใหม่', v_member.last_read, p_prev
      USING ERRCODE = '40001';
  END IF;

  IF COALESCE(p_rollover, false) THEN
    SELECT NULLIF(value, '')::INT INTO v_max FROM public.system_config WHERE key = 'meter_max_reading' AND value ~ '^[0-9]+$';
    v_max := COALESCE(NULLIF(v_max, 0), 9999);
    IF NOT (p_curr < p_prev AND p_prev <= v_max AND p_curr >= 0) THEN RAISE EXCEPTION 'ข้อมูลมิเตอร์วนรอบไม่ถูกต้อง'; END IF;
    v_usage := (v_max + 1 - p_prev) + p_curr;
    IF v_usage > c_max_roll THEN RAISE EXCEPTION 'หน่วยหลังวนรอบมากผิดปกติ — ตรวจเลขมิเตอร์อีกครั้ง'; END IF;
  ELSE
    IF p_curr IS NULL OR p_curr < p_prev THEN RAISE EXCEPTION 'เลขมิเตอร์ต้องมากกว่าค่าเดิม'; END IF;
    v_usage := p_curr - p_prev;
  END IF;
  v_usage := round(v_usage);

  SELECT c.water_charge, c.service_charge INTO v_wc, v_svc
  FROM app_private.calc_charges(v_usage, v_member.meter_size::TEXT) c;

  -- บิล: ใช้ใบเดิมของงวดนี้ (ถ้ายกเลิกไว้ให้เปิดใหม่) หรือออกใหม่
  SELECT * INTO v_bill FROM public.bills
  WHERE member_id = p_member_id AND period_year = p_period_year AND period_month = p_period_month FOR UPDATE;
  IF v_bill.id IS NOT NULL THEN
    IF v_bill.status::TEXT NOT IN ('pending', 'overdue', 'cancelled') THEN
      RAISE EXCEPTION 'บิลงวดนี้ชำระแล้ว — แก้เลขมิเตอร์ไม่ได้';
    END IF;
    UPDATE public.bills
    SET status = 'pending', usage = v_usage, water_charge = v_wc, service_charge = v_svc,
        issue_date = v_date, cancel_reason = NULL, cancelled_by = NULL, cancelled_by_id = NULL, cancelled_at = NULL
    WHERE id = v_bill.id
    RETURNING * INTO v_bill;
  ELSE
    SELECT NULLIF(value, '')::INT INTO v_due FROM public.system_config WHERE key = 'billing_due_days' AND value ~ '^[0-9]+$';
    INSERT INTO public.bills (id, member_id, period_year, period_month, period_label, issue_date, due_date,
                              usage, water_charge, service_charge, status)
    VALUES ('', p_member_id, p_period_year, p_period_month, app_private.period_label(p_period_year, p_period_month),
            v_date, v_date + COALESCE(NULLIF(v_due, 0), 15), v_usage, v_wc, v_svc, 'pending')
    RETURNING * INTO v_bill;
  END IF;

  v_id := COALESCE(p_client_ref, 'MR-' || (extract(epoch FROM clock_timestamp()) * 1000)::BIGINT);
  INSERT INTO public.meter_readings (id, member_id, meter_no, reading_date, prev_reading, curr_reading,
                                     rollover, meter_max, water_charge, service_charge, read_by, method, anomaly,
                                     bill_id, photo_url, period_year, period_month)
  VALUES (v_id, p_member_id, v_member.meter_no, v_date,
          CASE WHEN COALESCE(p_rollover, false) THEN p_prev - (v_max + 1) ELSE p_prev END,
          p_curr, COALESCE(p_rollover, false), CASE WHEN COALESCE(p_rollover, false) THEN v_max END,
          v_wc, v_svc, app_private.jwt_profile_id(),
          CASE WHEN p_method IN ('manual', 'ai_scan', 'estimated', 'remote') THEN p_method ELSE 'manual' END::public.reading_method,
          CASE WHEN p_anomaly IN ('high_usage', 'suspected_leak', 'meter_fault') THEN p_anomaly END::public.anomaly_type,
          v_bill.id, NULLIF(p_photo_path, ''), p_period_year, p_period_month)
  RETURNING * INTO v_read;

  PERFORM set_config('app.trusted', v_prev_t, true);
  RETURN jsonb_build_object('bill', to_jsonb(v_bill), 'reading', to_jsonb(v_read));
END;
$$;

-- การอ่านมิเตอร์: ผู้จด = ผู้ login, งวด = ตามบิล, client ยิงตรงได้เฉพาะการเงิน/admin
CREATE OR REPLACE FUNCTION app_private.tg_readings_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.read_by := COALESCE(app_private.jwt_profile_id(), NEW.read_by);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    IF NEW.bill_id IS NOT NULL THEN
      SELECT period_year, period_month INTO NEW.period_year, NEW.period_month FROM public.bills WHERE id = NEW.bill_id;
    END IF;
    IF NEW.period_year IS NULL THEN
      NEW.period_year  := extract(year FROM NEW.reading_date)::INT + 543;
      NEW.period_month := extract(month FROM NEW.reading_date)::INT;
    END IF;
  END IF;
  IF app_private.client_write() AND NOT app_private.is_finance() THEN
    RAISE EXCEPTION 'บันทึกมิเตอร์ผ่านหน้าจดมิเตอร์เท่านั้น' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_readings_guard ON public.meter_readings;
CREATE TRIGGER trg_readings_guard BEFORE INSERT OR UPDATE OR DELETE ON public.meter_readings
  FOR EACH ROW EXECUTE FUNCTION app_private.tg_readings_guard();

-- ══════════════════════════════════════════════════════════════
-- 8. Audit — บันทึกที่ server ทุกตารางหลัก, ตัดข้อมูลลับ, hash chain
-- ══════════════════════════════════════════════════════════════
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS actor_id  UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS source    TEXT NOT NULL DEFAULT 'server',
  ADD COLUMN IF NOT EXISTS seq       BIGINT,
  ADD COLUMN IF NOT EXISTS prev_hash TEXT,
  ADD COLUMN IF NOT EXISTS row_hash  TEXT;
CREATE SEQUENCE IF NOT EXISTS app_private.audit_seq;
DROP TRIGGER IF EXISTS trg_audit_immutable ON public.audit_logs;   -- สร้างใหม่ท้ายหัวข้อนี้
CREATE INDEX IF NOT EXISTS idx_audit_logs_seq ON public.audit_logs(seq);

-- ล้างข้อมูลลับที่เคยหลุดลง audit (API key จากหน้าตั้งค่า, เลขบัตรประชาชน)
UPDATE public.audit_logs
SET new_data = CASE WHEN new_data ? 'value' THEN jsonb_set(new_data, '{value}', '"[REDACTED]"') ELSE new_data END,
    old_data = CASE WHEN old_data ? 'value' THEN jsonb_set(old_data, '{value}', '"[REDACTED]"') ELSE old_data END
WHERE table_name = 'system_config'
  AND (COALESCE(new_data ->> 'value', '[REDACTED]') <> '[REDACTED]' OR COALESCE(old_data ->> 'value', '[REDACTED]') <> '[REDACTED]')
  AND (record_id ~* '(token|secret|api_key|password|key$)' OR new_data ->> 'key' ~* '(token|secret|api_key|password)');
UPDATE public.audit_logs
SET new_data = new_data - 'national_id' - 'nationalId', old_data = old_data - 'national_id' - 'nationalId'
WHERE (new_data ?| ARRAY['national_id', 'nationalId']) OR (old_data ?| ARRAY['national_id', 'nationalId']);
DELETE FROM public.system_config WHERE key ~* '(api_key|secret|token|password)' AND key <> 'last_backup_at';

CREATE OR REPLACE FUNCTION app_private.redact(p_table TEXT, p_row JSONB)
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_row IS NULL THEN NULL
    WHEN p_table = 'system_config' AND p_row ->> 'key' ~* '(token|secret|api_key|password)'
      THEN p_row || '{"value": "[REDACTED]", "value_json": null}'::JSONB
    WHEN p_table = 'members' THEN p_row - 'national_id'
    WHEN p_table = 'member_access' THEN p_row - 'portal_code' - 'line_user_id'
    ELSE p_row
  END;
$$;

CREATE OR REPLACE FUNCTION app_private.tg_audit_row()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_old JSONB := CASE WHEN TG_OP <> 'INSERT' THEN app_private.redact(TG_TABLE_NAME, to_jsonb(OLD) - 'updated_at') END;
  v_new JSONB := CASE WHEN TG_OP <> 'DELETE' THEN app_private.redact(TG_TABLE_NAME, to_jsonb(NEW) - 'updated_at') END;
  v_action TEXT := lower(TG_OP);
BEGIN
  IF TG_OP = 'UPDATE' AND v_old = v_new THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND (v_new ->> 'status') = 'cancelled'
     AND (v_old ->> 'status') IS DISTINCT FROM 'cancelled' THEN
    v_action := 'cancel';
  END IF;
  -- UPDATE เก็บเฉพาะคอลัมน์ที่เปลี่ยน (อ่านง่าย + ไม่ทำสำเนาข้อมูลส่วนบุคคลทั้งแถวซ้ำๆ)
  IF TG_OP = 'UPDATE' THEN
    SELECT jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k) INTO v_old, v_new
    FROM jsonb_object_keys(v_new) k WHERE (v_new -> k) IS DISTINCT FROM (v_old -> k);
  END IF;
  INSERT INTO public.audit_logs (table_name, record_id, action, old_data, new_data, performed_by)
  VALUES (TG_TABLE_NAME,
          COALESCE(to_jsonb(COALESCE(NEW, OLD)) ->> 'id', to_jsonb(COALESCE(NEW, OLD)) ->> 'key',
                   to_jsonb(COALESCE(NEW, OLD)) ->> 'member_id',
                   (to_jsonb(COALESCE(NEW, OLD)) ->> 'period_year') || '-' || (to_jsonb(COALESCE(NEW, OLD)) ->> 'period_month')),
          v_action, v_old, v_new, 'system');
  RETURN NULL;
END;
$$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['bills', 'payments', 'bill_adjustments', 'billing_periods', 'members', 'meter_readings',
                           'system_config', 'villages', 'rate_tiers', 'master_data', 'maintenance_jobs',
                           'meter_replacements', 'member_access', 'water_quality'] LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_row ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_audit_row AFTER INSERT OR UPDATE OR DELETE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION app_private.tg_audit_row()', t);
  END LOOP;
END $$;

-- ผู้ทำรายการ/เวลา จาก server + hash ต่อกันเป็นสาย (แก้/ลบแถวใดแถวหนึ่ง จะตรวจเจอ)
CREATE OR REPLACE FUNCTION app_private.audit_hash(r public.audit_logs)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT encode(extensions.digest(concat_ws('|', COALESCE(r.prev_hash, ''), r.seq, r.table_name, COALESCE(r.record_id, ''),
           r.action, COALESCE(r.old_data::TEXT, ''), COALESCE(r.new_data::TEXT, ''), COALESCE(r.performed_by, ''),
           COALESCE(r.actor_id::TEXT, ''), r.source, (extract(epoch FROM r.created_at) * 1000000)::BIGINT), 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION app_private.tg_audit_stamp()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid   UUID := app_private.jwt_profile_id();
  v_actor TEXT;
BEGIN
  SELECT COALESCE(p.username, p.email, p.full_name) INTO v_actor FROM public.profiles p WHERE p.id = v_uid;
  IF v_actor IS NULL AND auth.jwt() ->> 'app_role' = 'member' THEN
    v_actor := 'member:' || (auth.jwt() ->> 'member_id');
  END IF;
  NEW.performed_by := COALESCE(v_actor, NEW.performed_by, 'system');
  NEW.actor_id     := v_uid;
  NEW.source       := CASE WHEN current_setting('app.audit_source', true) = 'client' THEN 'client' ELSE 'server' END;
  NEW.created_at   := now();

  PERFORM pg_advisory_xact_lock(hashtext('aquaflow_audit_chain'));
  NEW.seq       := nextval('app_private.audit_seq');
  NEW.prev_hash := (SELECT row_hash FROM public.audit_logs WHERE seq IS NOT NULL ORDER BY seq DESC LIMIT 1);
  NEW.row_hash  := app_private.audit_hash(NEW);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_audit_stamp ON public.audit_logs;
CREATE TRIGGER trg_audit_stamp BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION app_private.tg_audit_stamp();

-- แถว audit แก้/ลบไม่ได้ แม้แต่ฟังก์ชันของระบบ
CREATE OR REPLACE FUNCTION app_private.tg_audit_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'audit log แก้ไขหรือลบไม่ได้' USING ERRCODE = '42501';
END;
$$;
DROP TRIGGER IF EXISTS trg_audit_immutable ON public.audit_logs;
CREATE TRIGGER trg_audit_immutable BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION app_private.tg_audit_immutable();

-- แอปบันทึกเหตุการณ์ (พิมพ์/ส่งออก/ระงับน้ำ) ผ่าน RPC นี้ — ถูกทำเครื่องหมาย source = client
DROP FUNCTION IF EXISTS public.log_event(TEXT, TEXT, TEXT, JSONB);
CREATE FUNCTION public.log_event(p_table TEXT, p_record TEXT, p_action TEXT, p_detail JSONB DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF app_private.staff_role() IS NULL THEN RAISE EXCEPTION 'SESSION_REVOKED' USING ERRCODE = '28000'; END IF;
  IF COALESCE(p_action, '') !~ '^[a-z0-9_]{2,40}$' OR COALESCE(p_table, '') !~ '^[a-z_]{2,40}$' THEN
    RAISE EXCEPTION 'ข้อมูลไม่ถูกต้อง';
  END IF;
  PERFORM set_config('app.audit_source', 'client', true);
  INSERT INTO public.audit_logs (table_name, record_id, action, new_data)
  VALUES (p_table, left(p_record, 100), p_action,
          app_private.redact(p_table, CASE WHEN pg_column_size(p_detail) > 8000 THEN '{"truncated": true}'::JSONB ELSE p_detail END));
  PERFORM set_config('app.audit_source', '', true);
END;
$$;

-- ตรวจสาย hash ของ audit (admin)
DROP FUNCTION IF EXISTS public.verify_audit_chain();
CREATE FUNCTION public.verify_audit_chain()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r       public.audit_logs%ROWTYPE;
  v_prev  TEXT;
  v_n     INT := 0;
BEGIN
  PERFORM app_private.require_role(ARRAY['super_admin', 'village_admin']);
  FOR r IN SELECT * FROM public.audit_logs WHERE seq IS NOT NULL ORDER BY seq LOOP
    IF (v_n > 0 AND r.prev_hash IS DISTINCT FROM v_prev) OR r.row_hash IS DISTINCT FROM app_private.audit_hash(r) THEN
      RETURN jsonb_build_object('ok', false, 'checked', v_n, 'broken_at_seq', r.seq, 'record', r.table_name || ':' || r.record_id);
    END IF;
    v_prev := r.row_hash;
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'checked', v_n);
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 9. PDPA — สิทธิ์เจ้าของข้อมูล, ประกาศความเป็นส่วนตัว, นิรนาม, ระยะเวลาเก็บ
-- ══════════════════════════════════════════════════════════════
ALTER TABLE public.member_access
  ADD COLUMN IF NOT EXISTS privacy_ack_version TEXT,
  ADD COLUMN IF NOT EXISTS privacy_ack_at      TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.privacy_requests (
  id          BIGSERIAL PRIMARY KEY,
  member_id   BIGINT NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
  kind        TEXT NOT NULL CHECK (kind IN ('access', 'rectify', 'erase', 'object', 'restrict', 'withdraw_consent', 'portability')),
  detail      TEXT,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'rejected')),
  response    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at      TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '30 days',
  handled_by  UUID REFERENCES public.profiles(id),
  handled_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_member ON public.privacy_requests(member_id);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_open   ON public.privacy_requests(status) WHERE status IN ('open', 'in_progress');

DROP TRIGGER IF EXISTS trg_audit_row ON public.privacy_requests;
CREATE TRIGGER trg_audit_row AFTER INSERT OR UPDATE OR DELETE ON public.privacy_requests
  FOR EACH ROW EXECUTE FUNCTION app_private.tg_audit_row();

-- สมาชิกรับทราบประกาศความเป็นส่วนตัว (เก็บเวอร์ชัน + เวลา)
DROP FUNCTION IF EXISTS public.member_ack_privacy(TEXT);
CREATE FUNCTION public.member_ack_privacy(p_version TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id BIGINT := app_private.require_member();
BEGIN
  IF COALESCE(p_version, '') !~ '^[0-9A-Za-z._-]{1,20}$' THEN RAISE EXCEPTION 'เวอร์ชันไม่ถูกต้อง'; END IF;
  UPDATE public.member_access SET privacy_ack_version = p_version, privacy_ack_at = now() WHERE member_id = v_id;
END;
$$;

-- ข้อมูลส่วนบุคคลของฉัน (สิทธิ์เข้าถึง/ขอรับสำเนา ม.30–31)
DROP FUNCTION IF EXISTS public.member_my_data();
CREATE FUNCTION public.member_my_data()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id BIGINT := app_private.require_member();
BEGIN
  RETURN (
    SELECT jsonb_build_object(
      'generated_at', now(),
      'profile', jsonb_build_object(
        'member_id', m.id, 'first_name', m.first_name, 'last_name', m.last_name,
        'national_id', CASE WHEN m.national_id_last4 IS NOT NULL THEN '•••••••••' || m.national_id_last4 END,
        'house_no', m.house_no, 'village', v.name, 'member_type', m.member_type,
        'household_count', m.household_count, 'registration_date', m.registration_date,
        'phone', m.phone, 'email', m.email, 'line_id', m.line_id,
        'gps', CASE WHEN m.gps_lat IS NOT NULL THEN jsonb_build_object('lat', m.gps_lat, 'lng', m.gps_lng) END,
        'meter_no', m.meter_no, 'meter_size', m.meter_size, 'status', m.status),
      'line_linked', a.line_user_id IS NOT NULL,
      'line_linked_at', a.line_linked_at,
      'privacy_ack', jsonb_build_object('version', a.privacy_ack_version, 'at', a.privacy_ack_at),
      'bills', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'period', b.period_label, 'usage', b.usage,
                          'total', b.total, 'status', b.status) ORDER BY b.period_year, b.period_month)
                         FROM public.bills b WHERE b.member_id = m.id), '[]'::JSONB),
      'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'bill_id', p.bill_id, 'paid_at', p.paid_at,
                          'amount', p.amount, 'channel', p.channel, 'receipt_no', p.receipt_no, 'status', p.status)
                          ORDER BY p.paid_at)
                         FROM public.payments p WHERE p.member_id = m.id), '[]'::JSONB),
      'readings', COALESCE((SELECT jsonb_agg(jsonb_build_object('date', r.reading_date, 'reading', r.curr_reading,
                          'usage', r.usage, 'has_photo', r.photo_url IS NOT NULL) ORDER BY r.reading_date)
                         FROM public.meter_readings r WHERE r.member_id = m.id), '[]'::JSONB),
      'requests', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', q.id, 'kind', q.kind, 'status', q.status,
                          'created_at', q.created_at, 'due_at', q.due_at, 'response', q.response) ORDER BY q.created_at DESC)
                         FROM public.privacy_requests q WHERE q.member_id = m.id), '[]'::JSONB))
    FROM public.members m
    LEFT JOIN public.villages v ON v.id = m.village_id
    LEFT JOIN public.member_access a ON a.member_id = m.id
    WHERE m.id = v_id
  );
END;
$$;

DROP FUNCTION IF EXISTS public.member_privacy_request(TEXT, TEXT);
CREATE FUNCTION public.member_privacy_request(p_kind TEXT, p_detail TEXT)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id  BIGINT := app_private.require_member();
  v_req BIGINT;
BEGIN
  IF p_kind NOT IN ('access', 'rectify', 'erase', 'object', 'restrict', 'withdraw_consent', 'portability') THEN
    RAISE EXCEPTION 'ประเภทคำขอไม่ถูกต้อง';
  END IF;
  IF (SELECT count(*) FROM public.privacy_requests WHERE member_id = v_id AND created_at > now() - INTERVAL '1 day') >= 3 THEN
    RAISE EXCEPTION 'ส่งคำขอได้ไม่เกิน 3 ครั้งต่อวัน';
  END IF;
  INSERT INTO public.privacy_requests (member_id, kind, detail)
  VALUES (v_id, p_kind, left(NULLIF(trim(p_detail), ''), 2000))
  RETURNING id INTO v_req;
  PERFORM app_private.notify_roles(ARRAY['super_admin', 'village_admin'], 'privacy_request',
    'คำขอใช้สิทธิ์ข้อมูลส่วนบุคคล (PDPA) — ต้องตอบภายใน 30 วัน', NULL, 'settings', v_req::TEXT);
  RETURN v_req;
END;
$$;

DROP FUNCTION IF EXISTS public.list_privacy_requests(BOOLEAN);
CREATE FUNCTION public.list_privacy_requests(p_open_only BOOLEAN DEFAULT true)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_role(ARRAY['super_admin', 'village_admin']);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', q.id, 'member_id', q.member_id,
             'member_name', m.first_name || ' ' || m.last_name, 'meter_no', m.meter_no,
             'kind', q.kind, 'detail', q.detail, 'status', q.status, 'response', q.response,
             'created_at', q.created_at, 'due_at', q.due_at, 'handled_at', q.handled_at) ORDER BY q.created_at DESC)
    FROM public.privacy_requests q JOIN public.members m ON m.id = q.member_id
    WHERE NOT p_open_only OR q.status IN ('open', 'in_progress')), '[]'::JSONB);
END;
$$;

DROP FUNCTION IF EXISTS public.update_privacy_request(BIGINT, TEXT, TEXT);
CREATE FUNCTION public.update_privacy_request(p_id BIGINT, p_status TEXT, p_response TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_role(ARRAY['super_admin', 'village_admin']);
  IF p_status NOT IN ('open', 'in_progress', 'done', 'rejected') THEN RAISE EXCEPTION 'สถานะไม่ถูกต้อง'; END IF;
  IF p_status IN ('done', 'rejected') AND NULLIF(trim(p_response), '') IS NULL THEN
    RAISE EXCEPTION 'กรุณาระบุคำตอบ/เหตุผลถึงเจ้าของข้อมูล';
  END IF;
  UPDATE public.privacy_requests
  SET status = p_status, response = NULLIF(trim(p_response), ''),
      handled_by = app_private.jwt_profile_id(),
      handled_at = CASE WHEN p_status IN ('done', 'rejected') THEN now() END
  WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบคำขอ'; END IF;
END;
$$;

-- ทำข้อมูลนิรนาม (สิทธิ์ขอลบ ม.33) — คงบิล/ใบเสร็จไว้ตามกฎหมายบัญชี แต่ตัดข้อมูลที่ระบุตัวตนได้
DROP FUNCTION IF EXISTS public.anonymise_member(BIGINT, TEXT);
CREATE FUNCTION public.anonymise_member(p_member_id BIGINT, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_prev TEXT := COALESCE(current_setting('app.trusted', true), '');
BEGIN
  PERFORM app_private.require_role(ARRAY['super_admin', 'village_admin']);
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'กรุณาระบุเหตุผล'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.members WHERE id = p_member_id AND COALESCE(is_deleted, false)) THEN
    RAISE EXCEPTION 'ต้องลบ (ปิด) สมาชิกก่อน จึงทำข้อมูลนิรนามได้';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bills WHERE member_id = p_member_id AND status::TEXT IN ('pending', 'overdue')) THEN
    RAISE EXCEPTION 'ยังมีบิลค้างชำระ — ทำข้อมูลนิรนามไม่ได้';
  END IF;
  PERFORM set_config('app.trusted', 'on', true);
  UPDATE public.members
  SET first_name = 'ลบข้อมูลแล้ว', last_name = '#' || id, national_id = '', house_no = '',
      phone = NULL, email = NULL, line_id = NULL, gps_lat = NULL, gps_lng = NULL, notes = NULL
  WHERE id = p_member_id;
  UPDATE public.payments SET payer_name = NULL, tx_ref = NULL WHERE member_id = p_member_id;
  UPDATE public.notification_outbox SET recipient = '', payload = '{}'::JSONB WHERE member_id = p_member_id;
  DELETE FROM public.member_access WHERE member_id = p_member_id;
  INSERT INTO public.audit_logs (table_name, record_id, action, new_data)
  VALUES ('members', p_member_id::TEXT, 'anonymise', jsonb_build_object('reason', trim(p_reason)));
  PERFORM set_config('app.trusted', v_prev, true);
END;
$$;

-- ลบข้อมูลที่เกินระยะเวลาเก็บ (เรียกวันละครั้งจาก pg_cron หรือ refresh)
CREATE OR REPLACE FUNCTION app_private.run_retention()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_outbox INT; v_notif INT; v_att INT; v_tok INT;
BEGIN
  DELETE FROM public.notification_outbox WHERE status IN ('sent', 'failed', 'skipped') AND created_at < now() - INTERVAL '90 days';
  GET DIAGNOSTICS v_outbox = ROW_COUNT;
  DELETE FROM public.notifications WHERE read_at IS NOT NULL AND created_at < now() - INTERVAL '180 days';
  GET DIAGNOSTICS v_notif = ROW_COUNT;
  DELETE FROM public.portal_login_attempts WHERE locked_until IS NULL OR locked_until < now() - INTERVAL '1 day';
  GET DIAGNOSTICS v_att = ROW_COUNT;
  DELETE FROM app_private.revoked_tokens WHERE expires_at < now();
  GET DIAGNOSTICS v_tok = ROW_COUNT;
  RETURN jsonb_build_object('outbox', v_outbox, 'notifications', v_notif, 'login_attempts', v_att, 'revoked_tokens', v_tok);
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 10. ปิดช่องโหว่อื่นๆ
-- ══════════════════════════════════════════════════════════════
-- 10.1 API key / secret อ่านจาก client ไม่ได้ (เรียก AI ผ่าน Edge Function meter-ocr แทน)
DROP POLICY IF EXISTS staff_select ON public.system_config;
CREATE POLICY staff_select ON public.system_config FOR SELECT TO authenticated
  USING ((SELECT app_private.staff_role()) IS NOT NULL AND key !~* '(token|secret|api_key|password)');
DROP POLICY IF EXISTS admin_insert ON public.system_config;
CREATE POLICY admin_insert ON public.system_config FOR INSERT TO authenticated
  WITH CHECK ((SELECT app_private.staff_role()) IN ('super_admin', 'village_admin') AND key !~* '(token|secret|api_key|password)');

-- 10.2 audit_logs: client เขียนตรงไม่ได้ (ใช้ log_event)
DROP POLICY IF EXISTS staff_insert ON public.audit_logs;
REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM authenticated;

-- 10.3 ลบการอ่านมิเตอร์ได้เฉพาะการเงิน/admin (ยกเลิกบิล)
DROP POLICY IF EXISTS staff_delete ON public.meter_readings;
DROP POLICY IF EXISTS finance_delete ON public.meter_readings;
CREATE POLICY finance_delete ON public.meter_readings FOR DELETE TO authenticated
  USING ((SELECT app_private.staff_role()) IN ('super_admin', 'village_admin', 'finance'));

-- 10.4 เปลี่ยนรหัส portal → LINE ที่ผูกไว้หลุดด้วย, รหัสไม่ส่งทาง LINE, ดูรหัสได้เฉพาะการเงิน/admin
DROP FUNCTION IF EXISTS public.regenerate_portal_code(BIGINT);
CREATE FUNCTION public.regenerate_portal_code(p_member_id BIGINT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v TEXT := app_private.new_portal_code();
BEGIN
  PERFORM app_private.require_role(ARRAY['super_admin', 'village_admin', 'finance']);
  IF NOT EXISTS (SELECT 1 FROM public.members WHERE id = p_member_id) THEN RAISE EXCEPTION 'ไม่พบสมาชิก'; END IF;
  INSERT INTO public.member_access AS a (member_id, portal_code) VALUES (p_member_id, v)
  ON CONFLICT (member_id) DO UPDATE SET portal_code = excluded.portal_code, line_user_id = NULL, line_linked_at = NULL;
  RETURN v;
END;
$$;

DROP FUNCTION IF EXISTS public.get_portal_codes(BIGINT[]);
CREATE FUNCTION public.get_portal_codes(p_member_ids BIGINT[])
RETURNS TABLE (member_id BIGINT, portal_code TEXT, line_linked BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_role(ARRAY['super_admin', 'village_admin', 'finance']);
  RETURN QUERY SELECT a.member_id, a.portal_code, a.line_user_id IS NOT NULL FROM public.member_access a WHERE a.member_id = ANY (p_member_ids);
END;
$$;

DROP FUNCTION IF EXISTS public.line_member_summary(TEXT);
CREATE FUNCTION public.line_member_summary(p_line_user_id TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'member_id', m.id, 'name', m.first_name || ' ' || m.last_name, 'meter_no', m.meter_no,
    'unpaid', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'period', b.period_label, 'total', b.total, 'due_date', b.due_date, 'status', b.status)
                        ORDER BY b.period_year, b.period_month)
                        FROM public.bills b WHERE b.member_id = m.id AND b.status::TEXT IN ('pending', 'overdue')), '[]'::JSONB),
    'org', app_private.public_org_info())
  FROM public.member_access a JOIN public.members m ON m.id = a.member_id
  WHERE a.line_user_id = p_line_user_id AND NOT COALESCE(m.is_deleted, false);
$$;

-- 10.5 trigger สมัครสมาชิกผ่าน Supabase Auth (ระบบเก่า) — ปิด
CREATE OR REPLACE FUNCTION public.fn_handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RETURN NEW;   -- ระบบไม่ใช้ Supabase Auth แล้ว: ไม่สร้าง profile จากการสมัครเอง
END;
$$;
DO $$
BEGIN
  DROP TRIGGER IF EXISTS trg_on_auth_user_created ON auth.users;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ลบ trigger บน auth.users ไม่ได้ (สิทธิ์) — ฟังก์ชันถูกปิดแล้ว ไม่มีผล';
END $$;
-- profile ที่ถูกสร้างจากการสมัครเอง (ไม่มีรหัสผ่าน ไม่เคย login) → ปิดใช้งาน
UPDATE public.profiles SET is_active = false
WHERE password_hash IS NULL AND last_login_at IS NULL AND is_active
  AND id IN (SELECT id FROM auth.users);

-- 10.6 export_backup: ไม่รวมรหัส portal/LINE, audit ถูกตัดข้อมูลลับแล้ว, บันทึกว่าใครสำรอง
CREATE OR REPLACE FUNCTION public.export_backup()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t      TEXT;
  v_rows JSONB;
  v_out  JSONB := jsonb_build_object('exported_at', now(), 'format', 'aquaflow-backup-v2');
BEGIN
  PERFORM app_private.require_role(ARRAY['super_admin', 'village_admin']);
  FOREACH t IN ARRAY ARRAY['villages', 'members', 'meter_readings', 'bills', 'payments',
                           'bill_adjustments', 'billing_periods', 'rate_tiers', 'master_data',
                           'maintenance_jobs', 'meter_replacements', 'water_production',
                           'water_quality', 'cash_closings', 'cashbook_entries', 'announcements', 'meter_skips',
                           'privacy_requests', 'audit_logs'] LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;
    EXECUTE format('SELECT COALESCE(jsonb_agg(app_private.redact(%L, to_jsonb(x))), ''[]'') FROM public.%I x', t, t) INTO v_rows;
    v_out := v_out || jsonb_build_object(t, v_rows);
  END LOOP;
  -- เลขบัตรประชาชนแบบเข้ารหัส (กุญแจอยู่ใน Vault ไม่อยู่ในไฟล์สำรอง)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('member_id', p.member_id, 'national_id_enc', encode(p.national_id_enc, 'base64'))), '[]')
  INTO v_rows FROM app_private.member_pii p;
  v_out := v_out || jsonb_build_object('member_pii_encrypted', v_rows);
  SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]') INTO v_rows FROM public.system_config c
  WHERE c.key !~* '(token|secret|api_key|password)';
  v_out := v_out || jsonb_build_object('system_config', v_rows);
  SELECT COALESCE(jsonb_agg(to_jsonb(p) - 'password_hash' - 'failed_login_count' - 'locked_until' - 'token_version'), '[]')
  INTO v_rows FROM public.profiles p;
  v_out := v_out || jsonb_build_object('profiles', v_rows);
  INSERT INTO public.system_config AS c (key, value, updated_at)
  VALUES ('last_backup_at', now()::TEXT, now())
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now();
  INSERT INTO public.audit_logs (table_name, record_id, action, new_data)
  VALUES ('backup', to_char(now(), 'YYYY-MM-DD'), 'export', jsonb_build_object('tables', (SELECT count(*) FROM jsonb_object_keys(v_out))));
  RETURN v_out;
END;
$$;

-- 10.7 สมาชิก: ออกจากระบบ portal = เพิกถอน token
-- (ใช้ logout_session เดียวกับเจ้าหน้าที่)

-- 10.8 helper ใน app_private: client เรียกได้เฉพาะที่ RLS ต้องใช้ — sign_jwt/issue_session ฯลฯ เรียกไม่ได้
ALTER DEFAULT PRIVILEGES IN SCHEMA app_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.staff_role(), app_private.jwt_profile_id(), app_private.jwt_member_id(),
  app_private.token_revoked() TO authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA app_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app_private FROM PUBLIC, anon, authenticated;

-- 10.9 รายชื่อเจ้าหน้าที่ (id → ชื่อ) สำหรับแสดงผู้จด/ผู้ออกบิล/ผู้รับผิดชอบงาน — ไม่มีข้อมูลติดต่อ
DROP FUNCTION IF EXISTS public.staff_directory();
CREATE FUNCTION public.staff_directory()
RETURNS TABLE (id UUID, full_name TEXT, role TEXT, is_active BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF app_private.staff_role() IS NULL THEN RAISE EXCEPTION 'SESSION_REVOKED' USING ERRCODE = '28000'; END IF;
  RETURN QUERY SELECT p.id, p.full_name, p.role::TEXT, p.is_active FROM public.profiles p ORDER BY p.full_name;
END;
$$;

-- Edge Function ใช้ตรวจว่า token เป็นเจ้าหน้าที่ที่ยังใช้งานได้ (เช่น meter-ocr)
DROP FUNCTION IF EXISTS public.staff_whoami();
CREATE FUNCTION public.staff_whoami()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', app_private.jwt_profile_id(), 'role', app_private.staff_role());
$$;

-- ══════════════════════════════════════════════════════════════
-- 11. สิทธิ์ RPC + RLS ตารางใหม่ + realtime
-- ══════════════════════════════════════════════════════════════
ALTER TABLE public.privacy_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.privacy_requests FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.privacy_requests_id_seq FROM anon, authenticated;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['refresh_session()', 'logout_session()', 'change_my_password(text,text)',
    'set_profile_password(uuid,text)', 'create_profile_user(text,text,text,text,text,user_role,integer)',
    'reveal_national_id(bigint)', 'refresh_billing_status()',
    'save_meter_reading(bigint,integer,integer,date,numeric,numeric,boolean,text,text,text,text)',
    'log_event(text,text,text,jsonb)', 'verify_audit_chain()', 'member_ack_privacy(text)', 'member_my_data()',
    'member_privacy_request(text,text)', 'list_privacy_requests(boolean)', 'update_privacy_request(bigint,text,text)',
    'anonymise_member(bigint,text)', 'regenerate_portal_code(bigint)', 'get_portal_codes(bigint[])',
    'export_backup()', 'staff_directory()', 'staff_whoami()'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
  REVOKE EXECUTE ON FUNCTION public.verify_login(text, text) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.verify_login(text, text) TO anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.line_member_summary(text) FROM PUBLIC, anon, authenticated;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.line_member_summary(text) TO service_role;
  END IF;
  REVOKE EXECUTE ON FUNCTION public.fn_handle_new_user() FROM PUBLIC, anon, authenticated;
END $$;

COMMIT;

-- ══════════════════════════════════════════════════════════════
-- 12. งานรายวัน: ลบข้อมูลเกินระยะเวลาเก็บ (รันแยกหลัง COMMIT — ต้องเปิด pg_cron)
-- ══════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('aquaflow-retention', '25 17 * * *', 'SELECT app_private.run_retention()');
  ELSE
    RAISE NOTICE 'pg_cron ไม่พร้อมใช้งาน — งานลบข้อมูลเกินระยะเวลาเก็บจะไม่ทำงานอัตโนมัติ';
  END IF;
END $$;
