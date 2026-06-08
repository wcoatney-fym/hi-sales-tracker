/*
  # Add message field to leaderboard_promotions

  1. Modified Tables
    - `leaderboard_promotions`
      - Added `message` (text, nullable) - automation message for Zap integration, not displayed on leaderboard

  2. Notes
    - This field stores a message that will be sent via external automation (Zapier)
    - It is NOT displayed on agent-facing pages
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leaderboard_promotions' AND column_name = 'message'
  ) THEN
    ALTER TABLE leaderboard_promotions ADD COLUMN message text;
  END IF;
END $$;