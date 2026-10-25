-- ══════════════════════════════════════════════════════════════
-- ตรวจการติดตั้ง (อ่านอย่างเดียว ไม่แก้ข้อมูล) — SQL Editor → รัน
-- ทุกแถวควรเป็น ✅ ถ้ามี ❌ ให้ดูคอลัมน์ detail
-- ══════════════════════════════════════════════════════════════
WITH checks(item, ok, detail) AS (
  SELECT 'JWT secret ใน Vault',
         EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'app_jwt_secret'), ''
  UNION ALL
  SELECT 'RLS เปิดทุกตาราง',
         NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity),
         COALESCE((SELECT string_agg(tablename, ', ') FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity), '')
  UNION ALL
  SELECT 'anon เรียกได้แค่ฟังก์ชัน login',
         (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname IN ('public', 'app_private') AND has_function_privilege('anon', p.oid, 'EXECUTE')
            AND p.proname NOT IN ('verify_login', 'member_login')) = 0,
         COALESCE((SELECT string_agg(p.proname, ', ') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname IN ('public', 'app_private') AND has_function_privilege('anon', p.oid, 'EXECUTE')
            AND p.proname NOT IN ('verify_login', 'member_login')), '')
  UNION ALL
  SELECT 'ตารางครบทุกเฟส',
         (SELECT count(*) FROM unnest(ARRAY['doc_counters','billing_periods','bill_adjustments','cash_closings',
            'notifications','member_access','notification_outbox','announcements','cashbook_entries','meter_skips']) t
          WHERE to_regclass('public.' || t) IS NULL) = 0,
         COALESCE((SELECT string_agg(t, ', ') FROM unnest(ARRAY['doc_counters','billing_periods','bill_adjustments','cash_closings',
            'notifications','member_access','notification_outbox','announcements','cashbook_entries','meter_skips']) t
          WHERE to_regclass('public.' || t) IS NULL), '')
  UNION ALL
  SELECT 'คอลัมน์เฟส 4 (มิเตอร์วนรอบ/เส้นทาง)',
         EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'meter_readings' AND column_name = 'rollover')
         AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'members' AND column_name = 'route_order'), ''
  UNION ALL
  SELECT 'รหัส portal ครบทุกสมาชิก',
         NOT EXISTS (SELECT 1 FROM public.members m WHERE NOT EXISTS (SELECT 1 FROM public.member_access a WHERE a.member_id = m.id)),
         (SELECT count(*) || ' รายไม่มีรหัส' FROM public.members m WHERE NOT EXISTS (SELECT 1 FROM public.member_access a WHERE a.member_id = m.id))
  UNION ALL
  SELECT 'Realtime: ตารางที่แอปใช้อยู่ใน publication',
         (SELECT count(*) FROM unnest(ARRAY['members','bills','payments','meter_readings','maintenance_jobs','water_production',
            'water_quality','villages','rate_tiers','master_data','billing_periods','bill_adjustments','notifications','meter_skips']) t
          WHERE NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = t)) = 0,
         COALESCE((SELECT string_agg(t, ', ') FROM unnest(ARRAY['members','bills','payments','meter_readings','maintenance_jobs','water_production',
            'water_quality','villages','rate_tiers','master_data','billing_periods','bill_adjustments','notifications','meter_skips']) t
          WHERE NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = t)), '')
  UNION ALL
  SELECT 'Storage buckets (สลิป/รูปมิเตอร์/สมาชิก/เอกสารการเงิน)',
         (SELECT count(*) FROM storage.buckets WHERE id IN ('payment-slips','meter-photos','member-uploads','finance-docs') AND NOT public) = 4,
         (SELECT string_agg(id || CASE WHEN public THEN ' (public!)' ELSE '' END, ', ') FROM storage.buckets)
  UNION ALL
  SELECT 'pg_cron คำนวณค่าปรับทุกคืน',
         to_regclass('cron.job') IS NOT NULL,
         'ถ้า ❌: Database → Extensions เปิด pg_cron แล้วรันส่วนท้ายของ sql_phase0_finance.sql (แอปยังคำนวณให้ตอนเปิดใช้งาน)'
  -- ── เฟส 5: ความปลอดภัย / PDPA ─────────────────────────────────
  UNION ALL
  SELECT 'เฟส 5: ฟังก์ชันจดมิเตอร์/audit/PDPA',
         (SELECT count(*) FROM unnest(ARRAY['save_meter_reading','log_event','verify_audit_chain','member_my_data',
            'member_privacy_request','anonymise_member','logout_session','staff_whoami']) f
          WHERE NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                            WHERE n.nspname = 'public' AND p.proname = f)) = 0,
         COALESCE((SELECT 'ขาด: ' || string_agg(f, ', ') FROM unnest(ARRAY['save_meter_reading','log_event','verify_audit_chain','member_my_data',
            'member_privacy_request','anonymise_member','logout_session','staff_whoami']) f
          WHERE NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                            WHERE n.nspname = 'public' AND p.proname = f)), '') || ' — รัน sql_phase5_security.sql'
  UNION ALL
  SELECT 'เฟส 5: trigger คุมสิทธิ์ตามหน้าที่ + audit แก้ไม่ได้',
         (SELECT count(*) FROM unnest(ARRAY['trg_payment_guard','trg_bills_role_guard','trg_members_role_guard',
            'trg_readings_guard','trg_audit_immutable']) t
          WHERE NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t AND NOT tgisinternal AND tgenabled <> 'D')) = 0,
         COALESCE((SELECT 'ขาด/ปิดอยู่: ' || string_agg(t, ', ') FROM unnest(ARRAY['trg_payment_guard','trg_bills_role_guard','trg_members_role_guard',
            'trg_readings_guard','trg_audit_immutable']) t
          WHERE NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t AND NOT tgisinternal AND tgenabled <> 'D')), '')
  UNION ALL
  SELECT 'เฟส 5: กุญแจเข้ารหัสข้อมูลส่วนบุคคลใน Vault (app_pii_key)',
         EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'app_pii_key'),
         'ห้ามลบ — ถ้าหาย เลขบัตรประชาชนที่เข้ารหัสไว้จะอ่านไม่ได้อีก'
  UNION ALL
  SELECT 'เฟส 5: เลขบัตรประชาชนไม่มีแบบข้อความธรรมดา',
         to_regclass('app_private.member_pii') IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.members WHERE national_id IS NOT NULL),
         CASE WHEN to_regclass('app_private.member_pii') IS NULL THEN 'ยังไม่มีตาราง app_private.member_pii'
              ELSE (SELECT count(*) || ' รายยังเป็นข้อความธรรมดา (อาจเป็นเลขซ้ำ — ดู NOTICE ตอนรันเฟส 5)'
                    FROM public.members WHERE national_id IS NOT NULL) END
  UNION ALL
  SELECT 'เฟส 5: แอปเขียน audit_logs ตรงไม่ได้ (ใช้ log_event)',
         NOT has_table_privilege('authenticated', 'public.audit_logs', 'INSERT')
         AND NOT has_table_privilege('authenticated', 'public.audit_logs', 'UPDATE')
         AND NOT has_table_privilege('authenticated', 'public.audit_logs', 'DELETE'), ''
  UNION ALL
  SELECT 'เฟส 5: client เรียก helper ออก token (app_private) ไม่ได้',
         (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'app_private' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
            AND p.proname NOT IN ('staff_role', 'jwt_profile_id', 'jwt_member_id', 'token_revoked')) = 0,
         COALESCE((SELECT string_agg(p.proname, ', ') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'app_private' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
            AND p.proname NOT IN ('staff_role', 'jwt_profile_id', 'jwt_member_id', 'token_revoked')), '')
          || ' — รันไฟล์เก่าซ้ำหรือเปล่า? ให้รัน sql_phase5_security.sql อีกครั้ง'
  UNION ALL
  SELECT 'เฟส 5: ไม่มี API key/secret ใน system_config',
         NOT EXISTS (SELECT 1 FROM public.system_config WHERE key ~* '(token|secret|api_key|password)'),
         COALESCE((SELECT string_agg(key, ', ') FROM public.system_config WHERE key ~* '(token|secret|api_key|password)'), '')
          || ' — ย้ายไปเก็บใน Edge Function secrets'
  UNION ALL
  SELECT 'เฟส 5: สมัครสมาชิกผ่าน Supabase Auth ไม่สร้างผู้ใช้',
         NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public' AND p.proname = 'fn_handle_new_user' AND p.prosrc ~* 'insert'),
         'ควรปิด Authentication → Allow new users to sign up ด้วย'
  UNION ALL
  SELECT 'เฟส 5: งานลบข้อมูลเกินระยะเวลาเก็บ (pg_cron aquaflow-retention)',
         CASE WHEN to_regclass('cron.job') IS NULL THEN false
              ELSE (xpath('/row/c/text()', query_to_xml(
                     'SELECT count(*) AS c FROM cron.job WHERE jobname = ''aquaflow-retention''', false, true, '')))[1]::TEXT::INT > 0 END,
         'คำเตือน: เปิด pg_cron แล้วรันส่วนท้าย (หัวข้อ 12) ของ sql_phase5_security.sql'
)
SELECT CASE WHEN ok THEN '✅' ELSE '❌' END AS status, item, CASE WHEN ok THEN '' ELSE detail END AS detail FROM checks;

-- ตรวจสาย hash ของ audit log: เรียก verify_audit_chain() จากแอปด้วยบัญชี admin
-- (ใน SQL Editor ไม่มี token จึงเรียกตรงไม่ได้)
-- งานตั้งเวลาที่มีอยู่ (ควรเห็น aquaflow-daily-billing และ aquaflow-retention):
-- SELECT jobname, schedule, active FROM cron.job;
