/*
  # Add policy_number and agency columns to form_submissions

  1. Modified Tables
    - `form_submissions`
      - `policy_number` (text, nullable) - Unique policy identifier from carrier data, used for deduplication
      - `agency` (text, nullable) - The downline agency the writing agent belongs to

  2. Indexes
    - Partial unique index on policy_number (WHERE policy_number IS NOT NULL) to prevent duplicate policy records during re-syncs

  3. Notes
    - policy_number is nullable because intake form submissions and legacy records won't have one
    - agency is populated during Data Source sync from the agents table lookup
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'form_submissions' AND column_name = 'policy_number'
  ) THEN
    ALTER TABLE form_submissions ADD COLUMN policy_number text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'form_submissions' AND column_name = 'agency'
  ) THEN
    ALTER TABLE form_submissions ADD COLUMN agency text;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_form_submissions_policy_number_unique
  ON form_submissions (policy_number)
  WHERE policy_number IS NOT NULL;
