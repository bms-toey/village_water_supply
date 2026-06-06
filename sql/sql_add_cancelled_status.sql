-- ─── Add 'cancelled' to payment_status enum ──────────────────────────────────
-- Run once in Supabase SQL Editor
-- ALTER TYPE ... ADD VALUE is safe and idempotent when wrapped in DO block
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'cancelled'
      AND enumtypid = 'payment_status'::regtype
  ) THEN
    ALTER TYPE payment_status ADD VALUE 'cancelled';
  END IF;
END $$;
