-- ─── Payments Cancel Fields Migration ─────────────────────────────────────
-- Adds cancelled_at, cancelled_by, cancel_reason to payments table
-- Run once in Supabase SQL Editor
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS cancelled_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by  TEXT,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

-- Update the 'cancelled' status check constraint if it exists
-- (no change needed — status TEXT already allows any value)

-- Index for faster cancelled payment lookups
CREATE INDEX IF NOT EXISTS idx_payments_cancelled_at ON payments (cancelled_at)
  WHERE cancelled_at IS NOT NULL;

COMMENT ON COLUMN payments.cancelled_at  IS 'Timestamp when this payment was cancelled';
COMMENT ON COLUMN payments.cancelled_by  IS 'User ID who performed the cancellation';
COMMENT ON COLUMN payments.cancel_reason IS 'Optional reason for cancellation';
