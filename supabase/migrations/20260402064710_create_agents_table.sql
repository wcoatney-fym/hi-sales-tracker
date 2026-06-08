/*
  # Create agents table for Contracting Portal / Zapier integration

  1. New Tables
    - `agents`
      - `id` (uuid, primary key)
      - `first_name` (text, not null)
      - `last_name` (text, not null)
      - `npn` (text) - National Producer Number, unique when non-empty
      - `unl_writing_number` (text) - UNL carrier writing number
      - `gtl_writing_number` (text) - GTL carrier writing number
      - `source` (text, default 'Contracting Portal') - either "Roster" or "Contracting Portal"
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Indexes
    - Unique partial index on `npn` where npn is not empty
    - Index on `(lower(first_name), lower(last_name))` for name-based lookups

  3. Security
    - Enable RLS on `agents` table
    - Add SELECT policy for authenticated users (admin dashboard)
    - Add INSERT/UPDATE/DELETE policies for service role only (edge functions use service role key)
*/

CREATE TABLE IF NOT EXISTS agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  npn text DEFAULT '',
  unl_writing_number text DEFAULT '',
  gtl_writing_number text DEFAULT '',
  source text NOT NULL DEFAULT 'Contracting Portal',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_npn_unique
  ON agents (npn)
  WHERE npn IS NOT NULL AND npn != '';

CREATE INDEX IF NOT EXISTS idx_agents_name_lower
  ON agents (lower(first_name), lower(last_name));

CREATE INDEX IF NOT EXISTS idx_agents_unl_writing
  ON agents (unl_writing_number)
  WHERE unl_writing_number IS NOT NULL AND unl_writing_number != '';

CREATE INDEX IF NOT EXISTS idx_agents_gtl_writing
  ON agents (gtl_writing_number)
  WHERE gtl_writing_number IS NOT NULL AND gtl_writing_number != '';

ALTER TABLE agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view agents"
  ON agents FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role can insert agents"
  ON agents FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update agents"
  ON agents FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can delete agents"
  ON agents FOR DELETE
  TO service_role
  USING (true);
