/*
  # Create upload history log table

  1. New Tables
    - `upload_history_log`
      - `id` (uuid, primary key)
      - `source_upload_id` (uuid, FK to source_uploads, nullable)
      - `source` (text -- "Data Source", "Intake Form", "Book of Business")
      - `action` (text -- "upload", "replace", "supersede")
      - `carrier` (text)
      - `filename` (text)
      - `records_inserted` (integer, default 0)
      - `records_replaced` (integer, default 0 -- previous data source records removed)
      - `records_superseded` (integer, default 0 -- Intake Form/BoB records marked superseded)
      - `replaced_data` (jsonb -- snapshot of the replaced Data Source records)
      - `superseded_data` (jsonb -- snapshot of the superseded form/BoB records)
      - `uploaded_by` (text)
      - `created_at` (timestamptz, default now())

  2. Security
    - Enable RLS on upload_history_log
    - Only service role can access (used by edge functions)

  3. Purpose
    - Tracks every data source upload operation with full audit trail
    - Stores snapshots of replaced and superseded records for reference
    - Provides the data for the Upload History UI in the admin panel
*/

CREATE TABLE IF NOT EXISTS upload_history_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_upload_id uuid REFERENCES source_uploads(id) ON DELETE SET NULL,
  source text NOT NULL,
  action text NOT NULL CHECK (action IN ('upload', 'replace', 'supersede')),
  carrier text,
  filename text,
  records_inserted integer DEFAULT 0,
  records_replaced integer DEFAULT 0,
  records_superseded integer DEFAULT 0,
  replaced_data jsonb,
  superseded_data jsonb,
  uploaded_by text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE upload_history_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to upload_history_log"
  ON upload_history_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_upload_history_log_source_upload
  ON upload_history_log (source_upload_id);

CREATE INDEX IF NOT EXISTS idx_upload_history_log_created_at
  ON upload_history_log (created_at DESC);
