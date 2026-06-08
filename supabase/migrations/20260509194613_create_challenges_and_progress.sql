/*
  # Create challenges and challenge_progress tables

  1. New Tables
    - `challenges`
      - `id` (uuid, primary key)
      - `type` (text) - daily, weekly, monthly, or team
      - `title` (text) - challenge name
      - `description` (text) - what to achieve
      - `target_value` (numeric) - goal number
      - `reward_xp` (integer) - XP reward on completion
      - `reward_badge_slug` (text, nullable) - badge awarded if any
      - `start_date` (date) - when challenge starts
      - `end_date` (date) - when challenge ends
      - `is_active` (boolean) - currently running
      - `created_at` (timestamptz)

    - `challenge_progress`
      - `id` (uuid, primary key)
      - `agent_id` (uuid, FK to agents)
      - `challenge_id` (uuid, FK to challenges)
      - `current_value` (numeric) - progress toward target
      - `completed` (boolean) - whether completed
      - `completed_at` (timestamptz, nullable)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
      - Unique constraint on (agent_id, challenge_id)

  2. Security
    - Enable RLS on both
    - Public read for challenges (visible on leaderboard)
    - Service role full access

  3. Seed Data
    - Sample active challenges
*/

CREATE TABLE IF NOT EXISTS challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL DEFAULT 'daily',
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  target_value numeric NOT NULL DEFAULT 1,
  reward_xp integer NOT NULL DEFAULT 50,
  reward_badge_slug text REFERENCES badges(slug) ON DELETE SET NULL,
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date NOT NULL DEFAULT CURRENT_DATE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT valid_challenge_type CHECK (type IN ('daily', 'weekly', 'monthly', 'team'))
);

ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read challenges"
  ON challenges
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Service role manages challenges"
  ON challenges
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS challenge_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  challenge_id uuid NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  current_value numeric NOT NULL DEFAULT 0,
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT unique_agent_challenge UNIQUE (agent_id, challenge_id)
);

ALTER TABLE challenge_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read challenge progress"
  ON challenge_progress
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Service role manages challenge progress"
  ON challenge_progress
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Seed active challenges
INSERT INTO challenges (type, title, description, target_value, reward_xp, start_date, end_date) VALUES
  ('daily', 'Triple Threat', 'Submit 3 policies today', 3, 50, CURRENT_DATE, CURRENT_DATE),
  ('weekly', 'Commission Grinder', 'Reach $10k in annualized commission this week', 10000, 150, date_trunc('week', CURRENT_DATE)::date, (date_trunc('week', CURRENT_DATE) + interval '6 days')::date),
  ('monthly', 'Top 5 Finish', 'Finish in the Top 5 this month', 5, 300, date_trunc('month', CURRENT_DATE)::date, (date_trunc('month', CURRENT_DATE) + interval '1 month' - interval '1 day')::date),
  ('team', 'Team Milestone', 'Team collectively hits 500 policies this month', 500, 200, date_trunc('month', CURRENT_DATE)::date, (date_trunc('month', CURRENT_DATE) + interval '1 month' - interval '1 day')::date);
