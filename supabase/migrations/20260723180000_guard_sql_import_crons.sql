-- Guard migration: idempotently re-register sql-import cron jobs.
--
-- Root cause (2026-07-23): `supabase db push` resets pg_cron jobs created by
-- earlier (already-applied) migrations. The sql-import-daily and sql-import-poll
-- jobs were created in migrations 20260612190500 and 20260612193000 respectively,
-- but disappeared after the July 20 migration batch was pushed. Result: 3 days
-- of stale data across all agency dashboards (external escalation from Guide to
-- Insure / Brent DePeppe).
--
-- This migration runs on every `db push` and ensures both jobs exist. It is
-- safe to re-run: unschedule swallows "not found" errors, then reschedules.
--
-- STANDING RULE: every future migration batch that touches cron.job should
-- include (or reference) a guard migration like this one for any critical
-- recurring jobs.

-- 1. sql-import-daily: unconditional daily import at 20:00 UTC (3 PM CT)
DO $$ BEGIN PERFORM cron.unschedule('sql-import-daily'); EXCEPTION WHEN others THEN NULL; END; $$;

SELECT cron.schedule(
  'sql-import-daily',
  '0 20 * * *',
  $$
SELECT net.http_post(
  url     := 'https://lryxxnpafaxjgehqirdp.supabase.co/functions/v1/sql-import-cron',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_import_secret')
  ),
  body    := '{}'::jsonb
);
$$
);

-- 2. sql-import-poll: load-aware polling every 15 minutes (checks _dlt_load_id,
--    only imports when a new load has landed or the previous import errored)
DO $$ BEGIN PERFORM cron.unschedule('sql-import-poll'); EXCEPTION WHEN others THEN NULL; END; $$;

SELECT cron.schedule(
  'sql-import-poll',
  '*/15 * * * *',
  $$
SELECT net.http_post(
  url     := 'https://lryxxnpafaxjgehqirdp.supabase.co/functions/v1/sql-import-cron',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_import_secret')
  ),
  body    := '{"phase":"check"}'::jsonb
);
$$
);
