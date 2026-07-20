-- Migration: add policy_nbr to policy_dispositions (Option A — additive, non-breaking)
--
-- Adds a TEXT column policy_nbr to policy_dispositions so ghl-webhook can
-- be keyed on the natural policy number from Max's DB instead of requiring
-- a form_submissions UUID lookup.
--
-- Existing rows: policy_nbr will be NULL until backfilled (acceptable —
-- existing dispositions already have the UUID FK and are queryable by policy_id).
-- New rows written by the updated ghl-webhook will populate both policy_id
-- (from form_submissions lookup, kept for FK integrity) AND policy_nbr.
--
-- Long-term path: once policy_id UUID FK dependency is fully removed, policy_nbr
-- can become the primary key. That is a future breaking migration — not this one.

ALTER TABLE public.policy_dispositions
  ADD COLUMN IF NOT EXISTS policy_nbr TEXT;

-- Index for direct lookup by policy number (ghl-webhook lookup path)
CREATE INDEX IF NOT EXISTS idx_policy_dispositions_policy_nbr
  ON public.policy_dispositions (policy_nbr);

-- Backfill policy_nbr from form_submissions for existing rows
UPDATE public.policy_dispositions pd
SET policy_nbr = fs.policy_number
FROM public.form_submissions fs
WHERE pd.policy_id = fs.id
  AND pd.policy_nbr IS NULL;

COMMENT ON COLUMN public.policy_dispositions.policy_nbr IS
  'UNL policy number (natural key from Max DB). Parallel to policy_id UUID FK. '
  'Populated by ghl-webhook on new writes; backfilled from form_submissions on migration.';
