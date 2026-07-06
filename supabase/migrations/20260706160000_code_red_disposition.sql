/*
  # Add `code_red` disposition (Code Red pipeline stage)

  Code Red is a new manager-pipeline stage positioned right before Pending, in
  both the At-Risk and Terminated lanes. The stage's ENTRY LOGIC lives in GHL
  (the day-35 timer + exemptions run there); GHL pushes the move into the
  tracker via the ghl-webhook, and a manager moving a card into Code Red in the
  tracker syncs back out to GHL. The tracker persists it as a disposition value
  so both directions of the mirror have a canonical stage to store.

  Additive + idempotent: this only widens the CHECK constraint to accept the new
  value. No data is modified; existing rows remain valid. Safe to re-run.
*/

ALTER TABLE policy_dispositions
  DROP CONSTRAINT IF EXISTS policy_dispositions_disposition_check;

ALTER TABLE policy_dispositions
  ADD CONSTRAINT policy_dispositions_disposition_check
  CHECK (disposition IN (
    'responded',
    'manager_outreach',
    'agent_outreach',
    'code_red',
    'agent_saved_pending',
    'saved',
    'lost',
    -- legacy values, retained so old rows never violate the constraint
    'working',
    'secured',
    'follow_up'
  ));
