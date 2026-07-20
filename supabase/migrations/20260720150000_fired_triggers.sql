-- Migration: fired_triggers idempotency ledger
-- Implements spec from docs/migration-mockup/migrations/001_fired_triggers.sql
-- Applied: 2026-07-20
--
-- Purpose: guarantees every lifecycle trigger fires exactly once per
-- (policy_nbr, trigger_type, changed_on). Replaces lifecycle_policy_state
-- as the idempotency mechanism — trigger queries gate on NOT EXISTS here
-- instead of diffing against prior state in application code.

CREATE TABLE IF NOT EXISTS public.fired_triggers (
    id             BIGSERIAL PRIMARY KEY,
    policy_nbr     TEXT        NOT NULL,
    trigger_type   TEXT        NOT NULL,
    changed_on     DATE        NOT NULL,
    fired_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fired_triggers_unique
        UNIQUE (policy_nbr, trigger_type, changed_on),

    CONSTRAINT fired_triggers_trigger_type_check
        CHECK (trigger_type IN ('approved', 'terminated', 'submission', 'at_risk'))
);

-- Covering index for NOT EXISTS subquery in trigger queries
CREATE INDEX IF NOT EXISTS fired_triggers_lookup_idx
    ON public.fired_triggers (policy_nbr, trigger_type, changed_on);

CREATE INDEX IF NOT EXISTS fired_triggers_policy_idx
    ON public.fired_triggers (policy_nbr);

CREATE INDEX IF NOT EXISTS fired_triggers_fired_at_idx
    ON public.fired_triggers (fired_at DESC);

COMMENT ON TABLE public.fired_triggers IS
    'Idempotency ledger for lifecycle trigger events. One row per '
    '(policy_nbr, trigger_type, changed_on). Prevents a transition from '
    'firing more than once even if Max''s DB re-presents historical rows '
    'on every daily load. Written after a successful GHL push; never deleted.';

COMMENT ON COLUMN public.fired_triggers.changed_on IS
    'Business date the contract code or at-risk status changed '
    '(contract_code_last_change_date from Max''s DB — the effective/business '
    'date, NOT the ETL load date — confirmed 2026-07-17).';
