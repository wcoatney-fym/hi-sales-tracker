/*
  # Unify Promotions and Incentives into a Single Table

  1. Modified Tables
    - `leaderboard_promotions`
      - Add `period_type` (text) - daily, weekly, monthly, yearly
      - Add `goal_tokens` (integer) - raw token number required to earn the incentive
      - Add `sort_order` (integer) - display ordering within each period group

  2. Data Migration
    - Migrate existing `leaderboard_incentives` rows into `leaderboard_promotions`
    - Map period_type, title, prize_details->incentive, description->goal (legacy text)

  3. Dropped Tables
    - `leaderboard_incentives` - no longer needed after merge

  4. Security
    - Existing RLS policies on leaderboard_promotions remain intact
    - Multiple promotions can now be active simultaneously

  5. Notes
    - goal column retained for backward compatibility but goal_tokens is the canonical field
    - sort_order determines display position within a period group (1, 2, 3...)
*/

-- Add new columns to leaderboard_promotions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leaderboard_promotions' AND column_name = 'period_type'
  ) THEN
    ALTER TABLE leaderboard_promotions ADD COLUMN period_type text NOT NULL DEFAULT 'weekly'
      CHECK (period_type IN ('daily', 'weekly', 'monthly', 'yearly'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leaderboard_promotions' AND column_name = 'goal_tokens'
  ) THEN
    ALTER TABLE leaderboard_promotions ADD COLUMN goal_tokens integer NOT NULL DEFAULT 0;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leaderboard_promotions' AND column_name = 'sort_order'
  ) THEN
    ALTER TABLE leaderboard_promotions ADD COLUMN sort_order integer NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Migrate incentives data into promotions
INSERT INTO leaderboard_promotions (title, goal, incentive, start_date, end_date, is_active, period_type, goal_tokens, sort_order, created_at, updated_at)
SELECT
  title,
  description,
  prize_details,
  created_at,
  created_at + interval '1 year',
  is_active,
  period_type,
  0,
  ROW_NUMBER() OVER (PARTITION BY period_type ORDER BY created_at) as sort_order,
  created_at,
  updated_at
FROM leaderboard_incentives
WHERE NOT EXISTS (
  SELECT 1 FROM leaderboard_promotions lp WHERE lp.title = leaderboard_incentives.title AND lp.period_type = leaderboard_incentives.period_type
);

-- Drop the incentives table
DROP TABLE IF EXISTS leaderboard_incentives;

-- Update the public read policy to allow reading all active promotions (not just one)
DROP POLICY IF EXISTS "Anyone can read active promotions" ON leaderboard_promotions;
CREATE POLICY "Anyone can read active promotions"
  ON leaderboard_promotions
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true AND now() BETWEEN start_date AND end_date);
