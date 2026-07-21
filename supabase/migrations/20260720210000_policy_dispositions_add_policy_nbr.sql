-- Migration: add policy_nbr to policy_dispositions (Option A — additive, non-breaking)
--
-- Adds a TEXT column policy_nbr to policy_dispositions so ghl-webhook can
-- be keyed on the natural policy number from Max's DB instead of requiring
-- a form_submissions UUID lookup.
--
-- Existing rows: policy_nbr will be NULL (acceptable — existing dispositions
-- already have the UUID FK and are queryable by policy_id).
-- New rows written by the updated ghl-webhook will populate both policy_id
-- and policy_nbr.
--
-- Backfill from form_submissions intentionally OMITTED per standing rule:
-- GHL API logic never reads form_submissions. Existing rows remain NULL
-- until a future explicit backfill is run outside this migration.

ALTER TABLE public.policy_dispositions
  ADD COLUMN IF NOT EXISTS policy_nbr TEXT;

CREATE INDEX IF NOT EXISTS idx_policy_dispositions_policy_nbr
  ON public.policy_dispositions (policy_nbr);

COMMENT ON COLUMN public.policy_dispositions.policy_nbr IS
  'UNL policy number (natural key from Max DB). Parallel to policy_id UUID FK. '
  'Populated by ghl-webhook on new writes. Existing rows NULL — no form_submissions backfill.';
