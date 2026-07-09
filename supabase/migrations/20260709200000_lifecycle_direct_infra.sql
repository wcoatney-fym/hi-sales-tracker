-- lifecycle-direct infrastructure (2026-07-09)
--
-- 1. Rename agencies.zaps_enabled -> ghl_api_enabled (Zap path removed; this
--    now controls the direct GHL API push exclusively).
-- 2. Create lifecycle_policy_state — lightweight diff-baseline for the
--    lifecycle-direct edge function. One row per tracked policy; updated each
--    run. Replaces form_submissions as the state store now that the import
--    pipeline is retired.

-- ── 1. Rename column ──────────────────────────────────────────────────────────
ALTER TABLE agencies
  RENAME COLUMN zaps_enabled TO ghl_api_enabled;

COMMENT ON COLUMN agencies.ghl_api_enabled IS
  'When true, lifecycle events (submission / approved / terminated / at risk) '
  'for this agency fire a direct create-contact push to the GHL Sunfire location. '
  'Renamed from zaps_enabled 2026-07-09 (Zap path fully removed).';

-- ── 2. lifecycle_policy_state ─────────────────────────────────────────────────
-- Tracks the last-seen state for every policy the lifecycle-direct runner has
-- processed. The runner diffs incoming rows from Max's DB against this table to
-- detect change without re-importing into form_submissions.
CREATE TABLE IF NOT EXISTS lifecycle_policy_state (
  policy_number       text        PRIMARY KEY,
  cntrct_code         text,                       -- A / P / T / S
  at_risk_policy      boolean     NOT NULL DEFAULT false,
  paid_to_date        date,
  agency_id           uuid        REFERENCES agencies(id) ON DELETE SET NULL,
  last_load_id        text,                       -- _dlt_load_id snapshot was taken from
  first_seen_at       timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE lifecycle_policy_state IS
  'Diff baseline for lifecycle-direct. One row per policy; updated each runner '
  'pass. Drives change detection for submission / approved / terminated / at risk '
  'without importing data into form_submissions.';

-- Index for agency-scoped queries (gate check + per-agency rollup).
CREATE INDEX IF NOT EXISTS lifecycle_policy_state_agency_idx
  ON lifecycle_policy_state (agency_id);

-- Updated-at trigger.
CREATE OR REPLACE FUNCTION set_lifecycle_policy_state_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lifecycle_policy_state_updated_at_trg ON lifecycle_policy_state;
CREATE TRIGGER lifecycle_policy_state_updated_at_trg
  BEFORE UPDATE ON lifecycle_policy_state
  FOR EACH ROW EXECUTE FUNCTION set_lifecycle_policy_state_updated_at();

-- RLS: service role writes; anon has no access (internal table).
ALTER TABLE lifecycle_policy_state ENABLE ROW LEVEL SECURITY;

-- No SELECT policy for anon — this table is edge-function internal only.
-- Service role bypasses RLS by default in Supabase.
