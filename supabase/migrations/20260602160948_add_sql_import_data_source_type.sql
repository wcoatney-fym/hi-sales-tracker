/*
  # Add SQL Import Data Source Type

  1. Schema Changes
    - Alter `data_sources.type` CHECK constraint to include 'sql_import'
    - Add new columns to `data_sources` for SQL connection configuration:
      - `db_host` (text, nullable) - External database host
      - `db_port` (integer, nullable) - External database port
      - `db_name` (text, nullable) - External database name
      - `db_schema` (text, nullable, default 'public') - Schema containing the target table
      - `db_table` (text, nullable) - Table to import from
      - `db_user` (text, nullable) - Database username
      - `db_password_secret_name` (text, nullable) - Name of env var holding the password

  2. Notes
    - Password is never stored directly; only the secret/env var name is stored
    - Existing data sources are unaffected
    - The sql_import type uses the same column_mappings and source_uploads flow as csv_upload
*/

-- Drop and recreate the CHECK constraint to include sql_import
ALTER TABLE data_sources DROP CONSTRAINT IF EXISTS data_sources_type_check;
ALTER TABLE data_sources ADD CONSTRAINT data_sources_type_check
  CHECK (type IN ('csv_upload', 'api_pull', 'api_push', 'sql_import'));

-- Add SQL connection columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'data_sources' AND column_name = 'db_host'
  ) THEN
    ALTER TABLE data_sources ADD COLUMN db_host text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'data_sources' AND column_name = 'db_port'
  ) THEN
    ALTER TABLE data_sources ADD COLUMN db_port integer;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'data_sources' AND column_name = 'db_name'
  ) THEN
    ALTER TABLE data_sources ADD COLUMN db_name text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'data_sources' AND column_name = 'db_schema'
  ) THEN
    ALTER TABLE data_sources ADD COLUMN db_schema text DEFAULT 'public';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'data_sources' AND column_name = 'db_table'
  ) THEN
    ALTER TABLE data_sources ADD COLUMN db_table text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'data_sources' AND column_name = 'db_user'
  ) THEN
    ALTER TABLE data_sources ADD COLUMN db_user text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'data_sources' AND column_name = 'db_password_secret_name'
  ) THEN
    ALTER TABLE data_sources ADD COLUMN db_password_secret_name text;
  END IF;
END $$;