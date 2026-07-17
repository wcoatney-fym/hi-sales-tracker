-- Migration: NPN gate tables — npn_holds + proposed_fires
-- Part of the Max DB → GHL migration mockup.
-- NOT applied to prod — mockup spec only.
--
-- =============================================================================
-- CODEBASE VERIFICATION (2026-07-17, read before writing)
-- =============================================================================
--
-- Roster lookup architecture (confirmed from lifecycle-direct/index.ts L401–763):
--
--   PRIMARY:  agents table
--             join key: agents.unl_writing_number  (normalized .trim().toUpperCase())
--             NPN col:  agents.npn
--
--   FALLBACK: agency_rosters table
--             join key: agency_rosters.writing_number (normalized .trim().toUpperCase())
--             NPN col:  agency_rosters.npn
--             filter:   status = 'active' AND npn IS NOT NULL AND npn != ''
--
--   INPUT:    wa column from typed.unl_fym_policy_latest_load
--             (= UNL writing number, normalized to UPPER before lookup)
--
--   NPN present = non-null, non-empty string in either source.
--   Name-based lookup is NOT used — writing number is the sole join key.
--   This matches the live NPN map construction in lifecycle-direct.
--
--   Columns confirmed in schema:
--     agents:         unl_writing_number text, npn text (unique partial index where npn != '')
--     agency_rosters: writing_number text, npn text NOT NULL DEFAULT ''
--                     status text CHECK ('active'|'terminated')
--
-- NPN coverage today:
--   Only FYM-direct and DH Insurance have full NPN coverage.
--   High hold volumes for all other agencies are correct behavior, not a bug.
--   (Charlie confirmed 2026-07-17.)
--
-- =============================================================================


-- -----------------------------------------------------------------------------
-- npn_holds: rows that failed the NPN gate and are waiting for resolution
-- -----------------------------------------------------------------------------
--
-- One row per (policy_nbr, trigger_type) that could not be pushed because
-- the agent's NPN was missing from both agents and agency_rosters.
--
-- status lifecycle:
--   'held'     — NPN missing, payload not sent
--   'resolved' — NPN now present on roster; row moved to proposed_fires
--                (released_at set, status flipped — do NOT auto-fire)

CREATE TABLE IF NOT EXISTS public.npn_holds (
    id              BIGSERIAL PRIMARY KEY,
    policy_nbr      TEXT        NOT NULL,
    trigger_type    TEXT        NOT NULL,  -- 'approved'|'terminated'|'submission'|'at_risk'
    changed_on      DATE        NOT NULL,  -- same date used in fired_triggers.changed_on
    agency_id       UUID        REFERENCES public.agencies(id) ON DELETE SET NULL,
    agency_name     TEXT,                  -- denormalized for readability in admin views
    agent_name      TEXT,                  -- wa_name from Max's DB (full name)
    writing_number  TEXT        NOT NULL,  -- wa from Max's DB, normalized UPPER
    held_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status          TEXT        NOT NULL DEFAULT 'held'
                        CHECK (status IN ('held', 'resolved')),
    released_at     TIMESTAMPTZ,           -- set when NPN found and row promoted

    CONSTRAINT npn_holds_unique
        UNIQUE (policy_nbr, trigger_type, changed_on),

    CONSTRAINT npn_holds_trigger_type_check
        CHECK (trigger_type IN ('approved', 'terminated', 'submission', 'at_risk')),

    CONSTRAINT npn_holds_released_requires_resolved
        CHECK (released_at IS NULL OR status = 'resolved')
);

-- Lookup: find all held rows for a given writing number (resolution scan)
CREATE INDEX IF NOT EXISTS npn_holds_writing_number_idx
    ON public.npn_holds (writing_number, status);

-- Lookup: admin view — held rows by agency
CREATE INDEX IF NOT EXISTS npn_holds_agency_idx
    ON public.npn_holds (agency_id, status, held_at DESC);

-- Lookup: ops — all held rows for a policy
CREATE INDEX IF NOT EXISTS npn_holds_policy_idx
    ON public.npn_holds (policy_nbr);

COMMENT ON TABLE public.npn_holds IS
    'Policies halted at the NPN gate — agent NPN missing from agents table and '
    'agency_rosters. One row per (policy_nbr, trigger_type, changed_on). '
    'status=held: waiting for NPN. status=resolved: NPN found, row promoted to '
    'proposed_fires. Never auto-fires — proposed_fires requires human approval.';

COMMENT ON COLUMN public.npn_holds.writing_number IS
    'wa from typed.unl_fym_policy_latest_load, normalized UPPER. '
    'This is the UNL writing number, NOT the NPN. Lookup: '
    'agents.unl_writing_number (primary) → agency_rosters.writing_number (fallback).';

COMMENT ON COLUMN public.npn_holds.changed_on IS
    'Mirrors fired_triggers.changed_on for the same (policy_nbr, trigger_type). '
    'Used to dedup: if the hold resolves and the row is promoted to proposed_fires, '
    'the fired_triggers INSERT uses this same date.';


-- -----------------------------------------------------------------------------
-- proposed_fires: resolved holds awaiting human approval before GHL push
-- -----------------------------------------------------------------------------
--
-- When NPN becomes available for a held agent, the resolution flow:
--   1. Looks up all npn_holds WHERE writing_number = <resolved_wn> AND status = 'held'
--   2. Flips npn_holds.status = 'resolved', sets released_at = NOW()
--   3. Inserts one row per resolved hold into proposed_fires (with NPN attached)
--   4. DOES NOT fire GHL API — requires human approval
--
-- Approval flow (mockup phase — intended end state is auto-fire-on-resolve):
--   A human reviews proposed_fires and sets approved_at to allow the push.
--   The actual GHL push reads WHERE approved_at IS NOT NULL AND fired_at IS NULL.
--   After push: fired_at set, fired_triggers row inserted.
--
-- NOTE: auto-fire-on-resolve is the intended production end state.
--       It is explicitly gated here (approved_at required) for the mockup phase.
--       When go-live is approved, the approval gate is removed and the resolver
--       inserts directly into the push queue without the proposed_fires hop.

CREATE TABLE IF NOT EXISTS public.proposed_fires (
    id              BIGSERIAL PRIMARY KEY,
    npn_hold_id     BIGINT      NOT NULL REFERENCES public.npn_holds(id) ON DELETE CASCADE,
    policy_nbr      TEXT        NOT NULL,
    trigger_type    TEXT        NOT NULL,
    changed_on      DATE        NOT NULL,
    agency_id       UUID        REFERENCES public.agencies(id) ON DELETE SET NULL,
    agent_npn       TEXT        NOT NULL,  -- the NPN that unblocked this row
    writing_number  TEXT        NOT NULL,
    proposed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_at     TIMESTAMPTZ,           -- set by human approver; required before push
    fired_at        TIMESTAMPTZ,           -- set after successful GHL push
    approved_by     TEXT,                  -- optional: who approved (session/user id)

    CONSTRAINT proposed_fires_unique
        UNIQUE (policy_nbr, trigger_type, changed_on),

    CONSTRAINT proposed_fires_trigger_type_check
        CHECK (trigger_type IN ('approved', 'terminated', 'submission', 'at_risk')),

    CONSTRAINT proposed_fires_fired_requires_approved
        CHECK (fired_at IS NULL OR approved_at IS NOT NULL)
);

-- Push queue: pending approval
CREATE INDEX IF NOT EXISTS proposed_fires_pending_idx
    ON public.proposed_fires (approved_at, fired_at)
    WHERE approved_at IS NOT NULL AND fired_at IS NULL;

-- Admin view: all proposals for an agency
CREATE INDEX IF NOT EXISTS proposed_fires_agency_idx
    ON public.proposed_fires (agency_id, proposed_at DESC);

COMMENT ON TABLE public.proposed_fires IS
    'Resolved NPN holds promoted to a proposed push queue. Requires human approval '
    '(approved_at) before GHL API push. fired_at set after successful push. '
    'Auto-fire-on-resolve is the intended end state — approval gate removed at go-live.';
