-- ══════════════════════════════════════════════════════════════
-- FIX: แก้ users ที่สร้างผ่าน admin_create_user แล้ว login ไม่ได้
-- ("Database error querying schema")
--
-- รัน SQL นี้ใน Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════════════════

-- STEP 1: ดู users ที่ไม่มี identity record หรือ identity เสีย
SELECT
  u.id,
  u.email,
  u.email_confirmed_at,
  i.id   AS identity_id,
  i.provider
FROM auth.users u
LEFT JOIN auth.identities i ON i.user_id = u.id AND i.provider = 'email'
WHERE u.aud = 'authenticated'
ORDER BY u.created_at DESC;

-- ══════════════════════════════════════════════════════════════
-- STEP 2: ลบ identity record เก่าที่ id = user_id (broken)
--         แล้วสร้างใหม่แบบถูกต้อง (id auto-generate)
-- ══════════════════════════════════════════════════════════════

-- 2a: ลบ identity ที่ id เท่ากับ user_id (สร้างผิดวิธีจาก version เก่า)
DELETE FROM auth.identities
WHERE id = user_id
  AND provider = 'email';

-- 2b: สร้าง identity ใหม่ให้ users ที่ไม่มี (id จะ auto-generate ถูกต้อง)
INSERT INTO auth.identities (
  user_id,
  provider_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
SELECT
  u.id,
  u.email,
  jsonb_build_object('sub', u.id::text, 'email', u.email),
  'email',
  now(),
  now(),
  now()
FROM auth.users u
LEFT JOIN auth.identities i ON i.user_id = u.id AND i.provider = 'email'
WHERE u.email IS NOT NULL
  AND u.aud = 'authenticated'
  AND i.id IS NULL
ON CONFLICT (provider_id, provider) DO NOTHING;

-- STEP 3: ตรวจสอบ email_confirmed_at — ต้องไม่เป็น NULL
UPDATE auth.users
SET email_confirmed_at = created_at
WHERE email_confirmed_at IS NULL
  AND aud = 'authenticated';

-- STEP 4: Reload schema cache
NOTIFY pgrst, 'reload schema';

-- ══════════════════════════════════════════════════════════════
-- หลังรัน SQL นี้แล้ว:
-- ลอง login ด้วย email + password ของ user ที่สร้างผ่าน Admin อีกครั้ง
-- ถ้ายังไม่ได้ → ลองรีเซ็ตรหัสผ่านผ่าน Users page ใน Admin
-- ══════════════════════════════════════════════════════════════
