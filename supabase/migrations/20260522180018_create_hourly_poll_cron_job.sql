/*
  # Create Hourly Poll Cron Job

  1. Extensions
    - Enable pg_net extension for making HTTP requests from within PostgreSQL

  2. Cron Job
    - Schedule: Runs at minute 0 of every hour (top of the hour)
    - Action: Invokes the poll-data-sources edge function via HTTP
    - The edge function handles checking which sources are due for polling

  3. Notes
    - pg_cron is already installed
    - pg_net allows async HTTP calls from within the database
    - The edge function uses the service role key for auth
*/

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.schedule(
  'poll-data-sources-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/poll-data-sources',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
