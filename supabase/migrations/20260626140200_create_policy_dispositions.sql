/*
  # Policy dispositions (manager-only verdict)

  The manager owns the final verdict on an at-risk policy. Agents work the policy
  and report in the thread, but never set the disposition. Write gating to the
  manager role is enforced in the admin-api edge function.

  1. New table
    - `policy_dispositions` — one current disposition per policy
      - disposition: 'working' | 'secured' | 'lost' | 'follow_up'
      - `set_by` = manager credential id
  2. Security
    - RLS enabled, service_role only
*/

CREATE TABLE IF NOT EXISTS policy_dispositions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id     uuid NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  agency_id     uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  disposition   text NOT NULL CHECK (disposition IN ('working','secured','lost','follow_up')),
  note          text NOT NULL DEFAULT '',
  follow_up_at  date,
  set_by        uuid REFERENCES agency_manager_credentials(id) ON DELETE SET NULL,
  set_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT policy_dispositions_policy_unique UNIQUE (policy_id)
);

CREATE INDEX IF NOT EXISTS idx_policy_dispositions_agency ON policy_dispositions(agency_id);
CREATE INDEX IF NOT EXISTS idx_policy_dispositions_disposition ON policy_dispositions(agency_id, disposition);

ALTER TABLE policy_dispositions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages policy dispositions"
  ON policy_dispositions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
