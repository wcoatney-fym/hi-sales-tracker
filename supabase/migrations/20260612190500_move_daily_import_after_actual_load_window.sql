-- Measured dlt load landings (Central): 11:09a, 11:59a, 12:02p, 12:27p, 12:41p,
-- 1:07p, 1:14p, 1:26p — the 18:00 UTC import raced the load and lost on 6/12.
-- 20:00 UTC = 3 PM CDT / 2 PM CST clears every observed landing by 30+ minutes.
SELECT cron.unschedule('sql-import-daily');
SELECT cron.schedule(
  'sql-import-daily',
  '0 20 * * *',
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
