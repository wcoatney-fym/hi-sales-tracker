/*
  # Create Leaderboard Incentives Table

  1. New Tables
    - `leaderboard_incentives`
      - `id` (uuid, primary key)
      - `period_type` (text) - weekly, monthly, or yearly
      - `title` (text) - incentive title
      - `description` (text) - detailed description
      - `prize_details` (text) - what the winner gets
      - `is_active` (boolean) - whether currently displayed
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `leaderboard_incentives` table
    - Public read for all (displayed on leaderboard)
    - Service role has full access for admin CRUD
*/

CREATE TABLE IF NOT EXISTS leaderboard_incentives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_type text NOT NULL CHECK (period_type IN ('weekly', 'monthly', 'yearly')),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  prize_details text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE leaderboard_incentives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active incentives"
  ON leaderboard_incentives
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

CREATE POLICY "Service role manages incentives"
  ON leaderboard_incentives
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
