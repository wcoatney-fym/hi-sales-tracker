/*
  # Create Agencies Table and Normalize Agency References

  1. New Tables
    - `agencies`
      - `id` (uuid, primary key)
      - `slug` (text, unique) - URL-friendly identifier
      - `name` (text) - display name
      - `is_active` (boolean, default true)
      - `created_at` (timestamptz)

  2. Seed Data
    - FYM (global/parent agency)
    - Wisechoice Senior Advisors Llc
    - Guardian Benefits Inc
    - Guide To Insure Llc
    - Highland Health Direct Llc

  3. Modified Tables
    - `agents` - add `agency_id` (uuid FK) column, backfill from text agency
    - `form_submissions` - add `agency_id` (uuid FK) column, backfill from text agency

  4. Security
    - Enable RLS on `agencies`
    - Anyone can read active agencies
    - Service role has full access (default)
*/

-- Create agencies table
CREATE TABLE IF NOT EXISTS agencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active agencies"
  ON agencies
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

-- Seed agencies
INSERT INTO agencies (slug, name) VALUES
  ('fym', 'FYM'),
  ('wisechoice', 'Wisechoice Senior Advisors Llc'),
  ('guardian', 'Guardian Benefits Inc'),
  ('guide-to-insure', 'Guide To Insure Llc'),
  ('highland', 'Highland Health Direct Llc')
ON CONFLICT (slug) DO NOTHING;

-- Add agency_id to agents table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agents' AND column_name = 'agency_id'
  ) THEN
    ALTER TABLE agents ADD COLUMN agency_id uuid REFERENCES agencies(id);
  END IF;
END $$;

-- Backfill agents.agency_id from text agency column
UPDATE agents
SET agency_id = a.id
FROM agencies a
WHERE agents.agency = a.name
  AND agents.agency_id IS NULL;

-- Add agency_id to form_submissions table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'form_submissions' AND column_name = 'agency_id'
  ) THEN
    ALTER TABLE form_submissions ADD COLUMN agency_id uuid REFERENCES agencies(id);
  END IF;
END $$;

-- Backfill form_submissions.agency_id from text agency column
UPDATE form_submissions
SET agency_id = a.id
FROM agencies a
WHERE form_submissions.agency = a.name
  AND form_submissions.agency_id IS NULL;

-- Create indexes for agency_id lookups
CREATE INDEX IF NOT EXISTS idx_agents_agency_id ON agents(agency_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_agency_id ON form_submissions(agency_id);
