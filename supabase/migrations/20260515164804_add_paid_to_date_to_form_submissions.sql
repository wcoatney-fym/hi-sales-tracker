/*
  # Add paid_to_date column to form_submissions

  1. Modified Tables
    - `form_submissions`
      - Added `paid_to_date` (date, nullable) - The date through which premiums have been paid for the policy

  2. Backfill
    - Populates paid_to_date from source_records.mapped_data->>'Paid To Date' by matching on policy_number
    - Source data is in YYYYMMDD format, converted to proper date type

  3. Important Notes
    - This column is used to determine "At Risk" policies (active status but paid_to_date in the past)
    - Only records with valid policy_number matches get backfilled
*/

-- Add the column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'form_submissions' AND column_name = 'paid_to_date'
  ) THEN
    ALTER TABLE form_submissions ADD COLUMN paid_to_date date;
  END IF;
END $$;

-- Backfill from source_records mapped_data
UPDATE form_submissions fs
SET paid_to_date = to_date(sr.ptd, 'YYYYMMDD')
FROM (
  SELECT DISTINCT ON (mapped_data->>'Policy Number')
    mapped_data->>'Policy Number' AS policy_number,
    mapped_data->>'Paid To Date' AS ptd
  FROM source_records
  WHERE mapped_data->>'Paid To Date' IS NOT NULL
    AND mapped_data->>'Paid To Date' != ''
    AND length(mapped_data->>'Paid To Date') = 8
  ORDER BY mapped_data->>'Policy Number', created_at DESC
) sr
WHERE fs.policy_number = sr.policy_number
  AND fs.policy_number IS NOT NULL
  AND fs.paid_to_date IS NULL;