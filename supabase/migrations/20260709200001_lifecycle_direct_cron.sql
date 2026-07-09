-- Schedule lifecycle-direct to run every 15 minutes via pg_cron + pg_net.
-- Mirrors the sql-import-poll cadence. The function checks for state changes
-- against Max's DB on each run; a no-change run is a fast no-op.

SELECT cron.schedule(
  'lifecycle-direct-poll',
  '*/15 * * * *',
  $$
SELECT net.http_post(
  url     := 'https://lryxxnpafaxjgehqirdp.supabase.co/functions/v1/lifecycle-direct',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_import_secret')
  ),
  body    := '{}'::jsonb
);
$$
);
