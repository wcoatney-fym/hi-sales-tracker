/*
  # Notifications (drives the agent login popup)

  When a manager nudges or flags a policy, the agent who owns it gets a
  notification. The agent portal queries unread on load and shows a popup.
  Managers get a notification (badge) when an agent replies.

  1. New table
    - `notifications`
      - recipient_kind: 'agent' | 'manager'
      - recipient_id: agents.id (agent) or agency_manager_credentials.id (manager)
      - type: 'nudge' | 'flag' | 'reply'
  2. Security
    - RLS enabled, service_role only (reads go through edge functions)
*/

CREATE TABLE IF NOT EXISTS notifications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_kind text NOT NULL CHECK (recipient_kind IN ('agent','manager')),
  recipient_id   uuid NOT NULL,
  agency_id      uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  policy_id      uuid REFERENCES form_submissions(id) ON DELETE CASCADE,
  activity_id    uuid REFERENCES at_risk_activities(id) ON DELETE CASCADE,
  type           text NOT NULL CHECK (type IN ('nudge','flag','reply')),
  body           text NOT NULL DEFAULT '',
  read_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread
  ON notifications(recipient_kind, recipient_id)
  WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_agency ON notifications(agency_id);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages notifications"
  ON notifications
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
