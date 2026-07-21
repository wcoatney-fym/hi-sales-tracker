-- Drop lifecycle_policy_state — replaced by fired_triggers as the idempotency
-- ledger (migration 20260720150000_fired_triggers.sql).
--
-- Nothing reads or writes this table anymore as of PR #102 (trigger-queries
-- rewrite). The fired_triggers table now handles dedup via a
-- (policy_nbr, trigger_type, changed_on) unique constraint — no full-table
-- prior-state scan required.
--
-- Also drops the associated trigger function and index (cascade handles both).

DROP TABLE IF EXISTS public.lifecycle_policy_state CASCADE;
DROP FUNCTION IF EXISTS set_lifecycle_policy_state_updated_at() CASCADE;
-- COMMENT ON TABLE omitted: table no longer exists after DROP above
