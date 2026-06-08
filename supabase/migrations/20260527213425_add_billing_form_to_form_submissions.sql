/*
  # Add billing_form column to form_submissions

  1. Modified Tables
    - `form_submissions`
      - Added `billing_form` (text, nullable) - stores the billing form type (DIR, PAC, etc.)

  2. Backfill
    - Populates billing_form from source_records mapped_data->>'Billing Form'
    - Joins on source_upload_id and policy_number

  3. Indexes
    - Added index on billing_form for at-risk query performance

  4. Important Notes
    - At-risk logic will filter on billing_form = 'DIR' only
    - Policies with NULL or non-DIR billing_form are excluded from at-risk counts
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'form_submissions' AND column_name = 'billing_form'
  ) THEN
    ALTER TABLE form_submissions ADD COLUMN billing_form text;
  END IF;
END $$;

-- Backfill from source_records
UPDATE form_submissions fs
SET billing_form = sr.mapped_data->>'Billing Form'
FROM source_records sr
WHERE sr.source_upload_id = fs.source_upload_id
  AND sr.mapped_data->>'Policy Number' = fs.policy_number
  AND fs.billing_form IS NULL
  AND sr.mapped_data->>'Billing Form' IS NOT NULL;

-- Index for at-risk queries
CREATE INDEX IF NOT EXISTS idx_form_submissions_billing_form ON form_submissions(billing_form);
