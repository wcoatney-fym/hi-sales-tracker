-- Migration: fired_triggers idempotency ledger
-- Part of the Max DB → GHL migration mockup.
-- NOT applied to prod — mockup spec only.
--
-- Purpose: guarantees every lifecycle trigger fires exactly once per
-- (policy_nbr, trigger_type, changed_on) combination. Every trigger
-- query JOINs (via NOT EXISTS) against this table so a row that has
-- already fired cannot re-fire, even if Max's DB re-presents the
-- same historical transition on every daily load.
--
-- Why this is essential: typed.unl_fym_policy_latest_load carries
-- ALL historical contract_code_last_change_date values for every policy
-- (13,339+ rows with delta<0 confirmed in prod 2026-07-17). Without this
-- ledger, any date-window query would re-fire historical events on every
-- run. The NOT EXISTS join is the sole gate preventing that.
--
-- Columns:
--   policy_nbr    — matches typed.unl_fym_policy_latest_load.policy_nbr
--   trigger_type  — 'approved' | 'terminated' | 'submission' | 'at_risk'
--   changed_on    — the business date the transition occurred
--                   (= contract_code_last_change_date, which is the
--                    business/effective date, NOT the ETL load date —
--                    confirmed by querying delta distribution 2026-07-17)
--   fired_at      — UTC timestamp this row was inserted (audit trail)
--
-- Unique constraint: (policy_nbr, trigger_type, changed_on)
--   A given transition can fire exactly once. If the same policy
--   transitions P→A on 2026-07-15 and again on 2026-07-20 (re-approved
--   after a reinstatement), both fire — because changed_on differs.
--
-- Target schema: this table lives in the Supabase tracker DB
--   (lryxxnpafaxjgehqirdp), NOT in Max's DB (read-only).
--   The trigger queries run server-side (edge function / pg_cron) and
--   write ledger rows after a successful GHL push.

CREATE TABLE IF NOT EXISTS public.fired_triggers (
    id             BIGSERIAL PRIMARY KEY,
    policy_nbr     TEXT        NOT NULL,
    trigger_type   TEXT        NOT NULL,  -- 'approved' | 'terminated' | 'submission' | 'at_risk'
    changed_on     DATE        NOT NULL,  -- business date of the transition
    fired_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fired_triggers_unique
        UNIQUE (policy_nbr, trigger_type, changed_on),

    CONSTRAINT fired_triggers_trigger_type_check
        CHECK (trigger_type IN ('approved', 'terminated', 'submission', 'at_risk'))
);

-- Index supporting the NOT EXISTS subquery in trigger queries.
-- The subquery always filters on all three columns — covering index.
CREATE INDEX IF NOT EXISTS fired_triggers_lookup_idx
    ON public.fired_triggers (policy_nbr, trigger_type, changed_on);

-- Index for audit/ops: find all triggers fired for a given policy.
CREATE INDEX IF NOT EXISTS fired_triggers_policy_idx
    ON public.fired_triggers (policy_nbr);

-- Index for monitoring: find all triggers fired on a given date.
CREATE INDEX IF NOT EXISTS fired_triggers_fired_at_idx
    ON public.fired_triggers (fired_at DESC);

COMMENT ON TABLE public.fired_triggers IS
    'Idempotency ledger for lifecycle trigger events. One row per '
    '(policy_nbr, trigger_type, changed_on). Prevents a transition from '
    'firing more than once even if Max''s DB re-presents historical rows '
    'on every daily load. Written after a successful GHL push; never deleted.';

COMMENT ON COLUMN public.fired_triggers.changed_on IS
    'Business date the contract code or at-risk status changed '
    '(= contract_code_last_change_date from Max''s DB, which stores the '
    'effective/business date, not the ETL load date — confirmed 2026-07-17).';

COMMENT ON COLUMN public.fired_triggers.trigger_type IS
    'Lifecycle trigger label. Must match the trigger query CASE expressions exactly: '
    '''approved'' (P→A), ''terminated'' (A→T), ''submission'' (null/!P→P), ''at_risk''.';
