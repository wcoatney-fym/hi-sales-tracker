-- Migration: NPN gate tables — npn_holds + proposed_fires
-- Implements the NPN gate spec from docs/migration-mockup/migrations/002_npn_gate.sql
-- Applied: 2026-07-20

-- -----------------------------------------------------------------------------
-- npn_holds: rows that failed the NPN gate and are waiting for resolution
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.npn_holds (
    id              BIGSERIAL PRIMARY KEY,
    policy_nbr      TEXT        NOT NULL,
    trigger_type    TEXT        NOT NULL,
    changed_on      DATE        NOT NULL,
    agency_id       UUID        REFERENCES public.agencies(id) ON DELETE SET NULL,
    agency_name     TEXT,
    agent_name      TEXT,
    writing_number  TEXT        NOT NULL,
    held_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status          TEXT        NOT NULL DEFAULT 'held'
                        CHECK (status IN ('held', 'resolved')),
    released_at     TIMESTAMPTZ,

    CONSTRAINT npn_holds_unique
        UNIQUE (policy_nbr, trigger_type, changed_on),

    CONSTRAINT npn_holds_trigger_type_check
        CHECK (trigger_type IN ('approved', 'terminated', 'submission', 'at_risk')),

    CONSTRAINT npn_holds_released_requires_resolved
        CHECK (released_at IS NULL OR status = 'resolved')
);

CREATE INDEX IF NOT EXISTS npn_holds_writing_number_idx
    ON public.npn_holds (writing_number, status);

CREATE INDEX IF NOT EXISTS npn_holds_agency_idx
    ON public.npn_holds (agency_id, status, held_at DESC);

CREATE INDEX IF NOT EXISTS npn_holds_policy_idx
    ON public.npn_holds (policy_nbr);

COMMENT ON TABLE public.npn_holds IS
    'Policies halted at the NPN gate — agent NPN missing from agents and agency_rosters. '
    'status=held: waiting for NPN. status=resolved: NPN found, promoted to proposed_fires.';

COMMENT ON COLUMN public.npn_holds.writing_number IS
    'wa from typed.unl_fym_policy_latest_load, normalized UPPER. '
    'Lookup: agents.unl_writing_number (primary) → agency_rosters.writing_number (fallback).';

-- -----------------------------------------------------------------------------
-- proposed_fires: resolved holds awaiting human approval before GHL push
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.proposed_fires (
    id              BIGSERIAL PRIMARY KEY,
    npn_hold_id     BIGINT      NOT NULL REFERENCES public.npn_holds(id) ON DELETE CASCADE,
    policy_nbr      TEXT        NOT NULL,
    trigger_type    TEXT        NOT NULL,
    changed_on      DATE        NOT NULL,
    agency_id       UUID        REFERENCES public.agencies(id) ON DELETE SET NULL,
    agent_npn       TEXT        NOT NULL,
    writing_number  TEXT        NOT NULL,
    proposed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_at     TIMESTAMPTZ,
    fired_at        TIMESTAMPTZ,
    approved_by     TEXT,

    CONSTRAINT proposed_fires_unique
        UNIQUE (policy_nbr, trigger_type, changed_on),

    CONSTRAINT proposed_fires_trigger_type_check
        CHECK (trigger_type IN ('approved', 'terminated', 'submission', 'at_risk')),

    CONSTRAINT proposed_fires_fired_requires_approved
        CHECK (fired_at IS NULL OR approved_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS proposed_fires_pending_idx
    ON public.proposed_fires (approved_at, fired_at)
    WHERE approved_at IS NOT NULL AND fired_at IS NULL;

CREATE INDEX IF NOT EXISTS proposed_fires_agency_idx
    ON public.proposed_fires (agency_id, proposed_at DESC);

COMMENT ON TABLE public.proposed_fires IS
    'Resolved NPN holds promoted to push queue. Requires human approval (approved_at) '
    'before GHL API push. fired_at set after successful push. '
    'Auto-fire-on-resolve is the intended end state — approval gate removed at go-live.';
