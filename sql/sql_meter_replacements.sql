-- ─── Meter Replacements Table Migration ──────────────────────────────────────
-- Tracks history of physical meter swaps per member
-- Run once in Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS meter_replacements (
  id              SERIAL      PRIMARY KEY,
  member_id       INTEGER     NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  old_meter_no    TEXT        NOT NULL,
  new_meter_no    TEXT        NOT NULL,
  old_reading     NUMERIC(10,2) NOT NULL DEFAULT 0,
  new_reading     NUMERIC(10,2) NOT NULL DEFAULT 0,
  replaced_at     DATE        NOT NULL DEFAULT CURRENT_DATE,
  replaced_by     TEXT,
  reason          TEXT,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mr_member_id   ON meter_replacements (member_id);
CREATE INDEX IF NOT EXISTS idx_mr_replaced_at ON meter_replacements (replaced_at DESC);

COMMENT ON TABLE  meter_replacements          IS 'Log of physical water meter replacements per member';
COMMENT ON COLUMN meter_replacements.old_meter_no IS 'Serial number of old meter being removed';
COMMENT ON COLUMN meter_replacements.new_meter_no IS 'Serial number of new meter installed';
COMMENT ON COLUMN meter_replacements.old_reading  IS 'Final reading on old meter at time of swap';
COMMENT ON COLUMN meter_replacements.new_reading  IS 'Initial reading on new meter at time of installation';
COMMENT ON COLUMN meter_replacements.replaced_by  IS 'Staff user ID who performed the replacement';
COMMENT ON COLUMN meter_replacements.reason       IS 'Reason for replacement (e.g. ชำรุด, ครบอายุ, ขโมย)';

-- ─── Row-Level Security ───────────────────────────────────────────────────────
ALTER TABLE meter_replacements ENABLE ROW LEVEL SECURITY;

-- Only authenticated village staff can read
CREATE POLICY "meter_replacements_select" ON meter_replacements
  FOR SELECT TO authenticated USING (true);

-- Only village_admin and super_admin can insert/update/delete
CREATE POLICY "meter_replacements_insert" ON meter_replacements
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('super_admin', 'village_admin')
    )
  );

CREATE POLICY "meter_replacements_update" ON meter_replacements
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('super_admin', 'village_admin')
    )
  );

CREATE POLICY "meter_replacements_delete" ON meter_replacements
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'super_admin'
    )
  );
