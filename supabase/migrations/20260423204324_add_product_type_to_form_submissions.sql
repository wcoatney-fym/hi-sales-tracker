/*
  # Add product_type to form_submissions

  1. Modified Tables
    - `form_submissions`
      - Added `product_type` (text, NOT NULL, default 'HI')
      - Accepts 'HI' (Hospital Indemnity) or 'HHC' (Home Health Care)
      - Default 'HI' preserves backward compatibility with existing records

  2. Notes
    - All existing rows will default to 'HI'
    - New intake form submissions will explicitly set this field
    - Book of Business imports that do not include product type will also default to 'HI'
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'form_submissions' AND column_name = 'product_type'
  ) THEN
    ALTER TABLE form_submissions ADD COLUMN product_type text NOT NULL DEFAULT 'HI';
  END IF;
END $$;
