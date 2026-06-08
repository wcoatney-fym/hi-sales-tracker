/*
  # Create Data Sources Schema

  1. New Tables
    - `data_sources`
      - `id` (uuid, primary key) - Unique source identifier
      - `name` (text) - Human-readable source name (e.g., "FYM Policy Export")
      - `type` (text) - Source type: csv_upload, api_pull, api_push
      - `description` (text) - Optional description
      - `api_url` (text, nullable) - For future API feed integration
      - `api_key_secret_name` (text, nullable) - Secret name for API auth
      - `poll_interval` (interval, nullable) - How often to poll API
      - `last_polled_at` (timestamptz, nullable) - Last API poll timestamp
      - `created_at` (timestamptz) - When source was configured

    - `column_mappings`
      - `id` (uuid, primary key) - Unique mapping identifier
      - `data_source_id` (uuid, FK) - Reference to parent data source
      - `source_column` (text) - Column name from the source file/API
      - `target_field` (text) - Standardized target field name
      - `created_at` (timestamptz) - When mapping was created

    - `source_uploads`
      - `id` (uuid, primary key) - Unique upload identifier
      - `data_source_id` (uuid, FK) - Reference to parent data source
      - `carrier` (text) - Carrier selected at upload time
      - `filename` (text) - Original filename
      - `row_count` (integer) - Number of rows in upload
      - `status` (text) - processing, complete, error
      - `uploaded_by` (text) - Admin email
      - `created_at` (timestamptz) - When upload occurred

    - `source_records`
      - `id` (uuid, primary key) - Unique record identifier
      - `source_upload_id` (uuid, FK) - Reference to parent upload
      - `raw_data` (jsonb) - Full original row preserved
      - `mapped_data` (jsonb) - Transformed data with standardized fields
      - `processing_status` (text) - pending, imported, skipped, error
      - `error_reason` (text, nullable) - Why a record was skipped/errored
      - `created_at` (timestamptz) - When record was created

  2. Security
    - RLS enabled on all tables
    - No public access -- all access through Edge Functions with service role

  3. Indexes
    - data_sources: type for filtering
    - column_mappings: data_source_id for lookups
    - source_uploads: data_source_id + created_at for history
    - source_records: source_upload_id for batch lookups
    - source_records: processing_status for filtering
*/

CREATE TABLE IF NOT EXISTS data_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL DEFAULT 'csv_upload' CHECK (type IN ('csv_upload', 'api_pull', 'api_push')),
  description text NOT NULL DEFAULT '',
  api_url text,
  api_key_secret_name text,
  poll_interval interval,
  last_polled_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE data_sources ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_data_sources_type ON data_sources (type);

CREATE TABLE IF NOT EXISTS column_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_source_id uuid NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  source_column text NOT NULL,
  target_field text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (data_source_id, source_column)
);

ALTER TABLE column_mappings ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_column_mappings_source ON column_mappings (data_source_id);

CREATE TABLE IF NOT EXISTS source_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_source_id uuid NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  carrier text NOT NULL DEFAULT '',
  filename text NOT NULL DEFAULT '',
  row_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'complete', 'error')),
  uploaded_by text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE source_uploads ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_source_uploads_source_created ON source_uploads (data_source_id, created_at DESC);

CREATE TABLE IF NOT EXISTS source_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_upload_id uuid NOT NULL REFERENCES source_uploads(id) ON DELETE CASCADE,
  raw_data jsonb NOT NULL DEFAULT '{}',
  mapped_data jsonb NOT NULL DEFAULT '{}',
  processing_status text NOT NULL DEFAULT 'pending' CHECK (processing_status IN ('pending', 'imported', 'skipped', 'error')),
  error_reason text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE source_records ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_source_records_upload ON source_records (source_upload_id);
CREATE INDEX IF NOT EXISTS idx_source_records_status ON source_records (processing_status);
