-- UNL delivers the production file to the upstream analytics DB once per day,
-- usually 10-11 AM Central. Replace the 7:30 AM / 6:30 PM Central pair with a
-- single run at 18:00 UTC = 1 PM CDT / 12 PM CST, comfortably after delivery.
SELECT cron.unschedule('sql-import-morning');
SELECT cron.unschedule('sql-import-evening');
SELECT cron.schedule(
  'sql-import-daily',
  '0 18 * * *',
  $$
SELECT net.http_post(
url := 'https://lryxxnpafaxjgehqirdp.supabase.co/functions/v1/sql-import-cron',
headers := jsonb_build_object(
'Content-Type', 'application/json',
'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_import_secret')
),
body := '{}'::jsonb
);
$$
);
