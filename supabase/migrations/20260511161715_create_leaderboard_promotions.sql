/*
  # Create Leaderboard Promotions Table

  1. New Tables
    - `leaderboard_promotions`
      - `id` (uuid, primary key)
      - `title` (text, promotion name)
      - `goal` (text, description of what agents need to achieve)
      - `incentive` (text, description of the reward)
      - `start_date` (timestamptz, when the promotion begins)
      - `end_date` (timestamptz, when the promotion ends)
      - `is_active` (boolean, whether the promotion is currently active)
      - `created_at` (timestamptz, when the record was created)
      - `updated_at` (timestamptz, when the record was last updated)

  2. Security
    - Enable RLS on `leaderboard_promotions` table
    - Add policy for service role to manage all promotions
    - Add policy for anonymous/authenticated users to read active promotions

  3. Notes
    - Only one promotion should be active at a time (enforced at application level)
    - Promotions are displayed on leaderboard and agent profile pages only when active
*/

CREATE TABLE IF NOT EXISTS leaderboard_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  goal text NOT NULL,
  incentive text NOT NULL,
  start_date timestamptz NOT NULL,
  end_date timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE leaderboard_promotions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage promotions"
  ON leaderboard_promotions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can read active promotions"
  ON leaderboard_promotions
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true AND now() BETWEEN start_date AND end_date);