/*
  # Add app_submit_date to form_submissions

  1. Modified Tables
    - `form_submissions`
      - `app_submit_date` (date, nullable) - The application submit date from the BoB CSV,
        distinct from `created_at` (which serves as the upload date) and
        `policy_effective_date` (the policy effective date)

  2. Notes
    - This column captures the "Submit Date" value from uploaded Book of Business files
    - For intake form submissions this will remain null
    - `created_at` continues to represent when the record was uploaded/created in the system
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'form_submissions' AND column_name = 'app_submit_date'
  ) THEN
    ALTER TABLE form_submissions ADD COLUMN app_submit_date date;
  END IF;
END $$;
