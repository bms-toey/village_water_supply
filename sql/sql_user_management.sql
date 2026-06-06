-- ══════════════════════════════════════════════════════════════
-- User Management — รันใน Supabase SQL Editor (ทีละ block ได้)
-- ══════════════════════════════════════════════════════════════

-- 1. เพิ่ม columns ใน profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email    TEXT;

-- 2. อัปเดต trigger สร้าง profile — เพิ่ม email + username
CREATE OR REPLACE FUNCTION fn_handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role, email, username, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)),
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'meter_reader'),
    NEW.email,
    NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'username','')), ''),
    NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'phone','')), '')
  )
  ON CONFLICT (id) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        email     = EXCLUDED.email,
        username  = COALESCE(EXCLUDED.username, profiles.username),
        phone     = COALESCE(EXCLUDED.phone, profiles.phone);
  RETURN NEW;
END;
$$;

-- 3. Lookup email จาก email / phone / username (ใช้ตอน login)
CREATE OR REPLACE FUNCTION get_email_by_identifier(p_identifier TEXT)
RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT u.email
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id
  WHERE
    -- phone: normalize เอา non-digit ออกแล้วเทียบ
    regexp_replace(COALESCE(p.phone,''), '[^0-9]', '', 'g')
      = regexp_replace(p_identifier, '[^0-9]', '', 'g')
    AND length(regexp_replace(p_identifier, '[^0-9]', '', 'g')) >= 9
  UNION
  SELECT u.email
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id
  WHERE lower(p.username) = lower(trim(p_identifier))
  LIMIT 1;
$$;

-- 4. ดึงรายการ users ทั้งหมด (เฉพาะ super_admin)
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
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF (SELECT role FROM public.profiles WHERE id = auth.uid()) <> 'super_admin' THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  RETURN QUERY
    SELECT p.id, p.full_name, p.username, p.email, p.phone,
           p.role, p.village_id, p.is_active, p.created_at
    FROM public.profiles p
    ORDER BY p.created_at;
END;
$$;

-- 5. อัปเดต profile โดย super_admin
CREATE OR REPLACE FUNCTION admin_update_user(
  p_user_id   UUID,
  p_full_name TEXT,
  p_username  TEXT,
  p_phone     TEXT,
  p_role      user_role,
  p_village   INT,
  p_active    BOOLEAN
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
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
END;
$$;

-- 6. ตัวอย่างตั้งค่า super_admin user แรก:
-- UPDATE profiles SET role = 'super_admin', username = 'admin' WHERE id = '<uuid>';
