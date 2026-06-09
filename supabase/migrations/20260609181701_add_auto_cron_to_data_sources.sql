/*
  # Add Auto-Cron Import Columns to data_sources

  1. New Columns
    - `default_carrier` (text, nullable) - carrier label for automated imports
    - `auto_cron_enabled` (boolean, default false) - whether automated cron is active
    - `auto_cron_confirmed_at` (timestamptz, nullable) - when admin confirmed mapping audit
    - `auto_cron_confirmed_by` (text, nullable) - which admin confirmed
    - `last_auto_pull_at` (timestamptz, nullable) - last successful automated pull
    - `auto_cron_mapping_snapshot` (jsonb, nullable) - snapshot of confirmed mappings

  2. Notes
    - auto_cron_enabled stays false until admin confirms mapping audit
    - mapping_snapshot used to detect drift and pause if mappings changed
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'data_sources' AND column_name = 'default_carrier'
  ) THEN
    ALTER TABLE data_sources ADD COLUMN default_carrier text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'data_sources' AND column_name = 'auto_cron_enabled'
  ) THEN
    ALTER TABLE data_sources ADD COLUMN auto_cron_enabled boolean DEFAULT false NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'data_sources' AND column_name = 'auto_cron_confirmed_at'
  ) THEN
    ALTER TABLE data_sources ADD COLUMN auto_cron_confirmed_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'data_sources' AND column_name = 'auto_cron_confirmed_by'
  ) THEN
    ALTER TABLE data_sources ADD COLUMN auto_cron_confirmed_by text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'data_sources' AND column_name = 'last_auto_pull_at'
  ) THEN
    ALTER TABLE data_sources ADD COLUMN last_auto_pull_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'data_sources' AND column_name = 'auto_cron_mapping_snapshot'
  ) THEN
    ALTER TABLE data_sources ADD COLUMN auto_cron_mapping_snapshot jsonb;
  END IF;
END $$;

-- Backfill FYL | UNL BoB source with default_carrier = 'UNL'
UPDATE data_sources
SET default_carrier = 'UNL'
WHERE type = 'sql_import' AND default_carrier IS NULL;