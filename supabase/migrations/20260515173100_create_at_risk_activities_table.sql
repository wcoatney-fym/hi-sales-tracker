/*
  # Create at_risk_activities table for follow-up tracking

  1. New Tables
    - `at_risk_activities`
      - `id` (uuid, primary key)
      - `policy_id` (uuid, FK to form_submissions)
      - `agent_id` (uuid, nullable, FK to agents - for agent-logged entries)
      - `admin_user` (text, nullable - for admin-logged entries)
      - `action_type` (text - called_client, called_carrier, payment_confirmed, lapse_notice_sent, other)
      - `note` (text, default '')
      - `created_at` (timestamptz)

  2. Indexes
    - Index on policy_id for fast lookups per policy
    - Index on agent_id for agent-scoped queries

  3. Security
    - Enable RLS on at_risk_activities
    - Service role handles access through edge functions
*/

CREATE TABLE IF NOT EXISTS at_risk_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  admin_user text,
  action_type text NOT NULL DEFAULT 'other',
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_at_risk_activities_policy_id ON at_risk_activities(policy_id);
CREATE INDEX IF NOT EXISTS idx_at_risk_activities_agent_id ON at_risk_activities(agent_id);

ALTER TABLE at_risk_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to at_risk_activities"
  ON at_risk_activities
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);