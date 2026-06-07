-- ══════════════════════════════════════════════════════════════
-- FIX: GRANT สำหรับ login ด้วย username/เบอร์โทร
-- รัน SQL นี้ใน Supabase Dashboard → SQL Editor
--
-- ปัญหา: get_email_by_identifier ใช้ตอน login ก่อน authenticate
--         แต่ไม่มี GRANT ให้ anon role → login ด้วย username/phone ไม่ได้
-- ══════════════════════════════════════════════════════════════

-- STEP 1: grant ให้ anon เรียก get_email_by_identifier ได้ (ใช้ตอน login)
GRANT EXECUTE ON FUNCTION public.get_email_by_identifier(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_email_by_identifier(TEXT) TO authenticated;

-- STEP 2: grant RPC อื่น ๆ ที่ admin ใช้ (authenticated เท่านั้น)
GRANT EXECUTE ON FUNCTION public.admin_create_user(TEXT,TEXT,TEXT,TEXT,TEXT,user_role,INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_all_users()                                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user(UUID,TEXT,TEXT,TEXT,user_role,INT,BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_password(UUID,TEXT)                       TO authenticated;

-- STEP 3: ตรวจสอบว่า email_confirmed_at ของ user ที่สร้างผ่าน admin_create_user
--         ถูก set แล้ว (ถ้าไม่ set จะ login ไม่ได้แม้รหัสผ่านถูก)
-- หาก user ไหน login ไม่ได้ให้รัน:
-- UPDATE auth.users SET email_confirmed_at = now() WHERE email_confirmed_at IS NULL;

-- ══════════════════════════════════════════════════════════════
-- วิธีใช้:
-- 1. ไปที่ Supabase Dashboard → SQL Editor
-- 2. วาง SQL นี้แล้วกด Run
-- 3. รีโหลดแอป แล้วลอง login ด้วย username/เบอร์โทรอีกครั้ง
-- ══════════════════════════════════════════════════════════════
