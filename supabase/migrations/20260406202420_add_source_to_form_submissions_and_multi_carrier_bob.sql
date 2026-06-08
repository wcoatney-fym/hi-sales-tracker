/*
  # Add source column to form_submissions and allow multi-carrier BoB uploads

  1. Modified Tables
    - `form_submissions`
      - `source` (text, default 'Intake Form') - Tracks origin of the policy record
        Values: 'Intake Form' (web form), 'Book of Business' (BoB CSV import)
    - `bob_uploads`
      - Updated carrier constraint to allow 'MULTI' for uploads containing both UNL and GTL rows

  2. Notes
    - Existing form_submissions rows default to 'Intake Form'
    - The source column enables filtering/reporting by how policies were added
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'form_submissions' AND column_name = 'source'
  ) THEN
    ALTER TABLE form_submissions ADD COLUMN source text NOT NULL DEFAULT 'Intake Form';
  END IF;
END $$;

ALTER TABLE bob_uploads DROP CONSTRAINT IF EXISTS bob_uploads_carrier_check;
ALTER TABLE bob_uploads ADD CONSTRAINT bob_uploads_carrier_check CHECK (carrier IN ('UNL', 'GTL', 'MULTI'));
