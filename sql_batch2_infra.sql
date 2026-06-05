-- ══════════════════════════════════════════════════════
-- BATCH 2/3 — Indexes + Triggers + RLS (Sections 6–8)
-- รันหลัง batch 1 สำเร็จแล้วเท่านั้น
-- ══════════════════════════════════════════════════════

-- DROP indexes/triggers/functions/policies ที่อาจมีอยู่แล้ว
DROP FUNCTION IF EXISTS fn_set_updated_at()        CASCADE;
DROP FUNCTION IF EXISTS fn_handle_new_user()       CASCADE;
DROP FUNCTION IF EXISTS fn_sync_member_status()    CASCADE;
DROP FUNCTION IF EXISTS fn_auto_approve_cash()     CASCADE;
DROP FUNCTION IF EXISTS fn_payment_approved()      CASCADE;
DROP FUNCTION IF EXISTS fn_update_last_read()      CASCADE;
DROP FUNCTION IF EXISTS auth_role()                CASCADE;
DROP FUNCTION IF EXISTS auth_village()             CASCADE;

-- SECTION 6 — INDEXES
CREATE INDEX idx_members_village  ON members(village_id);
CREATE INDEX idx_members_status   ON members(status);
CREATE INDEX idx_members_meter_no ON members(meter_no);
CREATE INDEX idx_members_national ON members(national_id);
CREATE INDEX idx_members_name     ON members USING gin(
  to_tsvector('simple', first_name || ' ' || last_name)
);

CREATE INDEX idx_readings_member  ON meter_readings(member_id);
CREATE INDEX idx_readings_date    ON meter_readings(reading_date DESC);
CREATE INDEX idx_readings_bill    ON meter_readings(bill_id);
CREATE INDEX idx_readings_anomaly ON meter_readings(anomaly) WHERE anomaly IS NOT NULL;

CREATE INDEX idx_bills_member     ON bills(member_id);
CREATE INDEX idx_bills_period     ON bills(period_year DESC, period_month DESC);
CREATE INDEX idx_bills_status     ON bills(status);
CREATE INDEX idx_bills_due        ON bills(due_date) WHERE status IN ('pending','overdue');

CREATE INDEX idx_payments_bill    ON payments(bill_id);
CREATE INDEX idx_payments_member  ON payments(member_id);
CREATE INDEX idx_payments_status  ON payments(status);
CREATE INDEX idx_payments_paid_at ON payments(paid_at DESC);

CREATE INDEX idx_mnt_status       ON maintenance_jobs(status);
CREATE INDEX idx_mnt_village      ON maintenance_jobs(village_id);
CREATE INDEX idx_mnt_member       ON maintenance_jobs(member_id);


-- SECTION 7 — TRIGGERS & FUNCTIONS

-- auto-update updated_at
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_updated  BEFORE UPDATE ON profiles          FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_members_updated   BEFORE UPDATE ON members           FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_bills_updated     BEFORE UPDATE ON bills             FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_payments_updated  BEFORE UPDATE ON payments          FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_mnt_updated       BEFORE UPDATE ON maintenance_jobs  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- auto-create profile เมื่อ user signup
CREATE OR REPLACE FUNCTION fn_handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'meter_reader')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION fn_handle_new_user();

-- sync member.status จาก bills (แก้ bug: ใช้ TG_OP แทน COALESCE(NEW,OLD))
CREATE OR REPLACE FUNCTION fn_sync_member_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_member_id   BIGINT;
  v_has_overdue BOOLEAN;
BEGIN
  v_member_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.member_id ELSE NEW.member_id END;

  SELECT EXISTS (
    SELECT 1 FROM bills
    WHERE member_id = v_member_id AND status = 'overdue'
  ) INTO v_has_overdue;

  UPDATE members
  SET status = CASE
    WHEN v_has_overdue THEN 'overdue'::member_status
    ELSE 'normal'::member_status
  END
  WHERE id = v_member_id
    AND status NOT IN ('closed'::member_status, 'suspended'::member_status);

  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_bill_status_changed
  AFTER INSERT OR UPDATE OF status OR DELETE ON bills
  FOR EACH ROW EXECUTE FUNCTION fn_sync_member_status();

-- payment cash → approved ทันที
CREATE OR REPLACE FUNCTION fn_auto_approve_cash()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.channel = 'cash' AND NEW.status = 'pending' THEN
    NEW.status      := 'approved';
    NEW.approved_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cash_auto_approve
  BEFORE INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION fn_auto_approve_cash();

-- payment approved → bill = paid
CREATE OR REPLACE FUNCTION fn_payment_approved()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'approved' AND (OLD IS NULL OR OLD.status <> 'approved') THEN
    UPDATE bills SET status = 'paid'
    WHERE id = NEW.bill_id AND status <> 'cancelled';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payment_approved
  AFTER INSERT OR UPDATE OF status ON payments
  FOR EACH ROW EXECUTE FUNCTION fn_payment_approved();

-- update member.last_read เมื่ออ่านมิเตอร์ใหม่
CREATE OR REPLACE FUNCTION fn_update_last_read()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE members
  SET last_read      = NEW.curr_reading,
      last_read_date = NEW.reading_date,
      updated_at     = now()
  WHERE id = NEW.member_id
    AND (last_read_date IS NULL OR NEW.reading_date >= last_read_date);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_update_last_read
  AFTER INSERT ON meter_readings
  FOR EACH ROW EXECUTE FUNCTION fn_update_last_read();


-- SECTION 8 — ROW LEVEL SECURITY
ALTER TABLE villages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_tiers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE members           ENABLE ROW LEVEL SECURITY;
ALTER TABLE meter_readings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE bills             ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_production  ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_quality     ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_jobs  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION auth_role()
RETURNS user_role LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION auth_village()
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT village_id FROM profiles WHERE id = auth.uid()
$$;

CREATE POLICY "villages: all read"        ON villages FOR SELECT USING (true);
CREATE POLICY "villages: super write"     ON villages FOR ALL    USING (auth_role() = 'super_admin');

CREATE POLICY "profiles: own row"         ON profiles FOR SELECT USING (id = auth.uid() OR auth_role() IN ('super_admin','finance'));
CREATE POLICY "profiles: super manage"    ON profiles FOR ALL    USING (auth_role() = 'super_admin');

CREATE POLICY "rate_tiers: all read"      ON rate_tiers FOR SELECT USING (true);
CREATE POLICY "rate_tiers: super write"   ON rate_tiers FOR ALL    USING (auth_role() = 'super_admin');

CREATE POLICY "members: read by role"     ON members FOR SELECT USING (auth_role() IN ('super_admin','finance') OR village_id = auth_village());
CREATE POLICY "members: insert by admin"  ON members FOR INSERT WITH CHECK (auth_role() IN ('super_admin','village_admin'));
CREATE POLICY "members: update by admin"  ON members FOR UPDATE USING (auth_role() IN ('super_admin','village_admin') AND (auth_role() = 'super_admin' OR village_id = auth_village()));
CREATE POLICY "members: delete by super"  ON members FOR DELETE USING (auth_role() = 'super_admin');

CREATE POLICY "readings: read by role"    ON meter_readings FOR SELECT USING (auth_role() IN ('super_admin','finance') OR member_id IN (SELECT id FROM members WHERE village_id = auth_village()));
CREATE POLICY "readings: insert"          ON meter_readings FOR INSERT WITH CHECK (auth_role() IN ('super_admin','village_admin','meter_reader'));

CREATE POLICY "bills: read by role"       ON bills FOR SELECT USING (auth_role() IN ('super_admin','finance') OR member_id IN (SELECT id FROM members WHERE village_id = auth_village()));
CREATE POLICY "bills: manage by admin"    ON bills FOR ALL    USING (auth_role() IN ('super_admin','village_admin','finance'));

CREATE POLICY "payments: read by role"    ON payments FOR SELECT USING (auth_role() IN ('super_admin','finance') OR member_id IN (SELECT id FROM members WHERE village_id = auth_village()));
CREATE POLICY "payments: insert"          ON payments FOR INSERT WITH CHECK (auth_role() IN ('super_admin','village_admin','finance'));
CREATE POLICY "payments: approve"         ON payments FOR UPDATE USING (auth_role() IN ('super_admin','finance'));

CREATE POLICY "wp: read all"              ON water_production FOR SELECT USING (true);
CREATE POLICY "wp: admin write"           ON water_production FOR ALL    USING (auth_role() IN ('super_admin','village_admin'));

CREATE POLICY "wq: read all"              ON water_quality FOR SELECT USING (true);
CREATE POLICY "wq: admin write"           ON water_quality FOR ALL    USING (auth_role() IN ('super_admin','village_admin'));

CREATE POLICY "mnt: read by role"         ON maintenance_jobs FOR SELECT USING (auth_role() IN ('super_admin','finance') OR village_id = auth_village() OR village_id IS NULL);
CREATE POLICY "mnt: manage by admin"      ON maintenance_jobs FOR ALL    USING (auth_role() IN ('super_admin','village_admin'));
