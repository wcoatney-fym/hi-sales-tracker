/*
  # Agency Roster Management System

  1. New Tables
    - `agency_rosters` - Stores per-agency roster entries linking writing numbers to agencies
      - `id` (uuid, primary key)
      - `agency_id` (uuid, FK to agencies)
      - `agent_first_name` (text) - Name from roster CSV
      - `agent_last_name` (text) - Name from roster CSV
      - `writing_number` (text) - The carrier writing number
      - `carrier` (text) - e.g. 'UNL', 'GTL'
      - `npn` (text) - National Producer Number
      - `status` (text) - 'active' or 'terminated'
      - `terminated_at` (timestamptz) - When terminated
      - `is_agency_manager` (boolean) - Whether this agent is a manager for the agency
      - `match_status` (text) - 'confirmed', 'fuzzy', 'unmatched'
      - `matched_agent_id` (uuid, FK to agents) - Linked agent record
      - `upload_id` (uuid, FK to agency_roster_uploads) - Which upload created this
      - `created_at`, `updated_at` (timestamptz)

    - `agency_roster_uploads` - Upload history for agency rosters
      - `id` (uuid, primary key)
      - `agency_id` (uuid, FK to agencies)
      - `uploaded_by_session_id` (uuid) - Admin session that performed upload
      - `filename` (text) - Original filename
      - `total_rows` (integer)
      - `matched_count` (integer)
      - `fuzzy_count` (integer)
      - `unmatched_count` (integer)
      - `created_at` (timestamptz)

    - `agent_writing_numbers` - Additional carrier writing numbers per agent per agency
      - `id` (uuid, primary key)
      - `agent_id` (uuid, FK to agents)
      - `agency_id` (uuid, FK to agencies)
      - `carrier_name` (text) - Carrier identifier
      - `writing_number` (text) - The writing number
      - `created_at` (timestamptz)

  2. Modified Tables
    - `agents` - Added status, terminated_at, is_agency_manager columns

  3. Security
    - RLS enabled on all new tables
    - Service role has full access
    - Authenticated users can read agency_rosters for their agency

  4. Important Notes
    - agency_rosters is the authoritative source for writing-number-to-agency mapping
    - When a roster exists, it takes priority over legacy agency assignment logic
    - Terminated agents retain historical data attribution
*/

-- Agency Roster Uploads table (must exist before agency_rosters references it)
CREATE TABLE IF NOT EXISTS agency_roster_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  uploaded_by_session_id uuid,
  filename text NOT NULL DEFAULT '',
  total_rows integer NOT NULL DEFAULT 0,
  matched_count integer NOT NULL DEFAULT 0,
  fuzzy_count integer NOT NULL DEFAULT 0,
  unmatched_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agency_roster_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to agency_roster_uploads"
  ON agency_roster_uploads
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated can read own agency roster uploads"
  ON agency_roster_uploads
  FOR SELECT
  TO authenticated
  USING (
    agency_id IN (
      SELECT agency_id FROM admin_sessions
      WHERE id = auth.uid()
    )
  );

-- Agency Rosters table
CREATE TABLE IF NOT EXISTS agency_rosters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  agent_first_name text NOT NULL,
  agent_last_name text NOT NULL,
  writing_number text NOT NULL,
  carrier text NOT NULL DEFAULT 'UNL',
  npn text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'terminated')),
  terminated_at timestamptz,
  is_agency_manager boolean NOT NULL DEFAULT false,
  match_status text NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('confirmed', 'fuzzy', 'unmatched')),
  matched_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  upload_id uuid REFERENCES agency_roster_uploads(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agency_rosters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to agency_rosters"
  ON agency_rosters
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated can read own agency rosters"
  ON agency_rosters
  FOR SELECT
  TO authenticated
  USING (
    agency_id IN (
      SELECT agency_id FROM admin_sessions
      WHERE id = auth.uid()
    )
  );

-- Indexes for agency_rosters
CREATE INDEX IF NOT EXISTS idx_agency_rosters_agency_id ON agency_rosters(agency_id);
CREATE INDEX IF NOT EXISTS idx_agency_rosters_writing_number ON agency_rosters(writing_number);
CREATE INDEX IF NOT EXISTS idx_agency_rosters_matched_agent ON agency_rosters(matched_agent_id);
CREATE INDEX IF NOT EXISTS idx_agency_rosters_status ON agency_rosters(agency_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agency_rosters_unique_writing_number
  ON agency_rosters(writing_number, carrier, agency_id) WHERE status = 'active';

-- Agent Writing Numbers table (additional carriers beyond primary UNL/GTL)
CREATE TABLE IF NOT EXISTS agent_writing_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  carrier_name text NOT NULL,
  writing_number text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agent_writing_numbers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to agent_writing_numbers"
  ON agent_writing_numbers
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated can read agent writing numbers"
  ON agent_writing_numbers
  FOR SELECT
  TO authenticated
  USING (
    agency_id IN (
      SELECT agency_id FROM admin_sessions
      WHERE id = auth.uid()
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_writing_numbers_unique
  ON agent_writing_numbers(writing_number, carrier_name);
CREATE INDEX IF NOT EXISTS idx_agent_writing_numbers_agent ON agent_writing_numbers(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_writing_numbers_agency ON agent_writing_numbers(agency_id);

-- Add status and manager columns to agents table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agents' AND column_name = 'status'
  ) THEN
    ALTER TABLE agents ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'terminated'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agents' AND column_name = 'terminated_at'
  ) THEN
    ALTER TABLE agents ADD COLUMN terminated_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agents' AND column_name = 'is_agency_manager'
  ) THEN
    ALTER TABLE agents ADD COLUMN is_agency_manager boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- Index for agent status filtering
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
