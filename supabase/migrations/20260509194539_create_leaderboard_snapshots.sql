/*
  # Create leaderboard_snapshots table

  1. New Tables
    - `leaderboard_snapshots`
      - `id` (uuid, primary key)
      - `agent_id` (uuid, FK to agents)
      - `period_type` (text) - daily, weekly, or monthly
      - `period_key` (text) - e.g., "2026-05-09", "2026-W19", "2026-05"
      - `policies_count` (integer) - policies in this period
      - `commission_total` (numeric) - total commission this period
      - `rank` (integer) - rank position
      - `rank_change` (integer) - change from previous snapshot
      - `snapshot_date` (date)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS
    - Public read access for leaderboard display
    - Service role full access for computation

  3. Indexes
    - Composite index on (period_type, period_key, rank) for fast leaderboard queries
*/

CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  period_type text NOT NULL,
  period_key text NOT NULL,
  policies_count integer NOT NULL DEFAULT 0,
  commission_total numeric NOT NULL DEFAULT 0,
  rank integer NOT NULL DEFAULT 0,
  rank_change integer NOT NULL DEFAULT 0,
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT valid_period_type CHECK (period_type IN ('daily', 'weekly', 'monthly'))
);

CREATE INDEX IF NOT EXISTS idx_snapshots_period_rank
  ON leaderboard_snapshots (period_type, period_key, rank);

CREATE INDEX IF NOT EXISTS idx_snapshots_agent_period
  ON leaderboard_snapshots (agent_id, period_type, period_key);

ALTER TABLE leaderboard_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read leaderboard snapshots"
  ON leaderboard_snapshots
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Service role manages leaderboard snapshots"
  ON leaderboard_snapshots
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
