/*
  # Two-way nudge thread on at_risk_activities

  Extends the existing at_risk_activities log into a manager<->agent conversation.

  1. New columns
    - `author_role`  ('manager' | 'agent') — who posted
    - `kind`         ('note' | 'nudge' | 'flag') — note default; 'flag' marks the
                     policy as needing attention and feeds the agent worklist + a
                     notification
    - `manager_id`   the posting manager (when author_role = 'manager')
  2. Notes
    - existing rows keep working: author_role nullable, kind defaults to 'note'
    - RLS unchanged (service_role only)
*/

ALTER TABLE at_risk_activities
  ADD COLUMN IF NOT EXISTS author_role text,
  ADD COLUMN IF NOT EXISTS kind        text NOT NULL DEFAULT 'note',
  ADD COLUMN IF NOT EXISTS manager_id  uuid REFERENCES agency_manager_credentials(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'at_risk_activities' AND constraint_name = 'at_risk_activities_author_role_check'
  ) THEN
    ALTER TABLE at_risk_activities
      ADD CONSTRAINT at_risk_activities_author_role_check
      CHECK (author_role IS NULL OR author_role IN ('manager','agent'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'at_risk_activities' AND constraint_name = 'at_risk_activities_kind_check'
  ) THEN
    ALTER TABLE at_risk_activities
      ADD CONSTRAINT at_risk_activities_kind_check
      CHECK (kind IN ('note','nudge','flag'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_at_risk_activities_kind ON at_risk_activities(kind);
CREATE INDEX IF NOT EXISTS idx_at_risk_activities_manager ON at_risk_activities(manager_id);
