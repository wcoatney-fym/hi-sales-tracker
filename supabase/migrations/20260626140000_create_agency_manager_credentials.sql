/*
  # Agency Manager credentials (per-person login)

  Adds the per-person Agency Manager identity that the Agency Manager view runs on.
  The existing shared agency *admin* login (admin_credentials) is intentionally
  left untouched — only managers are per-person.

  1. New table
    - `agency_manager_credentials`
      - one row per manager, exclusive to a single agency
      - `username` follows the admin-login format; `password` unique per manager
      - `agent_id` set when the manager was promoted from the roster (null for
        added non-agents)
  2. Sessions
    - reuse `admin_sessions` with role = 'manager'
  3. Security
    - RLS enabled, service_role only (access flows through edge functions),
      consistent with admin_credentials
*/

CREATE TABLE IF NOT EXISTS agency_manager_credentials (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id     uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  username      text NOT NULL,
  password      text NOT NULL,
  agent_id      uuid REFERENCES agents(id) ON DELETE SET NULL,
  display_name  text,
  is_active     boolean NOT NULL DEFAULT true,
  added_by      text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agency_manager_credentials_username_unique UNIQUE (username),
  CONSTRAINT agency_manager_credentials_agency_agent_unique UNIQUE (agency_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_agency_mgr_creds_agency ON agency_manager_credentials(agency_id);
CREATE INDEX IF NOT EXISTS idx_agency_mgr_creds_agent  ON agency_manager_credentials(agent_id);

ALTER TABLE agency_manager_credentials ENABLE ROW LEVEL SECURITY;

-- No public policy: service_role only (edge functions), matching admin_credentials.
CREATE POLICY "Service role manages agency manager credentials"
  ON agency_manager_credentials
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
