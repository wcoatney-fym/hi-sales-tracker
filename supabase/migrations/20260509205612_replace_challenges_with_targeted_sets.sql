/*
  # Replace challenges with targeted personal and agency challenges

  1. Changes
    - Deactivates all existing challenges
    - Inserts 5 personal (individual agent) challenges: daily, weekly, and monthly
    - Inserts 5 agency-wide (team) challenges: daily, weekly, and monthly
    - Challenges are designed to be attainable while pushing agents consistently

  2. Personal Challenges (type: daily/weekly/monthly)
    - "First Blood" (daily) - Submit 1 policy today - 25 XP
    - "Hat Trick" (daily) - Submit 3 policies in one day - 75 XP
    - "Weekly Warrior" (weekly) - Submit 7 policies this week - 150 XP
    - "Premium Pusher" (weekly) - Generate $2,000 in monthly premium this week - 175 XP
    - "Top 5 Finisher" (monthly) - Finish in the Top 5 for the month - 300 XP

  3. Agency Challenges (type: team)
    - "Team Surge" (team) - Agency submits 10 policies today - 50 XP
    - "Pack Hunters" (team) - Agency submits 50 policies this week - 100 XP
    - "Revenue Week" (team) - Agency generates $15,000 monthly premium this week - 125 XP
    - "Century Club" (team) - Agency hits 100 policies this month - 200 XP
    - "Premium Power" (team) - Agency generates $50,000 monthly premium this month - 250 XP

  4. Notes
    - Old challenges are deactivated (not deleted) to preserve any existing progress records
    - New challenges use current date ranges
    - All targets use monthly premium (not annualized)
*/

-- Deactivate existing challenges
UPDATE challenges SET is_active = false;

-- Insert 5 personal challenges
INSERT INTO challenges (type, title, description, target_value, reward_xp, reward_badge_slug, start_date, end_date, is_active)
VALUES
  -- Daily personal challenges
  ('daily', 'First Blood', 'Submit 1 policy today to keep your streak alive', 1, 25, NULL,
    CURRENT_DATE, CURRENT_DATE, true),
  ('daily', 'Hat Trick', 'Submit 3 policies in one day', 3, 75, NULL,
    CURRENT_DATE, CURRENT_DATE, true),
  -- Weekly personal challenges
  ('weekly', 'Weekly Warrior', 'Submit 7 policies this week', 7, 150, NULL,
    date_trunc('week', CURRENT_DATE)::date, (date_trunc('week', CURRENT_DATE) + interval '6 days')::date, true),
  ('weekly', 'Premium Pusher', 'Generate $2,000 in monthly premium this week', 2000, 175, NULL,
    date_trunc('week', CURRENT_DATE)::date, (date_trunc('week', CURRENT_DATE) + interval '6 days')::date, true),
  -- Monthly personal challenge
  ('monthly', 'Top 5 Finisher', 'Finish in the Top 5 for the month', 5, 300, NULL,
    date_trunc('month', CURRENT_DATE)::date, (date_trunc('month', CURRENT_DATE) + interval '1 month' - interval '1 day')::date, true);

-- Insert 5 agency (team) challenges
INSERT INTO challenges (type, title, description, target_value, reward_xp, reward_badge_slug, start_date, end_date, is_active)
VALUES
  -- Daily team challenge
  ('team', 'Team Surge', 'Agency collectively submits 10 policies today', 10, 50, NULL,
    CURRENT_DATE, CURRENT_DATE, true),
  -- Weekly team challenges
  ('team', 'Pack Hunters', 'Agency collectively submits 50 policies this week', 50, 100, NULL,
    date_trunc('week', CURRENT_DATE)::date, (date_trunc('week', CURRENT_DATE) + interval '6 days')::date, true),
  ('team', 'Revenue Week', 'Agency generates $15,000 in monthly premium this week', 15000, 125, NULL,
    date_trunc('week', CURRENT_DATE)::date, (date_trunc('week', CURRENT_DATE) + interval '6 days')::date, true),
  -- Monthly team challenges
  ('team', 'Century Club', 'Agency collectively hits 100 policies this month', 100, 200, NULL,
    date_trunc('month', CURRENT_DATE)::date, (date_trunc('month', CURRENT_DATE) + interval '1 month' - interval '1 day')::date, true),
  ('team', 'Premium Power', 'Agency generates $50,000 in total monthly premium this month', 50000, 250, NULL,
    date_trunc('month', CURRENT_DATE)::date, (date_trunc('month', CURRENT_DATE) + interval '1 month' - interval '1 day')::date, true);
