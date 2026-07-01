-- Data-side lifecycle evaluator: durable "last-known state we fired on" per
-- policy, plus an audit log of every event pushed to the Zapier hook.
--
-- Why a dedicated table (not form_submissions itself): the daily UNL pull is a
-- full-state refresh that overwrites form_submissions, and imports can retry.
-- Firing must be on CHANGE vs the last state we ACTED on, and idempotent across
-- re-runs, so the comparison baseline lives here, decoupled from the book.

create table if not exists public.policy_lifecycle_state (
  policy_number       text primary key,
  last_contract_code  text,
  last_at_risk        boolean not null default false,
  last_fired_trigger  text,
  last_evaluated_at   timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.policy_lifecycle_state is
  'Last-known contract_code / at-risk state per policy that the lifecycle evaluator has fired on. Comparison baseline for status-change + at-risk Zap events. Decoupled from form_submissions so a full-state refresh or import retry cannot cause presence-based re-fires.';

-- Audit trail of every event pushed to the Zapier hook (or skipped).
create table if not exists public.lifecycle_event_log (
  id                     uuid primary key default gen_random_uuid(),
  policy_number          text not null,
  trigger                text not null,
  previous_contract_code text,
  contract_code          text,
  contract_reason        text,
  risk_signal            text,
  agency_id              uuid,
  http_status            integer,
  ok                     boolean not null default false,
  error                  text,
  upload_id              uuid,
  fired_at               timestamptz not null default now()
);

create index if not exists lifecycle_event_log_policy_idx
  on public.lifecycle_event_log (policy_number, fired_at desc);
create index if not exists lifecycle_event_log_fired_idx
  on public.lifecycle_event_log (fired_at desc);

comment on table public.lifecycle_event_log is
  'Append-only audit of lifecycle events (submission/approved/terminated/at risk) the evaluator pushed to the Zapier hook, including HTTP result. One row per fire attempt.';
