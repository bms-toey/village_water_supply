-- ══════════════════════════════════════════════════════════════
-- Secure Auth + RLS (Phase 0)
--
-- แทนที่ sql_simple_auth.sql — Login ยังใช้ email / username / เบอร์โทร
-- + profiles.password_hash เหมือนเดิม แต่หลัง login ฐานข้อมูลจะออก
-- JWT (HS256) ให้ แล้วทุก request ต้องแนบ JWT นี้ — RLS จึงบังคับสิทธิ์ได้จริง
--
-- สิ่งที่ไฟล์นี้ทำ
--   1. ปิดสิทธิ์ anon ทั้งหมด เหลือแค่ verify_login
--   2. เปิด RLS ทุกตาราง + policy ตาม role
--   3. ล็อกบัญชี 15 นาทีเมื่อใส่รหัสผิด 5 ครั้ง
--   4. Session อายุ 12 ชม. (ต่ออายุอัตโนมัติขณะใช้งาน)
--      เปลี่ยนรหัสผ่าน / ปิดบัญชี → session เดิมใช้ไม่ได้ทันที
--   5. RPC จัดการผู้ใช้ ต้องเป็น super_admin เท่านั้น
--   6. audit_logs แก้/ลบไม่ได้ และ performed_by ถูกกำหนดจาก server
--
-- ── วิธีติดตั้ง (ทำครั้งเดียว) ────────────────────────────────
-- ขั้นที่ 1: Supabase Dashboard → Project Settings → JWT Keys
--            → แท็บ "Legacy JWT Secret" → คัดลอก secret
-- ขั้นที่ 2: SQL Editor → รันคำสั่งนี้ (ห้าม commit secret ลง Git)
--
--   SELECT vault.create_secret('วาง-legacy-jwt-secret-ที่นี่', 'app_jwt_secret');
--
-- ขั้นที่ 3: รันไฟล์นี้ทั้งไฟล์ใน SQL Editor
-- ขั้นที่ 4: Deploy frontend เวอร์ชันใหม่ แล้วทุกคน login ใหม่หนึ่งครั้ง
--
-- ไฟล์นี้รันอยู่ใน transaction เดียว — ถ้าผิดพลาดตรงไหน จะไม่มีอะไรเปลี่ยน
-- รันซ้ำได้
-- ══════════════════════════════════════════════════════════════

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'app_jwt_secret') THEN
    RAISE EXCEPTION 'ยังไม่ได้ใส่ JWT secret ใน Vault — ทำขั้นที่ 1–2 ที่หัวไฟล์ก่อน';
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════
-- 1. profiles — คอลัมน์สำหรับ session และการล็อกบัญชี
-- ══════════════════════════════════════════════════════════════
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS password_hash      TEXT,
  ADD COLUMN IF NOT EXISTS token_version      INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_login_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_login_at      TIMESTAMPTZ;

-- ระบบไม่ใช้ auth.users แล้ว — ตัด FK ที่ทำให้สร้างผู้ใช้ใหม่ไม่ได้
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

-- members.deleted_by เก็บ profile id → ชี้ไปที่ profiles แทน auth.users
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'members' AND column_name = 'deleted_by') THEN
    ALTER TABLE public.members DROP CONSTRAINT IF EXISTS members_deleted_by_fkey;
    ALTER TABLE public.members ADD CONSTRAINT members_deleted_by_fkey
      FOREIGN KEY (deleted_by) REFERENCES public.profiles(id) NOT VALID;
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════
-- 2. app_private — helper ที่ไม่เปิดผ่าน API
-- ══════════════════════════════════════════════════════════════
CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA app_private TO authenticated;

CREATE OR REPLACE FUNCTION app_private.b64url(p_data BYTEA)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT translate(rtrim(replace(encode(p_data, 'base64'), E'\n', ''), '='), '+/', '-_');
$$;

CREATE OR REPLACE FUNCTION app_private.sign_jwt(p_claims JSONB)
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_secret TEXT;
  v_unsigned TEXT;
BEGIN
  SELECT trim(decrypted_secret) INTO v_secret
  FROM vault.decrypted_secrets WHERE name = 'app_jwt_secret' LIMIT 1;
  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE EXCEPTION 'JWT secret ยังไม่ได้ตั้งค่าใน Vault (app_jwt_secret)';
  END IF;

  v_unsigned := app_private.b64url(convert_to('{"alg":"HS256","typ":"JWT"}', 'UTF8'))
             || '.' || app_private.b64url(convert_to(p_claims::TEXT, 'UTF8'));
  RETURN v_unsigned || '.' || app_private.b64url(extensions.hmac(v_unsigned, v_secret, 'sha256'));
END;
$$;

-- profile id จาก JWT (NULL ถ้าไม่มีหรือไม่ใช่ uuid)
CREATE OR REPLACE FUNCTION app_private.jwt_profile_id()
RETURNS UUID LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE WHEN auth.jwt() ->> 'sub' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN (auth.jwt() ->> 'sub')::UUID END;
$$;

-- role ของผู้ใช้ปัจจุบัน — NULL ถ้า: ไม่ได้ login / บัญชีถูกปิด /
-- session ถูกเพิกถอน (token_version ไม่ตรง เช่น เปลี่ยนรหัสผ่านแล้ว)
CREATE OR REPLACE FUNCTION app_private.staff_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.role::TEXT
  FROM public.profiles p
  WHERE p.id = app_private.jwt_profile_id()
    AND p.is_active
    AND p.token_version::TEXT = (auth.jwt() ->> 'tv');
$$;

CREATE OR REPLACE FUNCTION app_private.require_super_admin()
RETURNS VOID LANGUAGE plpgsql STABLE SET search_path = '' AS $$
BEGIN
  IF app_private.staff_role() IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ดำเนินการ (เฉพาะ Super Admin)' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.check_password_policy(p_password TEXT)
RETURNS VOID LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF p_password IS NULL OR length(p_password) < 8
     OR p_password !~ '[A-Za-z]' OR p_password !~ '[0-9]' THEN
    RAISE EXCEPTION 'รหัสผ่านต้องมีอย่างน้อย 8 ตัว และมีทั้งตัวอักษรและตัวเลข' USING ERRCODE = '22023';
  END IF;
END;
$$;

-- ออก session ใหม่: { token, expires_at (epoch วินาที), profile }
CREATE OR REPLACE FUNCTION app_private.issue_session(p_profile_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c_ttl CONSTANT INT := 12 * 3600;
  v     public.profiles%ROWTYPE;
  v_now BIGINT := extract(epoch FROM now())::BIGINT;
BEGIN
  SELECT * INTO v FROM public.profiles WHERE id = p_profile_id;
  RETURN jsonb_build_object(
    'token', app_private.sign_jwt(jsonb_build_object(
      'sub',      v.id,
      'role',     'authenticated',
      'aud',      'authenticated',
      'iat',      v_now,
      'exp',      v_now + c_ttl,
      'tv',       v.token_version,
      'app_role', v.role
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

-- ══════════════════════════════════════════════════════════════
-- 3. Login / Session RPC
-- ══════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.verify_login(TEXT, TEXT);

-- คืน { token, expires_at, profile } หรือ { error } — ไม่ RAISE เพื่อให้
-- ตัวนับรหัสผิดถูกบันทึก (RAISE จะ rollback การ UPDATE)
CREATE FUNCTION public.verify_login(p_identifier TEXT, p_password TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c_max_fail CONSTANT INT := 5;
  c_lock     CONSTANT INTERVAL := INTERVAL '15 minutes';
  c_fail     CONSTANT TEXT := 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
  v          public.profiles%ROWTYPE;
  v_id       TEXT := lower(trim(COALESCE(p_identifier, '')));
  v_digits   TEXT := regexp_replace(COALESCE(p_identifier, ''), '[^0-9]', '', 'g');
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
  ORDER BY p.is_active DESC
  LIMIT 1;

  IF v.id IS NULL OR NOT v.is_active THEN
    RETURN jsonb_build_object('error', c_fail);
  END IF;

  IF v.locked_until IS NOT NULL AND v.locked_until > now() THEN
    RETURN jsonb_build_object('error', format(
      'บัญชีถูกล็อกชั่วคราวเพราะใส่รหัสผ่านผิดหลายครั้ง กรุณาลองใหม่ในอีก %s นาที',
      ceil(extract(epoch FROM v.locked_until - now()) / 60)::INT));
  END IF;

  IF v.password_hash IS NULL THEN
    RETURN jsonb_build_object('error', 'บัญชีนี้ยังไม่ได้ตั้งรหัสผ่าน กรุณาติดต่อผู้ดูแลระบบ');
  END IF;

  IF v.password_hash <> extensions.crypt(p_password, v.password_hash) THEN
    UPDATE public.profiles
    SET failed_login_count = failed_login_count + 1,
        locked_until = CASE WHEN failed_login_count + 1 >= c_max_fail
                            THEN now() + c_lock ELSE locked_until END
    WHERE id = v.id;
    RETURN jsonb_build_object('error', c_fail);
  END IF;

  UPDATE public.profiles
  SET failed_login_count = 0, locked_until = NULL, last_login_at = now()
  WHERE id = v.id;

  RETURN app_private.issue_session(v.id);
END;
$$;

-- ต่ออายุ session (ต้องมี JWT ที่ยังใช้ได้)
DROP FUNCTION IF EXISTS public.refresh_session();
CREATE FUNCTION public.refresh_session()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF app_private.staff_role() IS NULL THEN
    RAISE EXCEPTION 'SESSION_REVOKED' USING ERRCODE = '28000';
  END IF;
  RETURN app_private.issue_session(app_private.jwt_profile_id());
END;
$$;

-- ผู้ใช้เปลี่ยนรหัสตัวเอง — session อื่นทั้งหมดของผู้ใช้นี้จะหลุด
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
  SET password_hash = extensions.crypt(p_new, extensions.gen_salt('bf')),
      token_version = token_version + 1,
      updated_at    = now()
  WHERE id = v_uid;

  RETURN app_private.issue_session(v_uid);
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 4. RPC จัดการผู้ใช้ — super_admin เท่านั้น
-- ══════════════════════════════════════════════════════════════

-- ตั้งรหัสผ่านให้ผู้ใช้ — session เดิมของผู้ใช้นั้นหลุดทั้งหมด
-- ถ้าตั้งให้ตัวเอง จะคืน session ใหม่ (ไม่งั้นคืน NULL)
DROP FUNCTION IF EXISTS public.set_profile_password(UUID, TEXT);
CREATE FUNCTION public.set_profile_password(p_user_id UUID, p_password TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_super_admin();
  PERFORM app_private.check_password_policy(p_password);

  UPDATE public.profiles
  SET password_hash      = extensions.crypt(p_password, extensions.gen_salt('bf')),
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

  IF NULLIF(trim(p_full_name), '') IS NULL THEN
    RAISE EXCEPTION 'กรุณากรอกชื่อ-นามสกุล';
  END IF;
  IF v_email IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles WHERE lower(COALESCE(email, '')) = v_email
  ) THEN
    RAISE EXCEPTION 'Email นี้มีอยู่ในระบบแล้ว';
  END IF;
  IF v_username IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles WHERE lower(COALESCE(username, '')) = lower(v_username)
  ) THEN
    RAISE EXCEPTION 'Username นี้ถูกใช้แล้ว';
  END IF;

  INSERT INTO public.profiles (
    id, full_name, email, username, phone, role, village_id, is_active,
    password_hash, created_at, updated_at
  ) VALUES (
    v_uid, trim(p_full_name), v_email, v_username, v_phone, p_role, p_village, true,
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(), now()
  );
  RETURN v_uid;
END;
$$;

DROP FUNCTION IF EXISTS public.get_all_users();
CREATE FUNCTION public.get_all_users()
RETURNS TABLE (
  id         UUID,
  full_name  TEXT,
  username   TEXT,
  email      TEXT,
  phone      TEXT,
  role       public.user_role,
  village_id INT,
  is_active  BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_super_admin();
  RETURN QUERY
    SELECT p.id, p.full_name, p.username, p.email, p.phone,
           p.role, p.village_id, p.is_active, p.created_at
    FROM public.profiles p
    ORDER BY p.created_at;
END;
$$;

DROP FUNCTION IF EXISTS public.admin_update_user(UUID, TEXT, TEXT, TEXT, user_role, INT, BOOLEAN);
DROP FUNCTION IF EXISTS public.admin_update_user(UUID, TEXT, TEXT, TEXT, TEXT, INT, BOOLEAN);
CREATE FUNCTION public.admin_update_user(
  p_user_id   UUID,
  p_full_name TEXT,
  p_username  TEXT,
  p_phone     TEXT,
  p_role      TEXT,
  p_village   INT,
  p_active    BOOLEAN
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_old public.profiles%ROWTYPE;
BEGIN
  PERFORM app_private.require_super_admin();

  SELECT * INTO v_old FROM public.profiles WHERE id = p_user_id;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'ไม่พบผู้ใช้'; END IF;

  IF p_user_id = app_private.jwt_profile_id()
     AND (p_role::public.user_role <> v_old.role OR NOT p_active) THEN
    RAISE EXCEPTION 'ไม่สามารถเปลี่ยน Role หรือปิดใช้งานบัญชีของตัวเองได้';
  END IF;

  UPDATE public.profiles SET
    full_name  = p_full_name,
    username   = NULLIF(trim(p_username), ''),
    phone      = NULLIF(trim(p_phone), ''),
    role       = p_role::public.user_role,
    village_id = p_village,
    is_active  = p_active,
    updated_at = now()
  WHERE id = p_user_id;
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 5. audit_logs — server เป็นคนกำหนดผู้ทำรายการและเวลา
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION app_private.tg_audit_stamp()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor TEXT;
BEGIN
  SELECT COALESCE(p.username, p.email, p.full_name) INTO v_actor
  FROM public.profiles p WHERE p.id = app_private.jwt_profile_id();
  IF v_actor IS NOT NULL THEN
    NEW.performed_by := v_actor;
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_stamp ON public.audit_logs;
CREATE TRIGGER trg_audit_stamp
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION app_private.tg_audit_stamp();

-- ══════════════════════════════════════════════════════════════
-- 6. สิทธิ์ระดับ role ของฐานข้อมูล
-- ══════════════════════════════════════════════════════════════
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon, PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- คนนอกเรียกได้แค่ login
GRANT EXECUTE ON FUNCTION public.verify_login(TEXT, TEXT) TO anon;

-- profiles อ่าน/เขียนได้ผ่าน RPC เท่านั้น (กัน password_hash รั่ว)
REVOKE ALL ON public.profiles FROM authenticated;

-- helper ใน app_private
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC, anon;
GRANT  EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private TO authenticated;

-- View: ให้เคารพ RLS ของผู้เรียก และอ่านได้อย่างเดียว
-- (view แบบง่ายเขียนทะลุไปที่ตารางได้ ถ้าไม่ปิดไว้)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT viewname FROM pg_views WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', r.viewname);
    EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', r.viewname);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', r.viewname);
  END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════
-- 7. RLS — เปิดทุกตาราง ล้าง policy เก่า แล้วสร้างใหม่
--
--  ตาราง                          อ่าน          เพิ่ม/แก้       ลบ
--  ─────────────────────────────  ────────────  ─────────────  ────────────
--  members, bills, payments,      staff         staff          — (ใช้ soft delete/ยกเลิก)
--  maintenance_jobs, meter_       staff         staff          —
--  replacements, water_*
--  meter_readings                 staff         staff          staff (ยกเลิกบิล)
--  villages, rate_tiers,          staff         admin          admin
--  master_data, system_config
--  audit_logs                     admin         staff          — (แก้ไม่ได้)
--  profiles                       — (ผ่าน RPC เท่านั้น)
--
--  staff = ผู้ใช้ที่ login และบัญชีเปิดใช้งาน (ทุก role)
--  admin = super_admin, village_admin
-- ══════════════════════════════════════════════════════════════
DO $$
DECLARE
  r RECORD;
  t TEXT;
  c_staff CONSTANT TEXT := '(SELECT app_private.staff_role()) IS NOT NULL';
  c_admin CONSTANT TEXT := '(SELECT app_private.staff_role()) IN (''super_admin'', ''village_admin'')';
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;

  FOR r IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['members', 'bills', 'payments', 'meter_readings', 'maintenance_jobs',
                           'meter_replacements', 'water_production', 'water_quality'] LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;
    EXECUTE format('CREATE POLICY staff_select ON public.%I FOR SELECT TO authenticated USING (%s)', t, c_staff);
    EXECUTE format('CREATE POLICY staff_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)', t, c_staff);
    EXECUTE format('CREATE POLICY staff_update ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', t, c_staff, c_staff);
  END LOOP;
  IF to_regclass('public.meter_readings') IS NOT NULL THEN
    EXECUTE format('CREATE POLICY staff_delete ON public.meter_readings FOR DELETE TO authenticated USING (%s)', c_staff);
  END IF;

  FOREACH t IN ARRAY ARRAY['villages', 'rate_tiers', 'master_data', 'system_config'] LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;
    EXECUTE format('CREATE POLICY staff_select ON public.%I FOR SELECT TO authenticated USING (%s)', t, c_staff);
    EXECUTE format('CREATE POLICY admin_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)', t, c_admin);
    EXECUTE format('CREATE POLICY admin_update ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', t, c_admin, c_admin);
    EXECUTE format('CREATE POLICY admin_delete ON public.%I FOR DELETE TO authenticated USING (%s)', t, c_admin);
  END LOOP;

  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    EXECUTE format('CREATE POLICY admin_select ON public.audit_logs FOR SELECT TO authenticated USING (%s)', c_admin);
    EXECUTE format('CREATE POLICY staff_insert ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (%s)', c_staff);
  END IF;
END $$;

COMMIT;

-- ══════════════════════════════════════════════════════════════
-- ตรวจผลหลังรัน (ไม่บังคับ)
-- ══════════════════════════════════════════════════════════════
-- ตารางที่ยังไม่เปิด RLS (ควรได้ 0 แถว):
--   SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity;
-- ฟังก์ชันที่ anon เรียกได้ (ควรเหลือ verify_login อย่างเดียว):
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE');
-- ทดสอบออก token (ต้องได้ข้อความขึ้นต้น eyJ):
--   SELECT app_private.sign_jwt('{"test":1}'::jsonb);
