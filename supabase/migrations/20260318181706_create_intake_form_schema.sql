/*
  # Hospital Indemnity Business Intake Form Schema

  1. New Tables
    - `agent_rosters`
      - `id` (uuid, primary key) - Unique record identifier
      - `first_name` (text) - Agent's first name from CSV roster
      - `last_name` (text) - Agent's last name from CSV roster
      - `agent_number` (text) - Agent's unique identifier number
      - `carrier` (text) - Insurance carrier, constrained to 'UNL' or 'GTL'
      - `created_at` (timestamptz) - When the record was created

    - `form_submissions`
      - `id` (uuid, primary key) - Unique submission identifier
      - `agent_first_name` (text) - Submitting agent's first name
      - `agent_last_name` (text) - Submitting agent's last name
      - `carrier` (text) - Selected insurance carrier
      - `agent_number` (text) - Verified agent number
      - `client_first_name` (text) - Client's first name
      - `client_last_name` (text) - Client's last name
      - `phone` (text) - Client's phone number
      - `email` (text) - Client's email address
      - `address` (text) - Client's mailing address
      - `plan_name` (text) - Insurance plan name
      - `policy_effective_date` (date) - When the policy takes effect
      - `plan_premium` (numeric) - Monthly premium amount, defaults to 0
      - `status` (text) - Submission processing status, defaults to 'pending'
      - `created_at` (timestamptz) - When the submission was created

    - `admin_sessions`
      - `id` (uuid, primary key) - Unique session identifier
      - `email` (text) - Admin's email address
      - `token` (text, unique) - Session authentication token
      - `expires_at` (timestamptz) - When the session expires
      - `created_at` (timestamptz) - When the session was created

  2. Security
    - RLS enabled on all tables with no public access policies
    - All data access is handled through Edge Functions using the service role key
    - This ensures maximum security as no direct client access is possible

  3. Indexes
    - Composite functional index on agent_rosters for efficient case-insensitive agent verification
    - Composite index on admin_sessions for fast session validation
*/

CREATE TABLE IF NOT EXISTS agent_rosters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  agent_number text NOT NULL,
  carrier text NOT NULL CHECK (carrier IN ('UNL', 'GTL')),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS form_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_first_name text NOT NULL,
  agent_last_name text NOT NULL,
  carrier text NOT NULL,
  agent_number text NOT NULL,
  client_first_name text NOT NULL,
  client_last_name text NOT NULL,
  phone text NOT NULL,
  email text NOT NULL,
  address text NOT NULL,
  plan_name text NOT NULL,
  policy_effective_date date NOT NULL,
  plan_premium numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE agent_rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_sessions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_agent_rosters_lookup
  ON agent_rosters (lower(first_name), lower(last_name), carrier);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_token_expires
  ON admin_sessions (token, expires_at);