-- ══════════════════════════════════════════════════════════════
-- Simple Auth — ออกจาก Supabase Authentication ทั้งหมด
-- ใช้ profiles.password_hash + localStorage session แทน
--
-- รัน SQL นี้ใน Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════════════════

-- pgcrypto (ถ้ายังไม่มี)
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ── เพิ่ม password_hash ใน profiles ──────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- ══════════════════════════════════════════════════════════════
-- ปิด RLS ทุก Table (ระบบ internal — security อยู่ที่ login form)
-- ══════════════════════════════════════════════════════════════
ALTER TABLE public.profiles         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.villages         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.members          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.meter_readings   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.bills            DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_tiers       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_jobs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.water_production DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.water_quality    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_data      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_config    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs       DISABLE ROW LEVEL SECURITY;

-- Grant anon สิทธิ์อ่าน/เขียน (ใช้ anon key จาก frontend)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;

-- ══════════════════════════════════════════════════════════════
-- verify_login — ตรวจสอบ credentials แล้ว return profile
-- รองรับ: email / username / เบอร์โทร + password
-- ══════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.verify_login(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.verify_login(p_identifier TEXT, p_password TEXT)
RETURNS TABLE (
  id         UUID,
  full_name  TEXT,
  email      TEXT,
  username   TEXT,
  phone      TEXT,
  role       user_role,
  village_id INT,
  is_active  BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_p public.profiles%ROWTYPE;
BEGIN
  -- ค้นหาด้วย email / username / phone
  SELECT * INTO v_p
  FROM public.profiles p
  WHERE (
    lower(COALESCE(p.email, ''))    = lower(trim(p_identifier))
    OR lower(COALESCE(p.username, '')) = lower(trim(p_identifier))
    OR (
      length(regexp_replace(p_identifier, '[^0-9]', '', 'g')) >= 9
      AND regexp_replace(COALESCE(p.phone, ''), '[^0-9]', '', 'g')
        = regexp_replace(p_identifier, '[^0-9]', '', 'g')
    )
  )
  AND p.is_active = true
  LIMIT 1;

  IF v_p.id IS NULL THEN
    RAISE EXCEPTION 'ไม่พบผู้ใช้นี้ในระบบ';
  END IF;

  IF v_p.password_hash IS NULL THEN
    RAISE EXCEPTION 'ยังไม่ได้ตั้งรหัสผ่าน กรุณาติดต่อผู้ดูแลระบบ';
  END IF;

  IF v_p.password_hash <> extensions.crypt(p_password, v_p.password_hash) THEN
    RAISE EXCEPTION 'รหัสผ่านไม่ถูกต้อง';
  END IF;

  RETURN QUERY SELECT
    v_p.id, v_p.full_name, v_p.email, v_p.username,
    v_p.phone, v_p.role, v_p.village_id, v_p.is_active;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_login(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.verify_login(TEXT, TEXT) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- set_profile_password — ตั้ง/เปลี่ยนรหัสผ่านสำหรับ user ใดก็ได้
-- เรียกโดย admin (เปลี่ยนให้คนอื่น) หรือ user เอง (เปลี่ยนรหัสตัวเอง)
-- ══════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.set_profile_password(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.set_profile_password(p_user_id UUID, p_password TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF length(p_password) < 6 THEN
    RAISE EXCEPTION 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร';
  END IF;
  UPDATE public.profiles
  SET password_hash = extensions.crypt(p_password, extensions.gen_salt('bf')),
      updated_at    = now()
  WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบผู้ใช้';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_profile_password(UUID, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.set_profile_password(UUID, TEXT) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- create_profile_user — สร้าง user ใหม่ใน profiles เท่านั้น
-- ไม่ต้องสร้าง auth.users แล้ว
-- ══════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.create_profile_user(TEXT, TEXT, TEXT, TEXT, TEXT, user_role, INT);

CREATE OR REPLACE FUNCTION public.create_profile_user(
  p_email     TEXT,
  p_password  TEXT,
  p_full_name TEXT,
  p_username  TEXT    DEFAULT '',
  p_phone     TEXT    DEFAULT '',
  p_role      user_role DEFAULT 'meter_reader',
  p_village   INT     DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_uid      UUID := gen_random_uuid();
  v_username TEXT := NULLIF(trim(p_username), '');
  v_phone    TEXT := NULLIF(trim(p_phone), '');
  v_email    TEXT := NULLIF(lower(trim(p_email)), '');
BEGIN
  -- ตรวจ email ซ้ำ
  IF v_email IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles WHERE lower(COALESCE(email,'')) = v_email
  ) THEN
    RAISE EXCEPTION 'Email นี้มีอยู่ในระบบแล้ว';
  END IF;

  -- ตรวจ username ซ้ำ
  IF v_username IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles WHERE lower(COALESCE(username,'')) = lower(v_username)
  ) THEN
    RAISE EXCEPTION 'Username นี้ถูกใช้แล้ว';
  END IF;

  INSERT INTO public.profiles (
    id, full_name, email, username, phone,
    role, village_id, is_active,
    password_hash, created_at, updated_at
  ) VALUES (
    v_uid, p_full_name, v_email, v_username, v_phone,
    p_role, p_village, true,
    CASE WHEN trim(p_password) <> ''
         THEN extensions.crypt(p_password, extensions.gen_salt('bf'))
         ELSE NULL
    END,
    now(), now()
  );

  RETURN v_uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_profile_user(TEXT,TEXT,TEXT,TEXT,TEXT,user_role,INT) TO anon;
GRANT EXECUTE ON FUNCTION public.create_profile_user(TEXT,TEXT,TEXT,TEXT,TEXT,user_role,INT) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- get_all_users — คืน profiles ทั้งหมด (ไม่เช็ค auth.uid แล้ว)
-- ══════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.get_all_users();

CREATE OR REPLACE FUNCTION public.get_all_users()
RETURNS TABLE (
  id         UUID,
  full_name  TEXT,
  username   TEXT,
  email      TEXT,
  phone      TEXT,
  role       user_role,
  village_id INT,
  is_active  BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT id, full_name, username, email, phone, role, village_id, is_active, created_at
  FROM public.profiles
  ORDER BY created_at;
$$;

GRANT EXECUTE ON FUNCTION public.get_all_users() TO anon;
GRANT EXECUTE ON FUNCTION public.get_all_users() TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- admin_update_user — อัปเดต profile (ไม่เช็ค auth.uid แล้ว)
-- ══════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.admin_update_user(UUID, TEXT, TEXT, TEXT, user_role, INT, BOOLEAN);
DROP FUNCTION IF EXISTS public.admin_update_user(UUID, TEXT, TEXT, TEXT, TEXT,      INT, BOOLEAN);

CREATE OR REPLACE FUNCTION public.admin_update_user(
  p_user_id   UUID,
  p_full_name TEXT,
  p_username  TEXT,
  p_phone     TEXT,
  p_role      TEXT,
  p_village   INT,
  p_active    BOOLEAN
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.profiles SET
    full_name  = p_full_name,
    username   = NULLIF(trim(p_username), ''),
    phone      = NULLIF(trim(p_phone), ''),
    role       = p_role::user_role,
    village_id = p_village,
    is_active  = p_active,
    updated_at = now()
  WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบผู้ใช้'; END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_user(UUID,TEXT,TEXT,TEXT,TEXT,INT,BOOLEAN) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_update_user(UUID,TEXT,TEXT,TEXT,TEXT,INT,BOOLEAN) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- ตั้งรหัสผ่านเริ่มต้นสำหรับ admin (เปลี่ยนรหัสผ่านได้ผ่านหน้า Users)
-- แก้ไข 'รหัสผ่านที่ต้องการ' ให้เหมาะสมก่อนรัน
-- ══════════════════════════════════════════════════════════════
-- SELECT set_profile_password(id, 'Admin1234') FROM public.profiles WHERE role = 'super_admin' LIMIT 1;

-- ══════════════════════════════════════════════════════════════
-- หลังรัน SQL นี้แล้ว:
-- 1. รัน set_profile_password สำหรับ admin (บรรทัดสุดท้าย)
-- 2. รีโหลดแอป แล้ว login ด้วย email/username + รหัสผ่านที่ตั้ง
-- ══════════════════════════════════════════════════════════════
