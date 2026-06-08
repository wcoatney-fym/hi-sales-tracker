/*
  # Create badges and agent_badges tables

  1. New Tables
    - `badges`
      - `id` (uuid, primary key)
      - `slug` (text, unique) - machine identifier
      - `label` (text) - display name
      - `description` (text) - how to earn it
      - `icon_key` (text) - icon identifier for frontend
      - `category` (text) - grouping category
      - `requirement_description` (text) - human-readable unlock condition
      - `created_at` (timestamptz)

    - `agent_badges`
      - `id` (uuid, primary key)
      - `agent_id` (uuid, FK to agents)
      - `badge_slug` (text, FK to badges.slug)
      - `unlocked_at` (timestamptz)
      - Unique constraint on (agent_id, badge_slug)

  2. Security
    - Enable RLS on both tables
    - Public read for both (badges are displayed on public leaderboard)
    - Service role full access

  3. Seed Data
    - 12 achievement badges
*/

CREATE TABLE IF NOT EXISTS badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  label text NOT NULL,
  description text NOT NULL DEFAULT '',
  icon_key text NOT NULL DEFAULT 'award',
  category text NOT NULL DEFAULT 'achievement',
  requirement_description text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE badges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read badges"
  ON badges
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Service role manages badges"
  ON badges
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS agent_badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  badge_slug text NOT NULL REFERENCES badges(slug) ON DELETE CASCADE,
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_agent_badge UNIQUE (agent_id, badge_slug)
);

ALTER TABLE agent_badges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read agent badges"
  ON agent_badges
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Service role manages agent badges"
  ON agent_badges
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Seed badges
INSERT INTO badges (slug, label, description, icon_key, category, requirement_description) VALUES
  ('first-blood', 'First Blood', 'Submit your first policy', 'rocket', 'milestone', 'First policy submitted'),
  ('on-fire', 'On Fire', 'Maintain a 7-day submission streak', 'flame', 'streak', '7-day submission streak'),
  ('lightning-round', 'Lightning Round', 'Submit 5+ policies in a single day', 'zap', 'performance', '5+ policies in one day'),
  ('weekly-champion', 'Weekly Champion', 'Finish #1 on the weekly leaderboard', 'crown', 'competition', '#1 on weekly board'),
  ('monthly-dominator', 'Monthly Dominator', 'Finish #1 on the monthly leaderboard', 'trophy', 'competition', '#1 on monthly board'),
  ('high-roller', 'High Roller', 'Submit a single policy over $5k annual commission', 'gem', 'performance', 'Single policy over $5k commission'),
  ('sharpshooter', 'Sharpshooter', 'Hit your personal goal 4 weeks straight', 'target', 'consistency', 'Hit personal goal 4 weeks straight'),
  ('apex-predator', 'Apex Predator', 'Hold #1 position for 3+ consecutive days', 'shield', 'competition', 'Hold #1 for 3+ consecutive days'),
  ('rising-star', 'Rising Star', 'Biggest rank jump this week (+10 or more)', 'trending-up', 'competition', 'Biggest rank jump this week (+10+)'),
  ('comeback-kid', 'Comeback Kid', 'Return to top 10 after dropping out', 'refresh-cw', 'competition', 'Return to top 10 after dropping out'),
  ('team-player', 'Team Player', 'Contribute to team goal completion', 'users', 'team', 'Contributed to team goal completion'),
  ('centurion', 'Centurion', '100 policies in a single month', 'award', 'milestone', '100 policies in a single month')
ON CONFLICT (slug) DO NOTHING;
