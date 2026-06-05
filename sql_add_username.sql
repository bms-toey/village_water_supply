-- ══════════════════════════════════════════════════════
-- เพิ่ม username login — รันใน Supabase SQL Editor
-- ══════════════════════════════════════════════════════

-- 1. เพิ่ม column username ใน profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;

-- 2. Function: หา email จาก username (SECURITY DEFINER = bypass RLS)
CREATE OR REPLACE FUNCTION get_email_by_username(p_username TEXT)
RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT u.email
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id
  WHERE lower(trim(p.username)) = lower(trim(p_username))
  LIMIT 1;
$$;

-- 3. อัปเดต trigger สร้าง profile อัตโนมัติ ให้รับ username จาก metadata
CREATE OR REPLACE FUNCTION fn_handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role, username)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)),
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'meter_reader'),
    COALESCE(
      NEW.raw_user_meta_data->>'username',
      split_part(NEW.email,'@',1)    -- fallback: ใช้ส่วนแรกของ email
    )
  )
  ON CONFLICT (id) DO UPDATE
    SET username  = EXCLUDED.username,
        full_name = EXCLUDED.full_name;
  RETURN NEW;
END;
$$;

-- 4. ตัวอย่าง: อัปเดต username ให้ user ที่มีอยู่แล้ว
-- UPDATE profiles SET username = 'admin' WHERE id = '<uuid-ของ-user>';
