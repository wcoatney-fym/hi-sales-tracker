-- GHL Token Refresh cron job
-- Runs every 6 hours to refresh OAuth tokens expiring within 2 hours.
-- Idempotent: unschedule first (swallow errors), then reschedule.

DO $$ BEGIN PERFORM cron.unschedule('ghl-token-refresh'); EXCEPTION WHEN others THEN NULL; END; $$;
SELECT cron.schedule(
  'ghl-token-refresh',
  '0 */6 * * *',
  $$
SELECT net.http_post(
  url     := 'https://lryxxnpafaxjgehqirdp.supabase.co/functions/v1/ghl-token-refresh',
  headers := jsonb_build_object(
    'Content-Type',  'application/json',
    'x-cron-auth',   (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_import_secret')
  ),
  body    := '{}'::jsonb
);
$$
);
