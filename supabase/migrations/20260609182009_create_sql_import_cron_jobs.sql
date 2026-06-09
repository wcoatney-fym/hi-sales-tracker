/*
  # Create SQL Import Cron Jobs (7am + 6pm EST)

  EST is always UTC-5:
    - 7:00 AM EST = 12:00 UTC
    - 6:00 PM EST = 23:00 UTC

  Schedules two pg_cron entries that invoke the sql-import-cron edge function.
*/

SELECT cron.schedule(
  'sql-import-morning',
  '0 12 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/sql-import-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'sql-import-evening',
  '0 23 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/sql-import-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);