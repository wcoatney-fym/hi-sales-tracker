/*
  # Add roster upload versioning

  1. New Tables
    - `roster_uploads`
      - `id` (uuid, primary key) - Unique upload identifier
      - `carrier` (text) - Insurance carrier, constrained to 'UNL' or 'GTL'
      - `filename` (text) - Original uploaded filename
      - `agent_count` (integer) - Number of agents in this upload
      - `is_active` (boolean) - Whether this is the currently active roster for its carrier
      - `uploaded_by` (text) - Email of the admin who uploaded
      - `created_at` (timestamptz) - When the upload occurred

  2. Modified Tables
    - `agent_rosters`
      - `roster_upload_id` (uuid, nullable FK) - Links agent to a specific roster upload version

  3. Security
    - RLS enabled on `roster_uploads` with no public access policies
    - All access through Edge Functions using service role key

  4. Indexes
    - Index on `roster_uploads` for carrier + is_active lookups
    - Index on `agent_rosters` for roster_upload_id lookups

  5. Notes
    - Existing agent_rosters rows will have NULL roster_upload_id (legacy data)
    - The verify-agent flow will be updated to only check agents from the active roster upload
*/

CREATE TABLE IF NOT EXISTS roster_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier text NOT NULL CHECK (carrier IN ('UNL', 'GTL')),
  filename text NOT NULL DEFAULT '',
  agent_count integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT false,
  uploaded_by text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE roster_uploads ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_roster_uploads_carrier_active
  ON roster_uploads (carrier, is_active);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agent_rosters' AND column_name = 'roster_upload_id'
  ) THEN
    ALTER TABLE agent_rosters ADD COLUMN roster_upload_id uuid REFERENCES roster_uploads(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_rosters_upload_id
  ON agent_rosters (roster_upload_id);