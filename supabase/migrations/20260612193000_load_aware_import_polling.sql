-- Track the upstream dlt load id last seen per source so the poller can
-- trigger imports only when a new load lands.
ALTER TABLE data_sources ADD COLUMN IF NOT EXISTS last_seen_load_id text;

-- Poll for a new upstream load every 15 minutes (the check is a single-row
-- read; a full import only runs when the load id changes or the previous
-- import errored). The 20:00 UTC daily job remains as an unconditional
-- safety net.
SELECT cron.schedule(
  'sql-import-poll',
  '*/15 * * * *',
  $$
SELECT net.http_post(
url := 'https://lryxxnpafaxjgehqirdp.supabase.co/functions/v1/sql-import-cron',
headers := jsonb_build_object(
'Content-Type', 'application/json',
'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_import_secret')
),
body := '{"phase":"check"}'::jsonb
);
$$
);
