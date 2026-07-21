-- Register cron jobs for npn-resolution and proposed-fires-push.
-- Idempotent: unschedule first (swallow errors), then reschedule.

DO $$ BEGIN PERFORM cron.unschedule('npn-resolution-daily'); EXCEPTION WHEN others THEN NULL; END; $$;
SELECT cron.schedule(
  'npn-resolution-daily',
  '0 12 * * *',
  $$
SELECT net.http_post(
  url     := 'https://lryxxnpafaxjgehqirdp.supabase.co/functions/v1/npn-resolution',
  headers := jsonb_build_object(
    'Content-Type',  'application/json',
    'x-cron-auth',   (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_import_secret')
  ),
  body    := '{}'::jsonb
);
$$
);

DO $$ BEGIN PERFORM cron.unschedule('proposed-fires-push-daily'); EXCEPTION WHEN others THEN NULL; END; $$;
SELECT cron.schedule(
  'proposed-fires-push-daily',
  '15 12 * * *',
  $$
SELECT net.http_post(
  url     := 'https://lryxxnpafaxjgehqirdp.supabase.co/functions/v1/proposed-fires-push',
  headers := jsonb_build_object(
    'Content-Type',  'application/json',
    'x-cron-auth',   (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_import_secret')
  ),
  body    := '{}'::jsonb
);
$$
);
