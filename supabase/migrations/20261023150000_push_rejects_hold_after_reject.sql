/*
  # push_rejects — hold-after-reject for gated lifecycle pushes

  Context (2026-10-23, Charlie-approved in #crm-openclaw):
  - Since PR #178 every lifecycle contact create routes through the FYM App
    crm-ghl-sync All Templates gate. A 422 from the gate is a DETERMINISTIC
    verdict (missing roster, blocked agency, missing All Templates fields) —
    retrying the same row every 30 minutes cannot succeed and produced 253
    repeat 422s overnight 10/22→10/23.
  - Fix: persist gate rejects keyed exactly like fired_triggers
    (policy_nbr, trigger_type, changed_on). lifecycle-direct skips rows
    present here. A reject auto-releases when the policy's data changes
    (new changed_on = new key) or when the row is deleted/resolved manually
    (e.g. after a roster upload fixes the agency).
  - Transient failures (5xx / network / 429-exhausted) are NOT persisted —
    they stay retryable.

  Changes:
  - CREATE TABLE public.push_rejects
  - REVOKE ALL FROM anon, authenticated (PII-adjacent; service_role only —
    per standing rule, every new table revokes default grants at creation)
  - ALTER lifecycle_cron_runs ADD rejected int (new rejects persisted per run)
*/

CREATE TABLE IF NOT EXISTS public.push_rejects (
    id              BIGSERIAL PRIMARY KEY,
    policy_nbr      TEXT        NOT NULL,
    trigger_type    TEXT        NOT NULL,
    changed_on      DATE        NOT NULL,
    http_status     INTEGER,
    held            BOOLEAN     NOT NULL DEFAULT FALSE,
    error           TEXT,
    agency_id       UUID        REFERENCES public.agencies(id) ON DELETE SET NULL,
    agency_name     TEXT,
    agent_name      TEXT,
    rejected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status          TEXT        NOT NULL DEFAULT 'rejected'
                        CHECK (status IN ('rejected', 'resolved')),
    resolved_at     TIMESTAMPTZ,

    CONSTRAINT push_rejects_unique
        UNIQUE (policy_nbr, trigger_type, changed_on),

    CONSTRAINT push_rejects_trigger_type_check
        CHECK (trigger_type IN ('approved', 'terminated', 'submission', 'at_risk'))
);

ALTER TABLE public.push_rejects ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.push_rejects FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.push_rejects_id_seq FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_push_rejects_status
    ON public.push_rejects (status, rejected_at DESC);

-- Per-run counter: how many NEW rejects were persisted in that run.
ALTER TABLE public.lifecycle_cron_runs
    ADD COLUMN IF NOT EXISTS rejected INTEGER NOT NULL DEFAULT 0;
