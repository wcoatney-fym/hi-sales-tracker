/*
  # At-Risk pipeline v3 — disposition stages + agent-handoff lifecycle

  Extends `policy_dispositions` to support the v3 at-risk pipeline:
  data-driven entry, GHL keyword stages, agent handoff with a 5-day follow-up
  SLA, and a manager-approval gate on agent-claimed saves.

  Stage model is split:
    - COMPUTED at read time from age (today - paid_to_date): new / heating_up
      (>=30d) / code_red (>=38d). These are urgency overlays, not stored.
    - PERSISTED action-state (this table): the manager/agent verdict.

  Persisted disposition values:
    - responded           : client replied with the positive keyword (GHL)
    - manager_outreach    : client replied STOP, or manager actively working it
    - agent_outreach      : handed to the writing agent (stays on mgr board)
    - agent_saved_pending : agent marked saved; awaiting manager approval
    - saved               : manager-approved / confirmed save
    - lost                : manager-marked lost (true loss is the data-driven
                            termination that drops the policy out of the lane)

  New columns track the agent-handoff lifecycle + 5-day SLA, which also feed
  the per-agent "Agent Quality" follow-up metric (count handed off + % the
  agent contacted within 5 days).

  Additive + idempotent. `policy_dispositions` is currently empty, so the
  CHECK redefinition is safe; legacy values are kept valid for back-compat.
*/

ALTER TABLE policy_dispositions
  DROP CONSTRAINT IF EXISTS policy_dispositions_disposition_check;

ALTER TABLE policy_dispositions
  ADD CONSTRAINT policy_dispositions_disposition_check
  CHECK (disposition IN (
    'responded',
    'manager_outreach',
    'agent_outreach',
    'agent_saved_pending',
    'saved',
    'lost',
    -- legacy values, retained so old rows never violate the constraint
    'working',
    'secured',
    'follow_up'
  ));

ALTER TABLE policy_dispositions
  ADD COLUMN IF NOT EXISTS agent_id            uuid REFERENCES agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agent_outreach_at   timestamptz,
  ADD COLUMN IF NOT EXISTS agent_contacted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS agent_saved_at      timestamptz,
  ADD COLUMN IF NOT EXISTS manager_approved_at timestamptz;

-- Supports the per-agent Agent Quality rollup (handoffs + 5-day follow-up rate).
CREATE INDEX IF NOT EXISTS idx_policy_dispositions_agent
  ON policy_dispositions(agent_id)
  WHERE agent_id IS NOT NULL;
