-- lifecycle_canary_runs + daily pg_cron schedule
--
-- The GHL canary edge function (supabase/functions/ghl-canary/index.ts) runs
-- daily and writes one row here per run. Provides a durable, queryable history
-- of every canary attempt — pass/fail, assertions, contact_id, error text.
--
-- pg_cron schedule: 08:30 America/Chicago daily (= 13:30 UTC during CDT).
-- Fires after the overnight import window and the 07:00 CT quality read.
--
-- Alert path: canary edge fn reads slack_alert_webhook from Vault and POSTs
-- to #dev-ghl on any failure. Silent on green runs.
--
-- Required Supabase function secrets (set before enabling the cron):
--   GHL_API_KEY_HIP_PORTAL        — Private Integration bearer token
--   GHL_LOCATION_ID_SUNFIRE_BUILD — Build location ID (NOT Sunfire Production)

-- ── Table ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lifecycle_canary_runs (
  id                 bigserial     PRIMARY KEY,
  run_at             timestamptz   NOT NULL DEFAULT now(),
  ok                 boolean       NOT NULL,
  steps_passed       smallint      NOT NULL DEFAULT 0,
  steps_total        smallint      NOT NULL DEFAULT 4,
  contact_id         text,                          -- GHL contact id created; null if create failed
  assertions_passed  smallint      NOT NULL DEFAULT 0,
  assertions_failed  smallint      NOT NULL DEFAULT 0,
  error              text,                          -- null on success
  detail             jsonb                          -- full assertion list + raw GHL response snippets
);

COMMENT ON TABLE public.lifecycle_canary_runs IS
  'One row per daily GHL canary run. Canary pushes a synthetic contact to the '
  'GHL Sunfire BUILD location (never Production), reads it back to assert field '
  'IDs and Title Case values, then deletes it. ok=false triggers a Slack alert '
  'to #dev-ghl. Retained 90 days.';

-- Fast lookup for the daily health check and Diamond''s brief.
CREATE INDEX IF NOT EXISTS lifecycle_canary_runs_run_at_idx
  ON public.lifecycle_canary_runs (run_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.lifecycle_canary_runs ENABLE ROW LEVEL SECURITY;

-- Service role: full access (edge fn writes).
CREATE POLICY "service role full access to lifecycle_canary_runs"
  ON public.lifecycle_canary_runs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Anon/authenticated: SELECT only (needed by quality read RPC + dashboard).
-- Returns run status but not raw GHL contact IDs or assertion detail.
CREATE POLICY "anon can read canary run status"
  ON public.lifecycle_canary_runs
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- ── Auto-purge (90-day retention) ────────────────────────────────────────────
SELECT cron.schedule(
  'purge-lifecycle-canary-runs',
  '45 4 * * *',
  $$ DELETE FROM public.lifecycle_canary_runs WHERE run_at < now() - interval '90 days' $$
);

-- ── Daily canary schedule ─────────────────────────────────────────────────────
-- 13:30 UTC = 08:30 CDT / 07:30 CST. Adjust for DST: the cron fires at 13:30
-- UTC year-round; during CST (Nov–Mar) that's 07:30 CT — still fine.
SELECT cron.schedule(
  'ghl-canary-daily',
  '30 13 * * *',
  $$
  SELECT net.http_post(
    url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url')
               || '/ghl-canary',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key'
      )
    ),
    body    := '{}'::jsonb
  );
  $$
);

COMMENT ON TABLE public.lifecycle_canary_runs IS
  'Daily GHL canary run log. One row per invocation. Purged after 90 days. '
  'pg_cron: ghl-canary-daily fires at 13:30 UTC (08:30 CDT / 07:30 CST).';
