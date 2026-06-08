/*
  # Add resync_progress to source_uploads

  1. Modified Tables
    - `source_uploads`
      - `resync_progress` (jsonb, nullable) - Tracks batched resync state: { offset, total, synced }

  2. Notes
    - Allows the UI to resume and display progress for large batched re-syncs
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'source_uploads' AND column_name = 'resync_progress'
  ) THEN
    ALTER TABLE source_uploads ADD COLUMN resync_progress jsonb;
  END IF;
END $$;
