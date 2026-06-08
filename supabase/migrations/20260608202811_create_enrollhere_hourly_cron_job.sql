/*
  # Create EnrollHere Hourly Poll Cron Job

  Schedules the enrollhere-poll edge function to run every hour at minute 30.
  Offset from the existing poll-data-sources job (which runs at minute 0).
*/

SELECT cron.schedule(
  'enrollhere-poll-hourly',
  '30 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/enrollhere-poll',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{"date_range":"today"}'::jsonb
  );
  $$
);
