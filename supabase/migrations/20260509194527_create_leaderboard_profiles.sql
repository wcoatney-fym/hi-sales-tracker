/*
  # Create leaderboard_profiles table

  1. New Tables
    - `leaderboard_profiles`
      - `id` (uuid, primary key)
      - `agent_id` (uuid, FK to agents)
      - `xp` (integer, default 0) - total experience points
      - `level` (integer, default 1) - current level
      - `total_policies_all_time` (integer, default 0) - lifetime policy count
      - `current_streak` (integer, default 0) - consecutive active days
      - `longest_streak` (integer, default 0) - best streak ever
      - `tier` (text, default 'Rookie') - current tier name
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `leaderboard_profiles` table
    - Add policy for public read access (leaderboard is public)
    - Add policy for service role to manage data
*/

CREATE TABLE IF NOT EXISTS leaderboard_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  xp integer NOT NULL DEFAULT 0,
  level integer NOT NULL DEFAULT 1,
  total_policies_all_time integer NOT NULL DEFAULT 0,
  current_streak integer NOT NULL DEFAULT 0,
  longest_streak integer NOT NULL DEFAULT 0,
  tier text NOT NULL DEFAULT 'Rookie',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT unique_agent_profile UNIQUE (agent_id)
);

ALTER TABLE leaderboard_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read leaderboard profiles"
  ON leaderboard_profiles
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Service role manages leaderboard profiles"
  ON leaderboard_profiles
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
