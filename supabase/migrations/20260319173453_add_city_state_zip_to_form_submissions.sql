/*
  # Add city, state, zip columns to form_submissions

  1. Modified Tables
    - `form_submissions`
      - `city` (text, default empty string) - Client's city
      - `state` (text, default empty string) - Client's state abbreviation
      - `zip` (text, default empty string) - Client's ZIP code

  2. Notes
    - Existing rows retain their current `address` value
    - New fields default to empty string for backwards compatibility
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'form_submissions' AND column_name = 'city'
  ) THEN
    ALTER TABLE form_submissions ADD COLUMN city text NOT NULL DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'form_submissions' AND column_name = 'state'
  ) THEN
    ALTER TABLE form_submissions ADD COLUMN state text NOT NULL DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'form_submissions' AND column_name = 'zip'
  ) THEN
    ALTER TABLE form_submissions ADD COLUMN zip text NOT NULL DEFAULT '';
  END IF;
END $$;