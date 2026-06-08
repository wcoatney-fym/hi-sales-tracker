/*
  # Add duplicate tracking to form_submissions

  1. Changes
    - Adds `duplicate_flag` boolean column (default false) to mark records that are duplicates
    - Records with status 'duplicate' or 'superseded' will be kept but excluded from dashboard metrics
    - 'superseded' = Intake Form/BoB record replaced by authoritative Data Source record
    - 'duplicate' = same client/agent/zip with effective dates within 14 days

  2. Important Notes
    - No data is deleted; flagged records are soft-excluded from counts
    - The duplicate_flag column allows quick filtering in queries
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'form_submissions' AND column_name = 'duplicate_flag'
  ) THEN
    ALTER TABLE form_submissions ADD COLUMN duplicate_flag boolean DEFAULT false;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_form_submissions_duplicate_flag
  ON form_submissions (duplicate_flag) WHERE duplicate_flag = true;

CREATE INDEX IF NOT EXISTS idx_form_submissions_status_exclusion
  ON form_submissions (status) WHERE status IN ('duplicate', 'superseded');
