/*
  # Add Billing Mode and Contract Code to Form Submissions

  1. New Columns
    - `form_submissions.billing_mode` (text) - Payment frequency: 0=Single, 1=Monthly, 3=Quarterly, 6=Semi-Annual, 12=Annual
    - `form_submissions.contract_code` (text) - Contract status: A=Active, T=Terminated, P=Pending, S=Suspended

  2. Backfill
    - Populates both columns from source_records.mapped_data for existing records matched by policy_number

  3. Notes
    - Both columns are nullable since intake-form submissions won't have this data
    - Backfill only updates rows where the column is currently NULL
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'form_submissions' AND column_name = 'billing_mode'
  ) THEN
    ALTER TABLE form_submissions ADD COLUMN billing_mode text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'form_submissions' AND column_name = 'contract_code'
  ) THEN
    ALTER TABLE form_submissions ADD COLUMN contract_code text;
  END IF;
END $$;

-- Backfill from source_records using policy_number match
UPDATE form_submissions fs
SET
  billing_mode = COALESCE(fs.billing_mode, sr.mapped_data->>'Billing Mode'),
  contract_code = COALESCE(fs.contract_code, sr.mapped_data->>'Contract Code')
FROM source_records sr
WHERE fs.policy_number IS NOT NULL
  AND fs.policy_number = sr.mapped_data->>'Policy Number'
  AND (fs.billing_mode IS NULL OR fs.contract_code IS NULL);
