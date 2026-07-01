/*
  # Bidirectional GHL sync support on policy_dispositions

  The at-risk pipeline syncs both ways with a mirrored GHL pipeline:
    - outbound: a stage change here pushes the contact to the matching GHL stage
    - inbound : a manual move / keyword reply in GHL updates the stage here

  These columns make that safe:
    - sync_origin       : who set the current stage ('tracker' | 'ghl'). Loop
                          kill — a change that came from GHL is NOT pushed back
                          to GHL, and vice-versa.
    - ghl_contact_id    : the GHL contact/opportunity id for this policy, so we
                          can target the right opportunity on outbound pushes
                          and match inbound events.
    - ghl_synced_stage  : last stage we successfully pushed to GHL (idempotency
                          — skip the push when GHL already reflects it).
    - ghl_synced_at     : timestamp of the last successful outbound push.

  Additive + reversible: four nullable columns. No data rewrite.
*/

ALTER TABLE policy_dispositions
  ADD COLUMN IF NOT EXISTS sync_origin      text NOT NULL DEFAULT 'tracker',
  ADD COLUMN IF NOT EXISTS ghl_contact_id   text,
  ADD COLUMN IF NOT EXISTS ghl_synced_stage text,
  ADD COLUMN IF NOT EXISTS ghl_synced_at    timestamptz;

CREATE INDEX IF NOT EXISTS idx_policy_dispositions_ghl_contact
  ON policy_dispositions(ghl_contact_id)
  WHERE ghl_contact_id IS NOT NULL;
