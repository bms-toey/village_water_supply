-- ─── Row-Level Security (RLS) Policies ─────────────────────
-- รันใน Supabase SQL Editor ครั้งเดียว (idempotent — รันซ้ำได้)
-- วันที่: 2026-06-06
-- ──────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════
-- STEP 1: Drop ทุก Policy ก่อน (ต้องทำก่อน DROP FUNCTION
--         เพราะ Policy อาจ depend on auth_role())
-- ═══════════════════════════════════════════════════════════
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      r.policyname, r.tablename
    );
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════
-- STEP 2: Drop helper functions (ตอนนี้ไม่มี dependent แล้ว)
-- ═══════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.auth_role()       CASCADE;
DROP FUNCTION IF EXISTS public.auth_village_id() CASCADE;

-- ═══════════════════════════════════════════════════════════
-- STEP 3: Recreate helper functions
-- ═══════════════════════════════════════════════════════════
CREATE FUNCTION public.auth_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

CREATE FUNCTION public.auth_village_id()
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT village_id FROM public.profiles WHERE id = auth.uid()
$$;

-- ═══════════════════════════════════════════════════════════
-- STEP 4: Enable RLS บนทุก Table
-- ═══════════════════════════════════════════════════════════
ALTER TABLE public.profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.villages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meter_readings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bills             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_tiers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_jobs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.water_production  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.water_quality     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_data       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_config     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs        ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════
-- STEP 5: Profiles
-- ═══════════════════════════════════════════════════════════
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT USING (
    id = auth.uid()
    OR public.auth_role() = 'super_admin'
  );

CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE USING (
    id = auth.uid()
    OR public.auth_role() = 'super_admin'
  );

CREATE POLICY "profiles_insert" ON public.profiles
  FOR INSERT WITH CHECK (
    public.auth_role() = 'super_admin'
  );

-- ═══════════════════════════════════════════════════════════
-- STEP 6: Villages
-- ═══════════════════════════════════════════════════════════
CREATE POLICY "villages_select" ON public.villages
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "villages_write" ON public.villages
  FOR ALL USING (public.auth_role() = 'super_admin');

-- ═══════════════════════════════════════════════════════════
-- STEP 7: Members
-- ═══════════════════════════════════════════════════════════
CREATE POLICY "members_select" ON public.members
  FOR SELECT USING (
    public.auth_role() IN ('super_admin', 'finance')
    OR village_id = public.auth_village_id()
  );

CREATE POLICY "members_insert" ON public.members
  FOR INSERT WITH CHECK (
    public.auth_role() IN ('super_admin', 'village_admin')
    OR (public.auth_role() = 'meter_reader'
        AND village_id = public.auth_village_id())
  );

CREATE POLICY "members_update" ON public.members
  FOR UPDATE USING (
    public.auth_role() IN ('super_admin', 'village_admin')
    OR (public.auth_role() = 'meter_reader'
        AND village_id = public.auth_village_id())
  );

-- ═══════════════════════════════════════════════════════════
-- STEP 8: Meter Readings
-- ═══════════════════════════════════════════════════════════
CREATE POLICY "meter_readings_select" ON public.meter_readings
  FOR SELECT USING (
    public.auth_role() IN ('super_admin', 'finance')
    OR EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = meter_readings.member_id
        AND m.village_id = public.auth_village_id()
    )
  );

CREATE POLICY "meter_readings_write" ON public.meter_readings
  FOR ALL USING (
    public.auth_role() IN ('super_admin', 'village_admin', 'meter_reader')
  );

-- ═══════════════════════════════════════════════════════════
-- STEP 9: Bills
-- ═══════════════════════════════════════════════════════════
CREATE POLICY "bills_select" ON public.bills
  FOR SELECT USING (
    public.auth_role() IN ('super_admin', 'finance')
    OR EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = bills.member_id
        AND m.village_id = public.auth_village_id()
    )
  );

CREATE POLICY "bills_write" ON public.bills
  FOR ALL USING (
    public.auth_role() IN ('super_admin', 'village_admin', 'finance')
  );

-- ═══════════════════════════════════════════════════════════
-- STEP 10: Payments
-- ═══════════════════════════════════════════════════════════
CREATE POLICY "payments_select" ON public.payments
  FOR SELECT USING (
    public.auth_role() IN ('super_admin', 'finance')
    OR EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = payments.member_id
        AND m.village_id = public.auth_village_id()
    )
  );

CREATE POLICY "payments_write" ON public.payments
  FOR ALL USING (
    public.auth_role() IN ('super_admin', 'village_admin', 'finance')
  );

-- ═══════════════════════════════════════════════════════════
-- STEP 11: Rate Tiers, Maintenance, Water, Master Data, Config
-- ═══════════════════════════════════════════════════════════
CREATE POLICY "rate_tiers_select" ON public.rate_tiers
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "rate_tiers_write" ON public.rate_tiers
  FOR ALL USING (public.auth_role() = 'super_admin');

CREATE POLICY "maintenance_select" ON public.maintenance_jobs
  FOR SELECT USING (
    public.auth_role() IN ('super_admin', 'finance')
    OR village_id = public.auth_village_id()
    OR village_id IS NULL
  );

CREATE POLICY "maintenance_write" ON public.maintenance_jobs
  FOR ALL USING (
    public.auth_role() IN ('super_admin', 'village_admin', 'meter_reader')
  );

CREATE POLICY "water_prod_select" ON public.water_production
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "water_prod_write" ON public.water_production
  FOR ALL USING (public.auth_role() = 'super_admin');

CREATE POLICY "water_qual_select" ON public.water_quality
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "water_qual_write" ON public.water_quality
  FOR ALL USING (public.auth_role() = 'super_admin');

CREATE POLICY "master_data_select" ON public.master_data
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "master_data_write" ON public.master_data
  FOR ALL USING (
    public.auth_role() IN ('super_admin', 'village_admin')
  );

CREATE POLICY "system_config_select" ON public.system_config
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "system_config_write" ON public.system_config
  FOR ALL USING (public.auth_role() = 'super_admin');

CREATE POLICY "audit_logs_select" ON public.audit_logs
  FOR SELECT USING (
    public.auth_role() IN ('super_admin', 'finance')
  );

-- ═══════════════════════════════════════════════════════════
-- STEP 12: ตรวจสอบผลลัพธ์
-- ═══════════════════════════════════════════════════════════
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
