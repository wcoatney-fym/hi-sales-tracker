/*
  # Create Admin Credentials Table and Update Admin Sessions

  1. New Tables
    - `admin_credentials`
      - `id` (uuid, primary key)
      - `agency_id` (uuid FK, nullable - null means global admin)
      - `email_domain` (text) - e.g. "@teamfym.com"
      - `password` (text) - plaintext for now (matches existing pattern)
      - `role` (text) - "global_admin" or "agency_admin"
      - `session_duration_days` (integer, default 90)
      - `created_at` (timestamptz)

  2. Modified Tables
    - `admin_sessions` - add `role` and `agency_id` columns for role-based access

  3. Seed Data
    - FYM global admin: @teamfym.com / ContractingFYM! / global_admin

  4. Security
    - Enable RLS on `admin_credentials` (no public access)
    - Only service role can read credentials
*/

-- Create admin_credentials table
CREATE TABLE IF NOT EXISTS admin_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid REFERENCES agencies(id),
  email_domain text NOT NULL,
  password text NOT NULL,
  role text NOT NULL DEFAULT 'agency_admin' CHECK (role IN ('global_admin', 'agency_admin')),
  session_duration_days integer NOT NULL DEFAULT 90,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE admin_credentials ENABLE ROW LEVEL SECURITY;

-- No public access policy - only service role can read
-- (RLS is restrictive by default with no policies = locked down)

-- Seed FYM global admin credentials
INSERT INTO admin_credentials (agency_id, email_domain, password, role, session_duration_days)
VALUES (NULL, '@teamfym.com', 'ContractingFYM!', 'global_admin', 90)
ON CONFLICT DO NOTHING;

-- Add role and agency_id to admin_sessions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'admin_sessions' AND column_name = 'role'
  ) THEN
    ALTER TABLE admin_sessions ADD COLUMN role text NOT NULL DEFAULT 'global_admin';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'admin_sessions' AND column_name = 'agency_id'
  ) THEN
    ALTER TABLE admin_sessions ADD COLUMN agency_id uuid REFERENCES agencies(id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'admin_sessions' AND column_name = 'agency_slug'
  ) THEN
    ALTER TABLE admin_sessions ADD COLUMN agency_slug text;
  END IF;
END $$;
