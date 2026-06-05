-- ══════════════════════════════════════════════════════════════
-- LOGIN FIX — รัน SQL นี้ใน Supabase Dashboard → SQL Editor
-- แก้ปัญหา login ด้วยเบอร์โทร / Username ไม่ได้
-- ══════════════════════════════════════════════════════════════

-- STEP 1: เพิ่ม columns ใน profiles (ถ้ายังไม่มี)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username   TEXT UNIQUE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email      TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone      TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_active  BOOLEAN DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- STEP 2: สร้าง/อัปเดต function get_email_by_identifier
-- ใช้หา email จาก เบอร์โทร หรือ username สำหรับ login
CREATE OR REPLACE FUNCTION public.get_email_by_identifier(p_identifier TEXT)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  -- ค้นหาด้วยเบอร์โทร (normalize เอาแต่ตัวเลข, ต้องยาวอย่างน้อย 9 หลัก)
  SELECT u.email
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id
  WHERE
    length(regexp_replace(p_identifier, '[^0-9]', '', 'g')) >= 9
    AND regexp_replace(COALESCE(p.phone, ''), '[^0-9]', '', 'g')
      = regexp_replace(p_identifier, '[^0-9]', '', 'g')

  UNION ALL

  -- ค้นหาด้วย username (case-insensitive)
  SELECT u.email
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id
  WHERE
    length(regexp_replace(p_identifier, '[^0-9]', '', 'g')) < 9
    AND lower(trim(COALESCE(p.username, ''))) = lower(trim(p_identifier))
    AND trim(p_identifier) <> ''

  LIMIT 1;
$$;

-- STEP 3: Grant ให้ anon (ก่อน login) และ authenticated เรียกใช้ได้
GRANT EXECUTE ON FUNCTION public.get_email_by_identifier(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_email_by_identifier(TEXT) TO authenticated;

-- STEP 4: อัปเดต trigger ให้ sync phone/username เข้า profiles เมื่อสร้าง user ใหม่
CREATE OR REPLACE FUNCTION public.fn_handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email     = EXCLUDED.email,
    username  = COALESCE(EXCLUDED.username, profiles.username),
    phone     = COALESCE(EXCLUDED.phone, profiles.phone);
  RETURN NEW;
END;
$$;

-- STEP 5: ตั้งค่า functions สำหรับ admin
CREATE OR REPLACE FUNCTION public.admin_update_user(
  p_user_id   UUID,
  p_full_name TEXT,
  p_username  TEXT,
  p_phone     TEXT,
  p_role      user_role,
  p_village   INT,
  p_active    BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

GRANT EXECUTE ON FUNCTION public.admin_update_user(UUID,TEXT,TEXT,TEXT,user_role,INT,BOOLEAN) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- หลังจาก run SQL แล้ว:
-- ให้ไปที่ Settings > Users ในแอป แล้วกรอก Username / เบอร์โทร
-- ให้ผู้ใช้แต่ละคน จากนั้นจะ login ด้วย username/phone ได้
-- ══════════════════════════════════════════════════════════════
