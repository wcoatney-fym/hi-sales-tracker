/*
  # Add source upload versioning support

  1. Modified Tables
    - `source_uploads`
      - `is_active` (boolean, default false) - marks the current active upload per source+carrier
      - `overwritten_data` (jsonb, nullable) - stores snapshot of form_submissions rows overwritten during import
    - `form_submissions`
      - `source_upload_id` (uuid, nullable, FK to source_uploads.id) - tracks which upload created this row

  2. Backfill
    - Marks the most recent complete upload per data_source_id+carrier as active

  3. Important Notes
    - Enables revert functionality by tracking which upload owns which form_submissions rows
    - overwritten_data stores the previous values of rows that were upserted over
*/

-- Add is_active and overwritten_data to source_uploads
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'source_uploads' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE source_uploads ADD COLUMN is_active boolean DEFAULT false NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'source_uploads' AND column_name = 'overwritten_data'
  ) THEN
    ALTER TABLE source_uploads ADD COLUMN overwritten_data jsonb;
  END IF;
END $$;

-- Add source_upload_id to form_submissions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'form_submissions' AND column_name = 'source_upload_id'
  ) THEN
    ALTER TABLE form_submissions ADD COLUMN source_upload_id uuid REFERENCES source_uploads(id);
  END IF;
END $$;

-- Index for efficient lookups by source_upload_id
CREATE INDEX IF NOT EXISTS idx_form_submissions_source_upload_id
  ON form_submissions(source_upload_id) WHERE source_upload_id IS NOT NULL;

-- Index for is_active lookups
CREATE INDEX IF NOT EXISTS idx_source_uploads_active
  ON source_uploads(data_source_id, carrier, is_active) WHERE is_active = true;

-- Backfill: mark the most recent complete upload per data_source_id+carrier as active
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY data_source_id, carrier ORDER BY created_at DESC) as rn
  FROM source_uploads
  WHERE status = 'complete'
)
UPDATE source_uploads
SET is_active = true
WHERE id IN (SELECT id FROM ranked WHERE rn = 1);
