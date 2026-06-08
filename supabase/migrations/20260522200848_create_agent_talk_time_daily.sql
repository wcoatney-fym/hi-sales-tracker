/*
  # Create Agent Talk Time Daily Log

  1. New Tables
    - `agent_talk_time_daily`
      - `id` (uuid, primary key)
      - `agent_id` (uuid, FK to agents)
      - `date` (date) - the workday this entry is for
      - `minutes` (integer) - talk time minutes logged for that day
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
      - Unique constraint on (agent_id, date) so each agent has one entry per day

  2. Security
    - Enable RLS on `agent_talk_time_daily`
    - Authenticated users can read (leaderboard visibility)
    - Service role has full access for backend writes

  3. Notes
    - This table enables computing a "talk time streak": consecutive workdays
      where an agent logged 240+ minutes (4 hours).
    - The existing `agent_tokens.talk_time_minutes` column remains as the
      cumulative total for the current period.
*/

CREATE TABLE IF NOT EXISTS agent_talk_time_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  date date NOT NULL,
  minutes integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_talk_time_daily_agent_date_unique UNIQUE (agent_id, date)
);

ALTER TABLE agent_talk_time_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read talk time daily"
  ON agent_talk_time_daily
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role manages talk time daily"
  ON agent_talk_time_daily
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_talk_time_daily_agent_date ON agent_talk_time_daily (agent_id, date DESC);
