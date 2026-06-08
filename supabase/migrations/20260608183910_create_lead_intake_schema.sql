-- Lead vendors table (admin-configurable dropdown options)
CREATE TABLE lead_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE lead_vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_lead_vendors" ON lead_vendors FOR SELECT
  TO authenticated USING (true);
CREATE POLICY "insert_lead_vendors" ON lead_vendors FOR INSERT
  TO authenticated WITH CHECK (true);
CREATE POLICY "update_lead_vendors" ON lead_vendors FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_lead_vendors" ON lead_vendors FOR DELETE
  TO authenticated USING (true);

-- Lead submissions table
CREATE TABLE lead_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_first_name text NOT NULL,
  agent_last_name text NOT NULL,
  agent_number text NOT NULL,
  carrier text NOT NULL,
  client_first_name text NOT NULL,
  client_last_name text NOT NULL,
  phone text NOT NULL,
  lead_vendor text NOT NULL,
  agency text NOT NULL DEFAULT 'FYM',
  agency_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE lead_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_lead_submissions" ON lead_submissions FOR SELECT
  TO authenticated USING (true);
CREATE POLICY "insert_lead_submissions" ON lead_submissions FOR INSERT
  TO authenticated WITH CHECK (true);
CREATE POLICY "update_lead_submissions" ON lead_submissions FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_lead_submissions" ON lead_submissions FOR DELETE
  TO authenticated USING (true);

CREATE INDEX idx_lead_submissions_created_at ON lead_submissions (created_at DESC);
CREATE INDEX idx_lead_submissions_agent ON lead_submissions (agent_first_name, agent_last_name);

-- Seed the lead form toggle (disabled by default)
INSERT INTO admin_settings (key, value)
VALUES ('fym_lead_form_enabled', '{"enabled": false}')
ON CONFLICT (key) DO NOTHING;
