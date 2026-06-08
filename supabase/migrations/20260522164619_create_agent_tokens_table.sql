/*
  # Create Agent Tokens Table

  1. New Tables
    - `agent_tokens`
      - `id` (uuid, primary key)
      - `agent_id` (uuid, FK to agents)
      - `tokens_total` (integer) - computed total of all token sources
      - `tokens_talk_time` (integer) - tokens from talk time (1 per minute, manually entered)
      - `tokens_policies` (integer) - tokens from policies written (10 per policy)
      - `tokens_ap` (integer) - tokens from AP generated (5 per $1,000 AP)
      - `talk_time_minutes` (integer) - raw talk time minutes entered by admin
      - `period_start` (date) - start of current earning period (Jan 1 yearly reset)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `agent_tokens` table
    - Public read access for authenticated users (leaderboard visibility)
    - Service role has full access for backend computation
*/

CREATE TABLE IF NOT EXISTS agent_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  tokens_total integer NOT NULL DEFAULT 0,
  tokens_talk_time integer NOT NULL DEFAULT 0,
  tokens_policies integer NOT NULL DEFAULT 0,
  tokens_ap integer NOT NULL DEFAULT 0,
  talk_time_minutes integer NOT NULL DEFAULT 0,
  period_start date NOT NULL DEFAULT (date_trunc('year', now()))::date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_tokens_agent_id_unique UNIQUE (agent_id)
);

ALTER TABLE agent_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read agent tokens"
  ON agent_tokens
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role manages agent tokens"
  ON agent_tokens
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
