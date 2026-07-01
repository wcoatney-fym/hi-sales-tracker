/*
  # Lifecycle event audit log

  1. Table
    - `lifecycle_event_log` — append-only record of every lifecycle event the
      sql-import-cron evaluator attempted to push to the Zapier hook, including
      the HTTP result (or dry-run marker).

  2. Why
    - Verifiability: after each daily UNL pull we need to see exactly which
      policies fired which trigger, whether the Zap POST succeeded, and why any
      were skipped. This is the source of truth for validating the evaluator in
      dry-run before we flip it live, and for debugging misfires afterward.

  3. Notes
    - Append-only, service-role writes only (edge function). No RLS read grant
      to anon — audit data stays admin-side.
*/

CREATE TABLE IF NOT EXISTS public.lifecycle_event_log (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_number          text NOT NULL,
  trigger                text NOT NULL,
  previous_contract_code text,
  contract_code          text,
  contract_reason        text,
  risk_signal            text,
  agency_id              uuid,
  upload_id              uuid,
  http_status            integer,
  ok                     boolean NOT NULL DEFAULT false,
  dry_run                boolean NOT NULL DEFAULT false,
  error                  text,
  fired_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lifecycle_event_log_policy_idx
  ON public.lifecycle_event_log (policy_number, fired_at DESC);
CREATE INDEX IF NOT EXISTS lifecycle_event_log_fired_idx
  ON public.lifecycle_event_log (fired_at DESC);
CREATE INDEX IF NOT EXISTS lifecycle_event_log_trigger_idx
  ON public.lifecycle_event_log (trigger, fired_at DESC);

ALTER TABLE public.lifecycle_event_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to lifecycle_event_log"
  ON public.lifecycle_event_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.lifecycle_event_log IS
  'Append-only audit of lifecycle events (submission/approved/terminated/at risk) the sql-import-cron evaluator pushed to the Zapier hook. One row per fire attempt, incl. HTTP result or dry_run marker. Service-role writes only.';
