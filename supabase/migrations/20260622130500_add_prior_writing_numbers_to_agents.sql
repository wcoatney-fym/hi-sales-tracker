/*
  # Add prior/alias writing numbers to agents

  Problem: When an agent's UNL writing number changes (carrier reassigns the
  number), the agent's `agents` row is updated to the NEW number, but all their
  historical `form_submissions` rows remain stamped with the OLD `agent_number`.
  The agent-portal RPCs only match on the current UNL/GTL number, so the agent
  loses attribution of their historical book in the portal.

  Fix:
  1. Add `prior_writing_numbers text[]` (default '{}') to `agents`. This records
     every legacy writing number that should still attribute to the agent.
  2. Backfill the known case: Elizabeth Price changed UNL 202JVVBB -> 202NQT00.

  Notes:
  - This migration only touches the `agents` metadata table.
  - It does NOT modify `form_submissions` (production data, read-only).
  - The matching logic that consumes this column is updated in the companion
    migration that CREATE OR REPLACEs the agent-portal RPC functions.
*/

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS prior_writing_numbers text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN agents.prior_writing_numbers IS
  'Legacy/alias writing numbers that should still attribute historical form_submissions (stamped with the old agent_number) to this agent. The agents.unl_writing_number / gtl_writing_number remain the current/displayed numbers.';

-- Backfill: Elizabeth Price (UNL writing number changed 202JVVBB -> 202NQT00)
UPDATE agents
SET prior_writing_numbers = ARRAY['202JVVBB'],
    updated_at = now()
WHERE unl_writing_number = '202NQT00'
  AND last_name = 'Price'
  AND NOT ('202JVVBB' = ANY(prior_writing_numbers));
