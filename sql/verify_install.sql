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
)
SELECT CASE WHEN ok THEN '✅' ELSE '❌' END AS status, item, CASE WHEN ok THEN '' ELSE detail END AS detail FROM checks;

-- งานตั้งเวลาที่มีอยู่ (ควรเห็น aquaflow-daily-billing):
-- SELECT jobname, schedule, active FROM cron.job;
