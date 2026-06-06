-- ══════════════════════════════════════════════════════════════════
-- Admin User Management — RPCs สำหรับ Super Admin สร้าง/แก้ไข users
--
-- รันไฟล์นี้ใน Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- รันทีละ block หรือรวดเดียวก็ได้
-- ══════════════════════════════════════════════════════════════════

-- ── pgcrypto สำหรับ crypt() / gen_salt() ─────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ── 0. อัปเดต trigger สร้าง profile เมื่อ user ใหม่เข้าระบบ ──────────
--    (version นี้รวม email + username + phone ครบถ้วน)
CREATE OR REPLACE FUNCTION fn_handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role, email, username, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1), 'User'),
    COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'role','')::user_role,
      'meter_reader'
    ),
    NEW.email,
    NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'username','')), ''),
    NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'phone','')), '')
  )
  ON CONFLICT (id) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        email     = COALESCE(EXCLUDED.email,     profiles.email),
        username  = COALESCE(EXCLUDED.username,  profiles.username),
        phone     = COALESCE(EXCLUDED.phone,     profiles.phone),
        role      = EXCLUDED.role;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- ไม่ให้ trigger fail ทำให้ signup ล้มเหลว
  RAISE WARNING '[fn_handle_new_user] error: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- สร้าง trigger ถ้ายังไม่มี (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_on_auth_user_created'
      AND tgrelid = 'auth.users'::regclass
  ) THEN
    CREATE TRIGGER trg_on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION fn_handle_new_user();
  END IF;
END;
$$;

-- ── 1. เพิ่ม columns ที่อาจยังไม่มีใน profiles ───────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email    TEXT;

-- unique constraint บน username (ถ้ายังไม่มี)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_username_key' AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_username_key UNIQUE (username);
  END IF;
END;
$$;

-- ── 2. Drop functions เดิมทุก signature ที่อาจมีค้างอยู่ ─────────────
DROP FUNCTION IF EXISTS admin_create_user(TEXT,TEXT,TEXT,TEXT,TEXT,user_role,INT);
DROP FUNCTION IF EXISTS admin_create_user(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,INT);
DROP FUNCTION IF EXISTS get_all_users();
DROP FUNCTION IF EXISTS admin_update_user(UUID,TEXT,TEXT,TEXT,user_role,INT,BOOLEAN);
DROP FUNCTION IF EXISTS admin_update_user(UUID,TEXT,TEXT,TEXT,TEXT,INT,BOOLEAN);
DROP FUNCTION IF EXISTS admin_set_user_password(UUID,TEXT);
DROP FUNCTION IF EXISTS get_email_by_identifier(TEXT);

-- ── admin_create_user — สร้าง auth user โดยตรง (ไม่ต้องยืนยัน email) ──

CREATE OR REPLACE FUNCTION admin_create_user(
  p_email     TEXT,
  p_password  TEXT,
  p_full_name TEXT,
  p_username  TEXT DEFAULT '',
  p_phone     TEXT DEFAULT '',
  p_role      user_role DEFAULT 'meter_reader',
  p_village   INT  DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_uid      UUID := gen_random_uuid();
  v_username TEXT := NULLIF(trim(p_username), '');
  v_phone    TEXT := NULLIF(trim(p_phone),    '');
BEGIN
  -- เฉพาะ super_admin เท่านั้น
  IF (SELECT role FROM public.profiles WHERE id = auth.uid()) <> 'super_admin' THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  -- ตรวจ email ซ้ำ
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = lower(trim(p_email))) THEN
    RAISE EXCEPTION 'Email นี้มีอยู่ในระบบแล้ว';
  END IF;

  -- ตรวจ username ซ้ำ
  IF v_username IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles WHERE username = v_username
  ) THEN
    RAISE EXCEPTION 'Username นี้ถูกใช้แล้ว';
  END IF;

  -- Insert เข้า auth.users โดยตรง (email confirmed ทันที)
  INSERT INTO auth.users (
    id, instance_id, aud, role,
    email, encrypted_password,
    email_confirmed_at,
    raw_user_meta_data, raw_app_meta_data,
    is_super_admin, is_sso_user,
    created_at, updated_at
  ) VALUES (
    v_uid,
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    lower(trim(p_email)),
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(),
    jsonb_build_object(
      'full_name', p_full_name,
      'username',  p_username,
      'phone',     p_phone,
      'role',      p_role::text
    ),
    '{"provider":"email","providers":["email"]}'::jsonb,
    false, false,
    now(), now()
  );

  -- Insert identity (จำเป็นสำหรับ signInWithPassword)
  INSERT INTO auth.identities (
    id, provider_id, user_id,
    identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    v_uid,
    lower(trim(p_email)),
    v_uid,
    jsonb_build_object('sub', v_uid::text, 'email', lower(trim(p_email))),
    'email',
    now(), now(), now()
  ) ON CONFLICT DO NOTHING;

  -- อัปเดต profile ที่ trigger สร้างไว้ ให้ครบถ้วน
  UPDATE public.profiles SET
    full_name  = p_full_name,
    email      = lower(trim(p_email)),
    username   = v_username,
    phone      = v_phone,
    role       = p_role,
    village_id = p_village,
    is_active  = true,
    updated_at = now()
  WHERE id = v_uid;

  RETURN v_uid;
END;
$$;

-- ── 3. admin_set_user_password — super_admin เปลี่ยนรหัสผ่านคนอื่น ───
CREATE OR REPLACE FUNCTION admin_set_user_password(
  p_user_id  UUID,
  p_password TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF (SELECT role FROM public.profiles WHERE id = auth.uid()) <> 'super_admin' THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  UPDATE auth.users
  SET encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
      updated_at         = now()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;
END;
$$;

-- ── 4. get_all_users ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_all_users()
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (SELECT pr.role FROM public.profiles pr WHERE pr.id = auth.uid()) <> 'super_admin' THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  RETURN QUERY
    SELECT p.id, p.full_name, p.username, p.email, p.phone,
           p.role, p.village_id, p.is_active, p.created_at
    FROM public.profiles p
    ORDER BY p.created_at;
END;
$$;

-- ── 5. admin_update_user ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_update_user(
  p_user_id   UUID,
  p_full_name TEXT,
  p_username  TEXT,
  p_phone     TEXT,
  p_role      user_role,
  p_village   INT,
  p_active    BOOLEAN
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (SELECT role FROM public.profiles WHERE id = auth.uid()) <> 'super_admin' THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  UPDATE public.profiles SET
    full_name  = p_full_name,
    username   = NULLIF(trim(p_username), ''),
    phone      = NULLIF(trim(p_phone), ''),
    role       = p_role,
    village_id = p_village,
    is_active  = p_active,
    updated_at = now()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;
END;
$$;

-- ── 6. get_email_by_identifier ───────────────────────────────────────
CREATE OR REPLACE FUNCTION get_email_by_identifier(p_identifier TEXT)
RETURNS TEXT LANGUAGE sql SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT u.email
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id
  WHERE
    length(regexp_replace(p_identifier, '[^0-9]', '', 'g')) >= 9
    AND regexp_replace(COALESCE(p.phone,''), '[^0-9]', '', 'g')
          = regexp_replace(p_identifier, '[^0-9]', '', 'g')
  UNION
  SELECT u.email
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id
  WHERE lower(p.username) = lower(trim(p_identifier))
  LIMIT 1;
$$;

-- ══════════════════════════════════════════════════════════════════
-- หมายเหตุ: รันไฟล์นี้ใน Supabase SQL Editor แล้วรีเฟรชแอป
-- ไม่ต้องเปลี่ยนการตั้งค่า Authentication settings ใน Supabase
-- ══════════════════════════════════════════════════════════════════
