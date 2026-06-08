/*
  # Add payout timing and aging thresholds to commission schedules

  1. Modified Tables
    - `commission_schedules`
      - `payout_days_expected` (integer, NOT NULL, default 45) - Expected number of days after policy effective date before carrier pays out. Used to auto-resolve pending->paid status.
      - `aging_flag_days` (integer, NOT NULL, default 60) - Number of days a commission can sit in pending status before being flagged as aging/stale for follow-up with carrier.

  2. Important Notes
    - payout_days_expected: When generating commissions, if a policy effective date is older than this many days, the commission is auto-marked as "paid" instead of "pending"
    - aging_flag_days: Commissions still pending after this many days from policy effective date are flagged for the weekly scrum report
    - Defaults (45 and 60 days) reflect typical carrier payout cycles with a buffer before flagging
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'commission_schedules' AND column_name = 'payout_days_expected'
  ) THEN
    ALTER TABLE commission_schedules ADD COLUMN payout_days_expected integer NOT NULL DEFAULT 45;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'commission_schedules' AND column_name = 'aging_flag_days'
  ) THEN
    ALTER TABLE commission_schedules ADD COLUMN aging_flag_days integer NOT NULL DEFAULT 60;
  END IF;
END $$;
