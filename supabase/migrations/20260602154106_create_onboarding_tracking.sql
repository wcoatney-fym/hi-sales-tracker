/*
  # Create onboarding tracking tables

  1. New Tables
    - `agent_onboarding`
      - `agent_id` (uuid, primary key, references agents)
      - `completed_at` (timestamptz, nullable - null means not yet completed)
      - `created_at` (timestamptz, default now)
    - `admin_onboarding`
      - `id` (uuid, primary key)
      - `admin_credential_id` (uuid, references admin_credentials)
      - `completed_at` (timestamptz, nullable)
      - `created_at` (timestamptz, default now)

  2. Security
    - Enable RLS on both tables
    - Policies for service role access (edge functions use service role)
*/

CREATE TABLE IF NOT EXISTS agent_onboarding (
  agent_id uuid PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  completed_at timestamptz DEFAULT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE agent_onboarding ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage agent onboarding"
  ON agent_onboarding
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS admin_onboarding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_credential_id uuid NOT NULL REFERENCES admin_credentials(id) ON DELETE CASCADE,
  completed_at timestamptz DEFAULT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT unique_admin_onboarding UNIQUE (admin_credential_id)
);

ALTER TABLE admin_onboarding ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage admin onboarding"
  ON admin_onboarding
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
