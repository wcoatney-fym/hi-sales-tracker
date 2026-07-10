-- Dead-man's switch: alert #crm-openclaw if no scheduled lifecycle-direct
-- tick has landed in lifecycle_cron_runs for >30 minutes.
-- Runs every 30 minutes. Uses pg_net to POST to the lifecycle-direct function
-- with a special ?deadman_check=1 param, which is handled by a separate
-- Supabase Edge Function (lifecycle-alert) or inline check.
--
-- Implementation: simpler to query directly in pg_cron and fire a Slack
-- webhook if the condition is met. Slack webhook URL stored in vault.

SELECT cron.schedule(
  'lifecycle-direct-deadman',
  '*/30 * * * *',
  $$
  DO $$
  DECLARE
    last_tick timestamptz;
    slack_url text;
  BEGIN
    SELECT MAX(ticked_at) INTO last_tick
    FROM public.lifecycle_cron_runs
    WHERE cron_auth = true;

    IF last_tick IS NULL OR last_tick < now() - interval '35 minutes' THEN
      SELECT decrypted_secret INTO slack_url
      FROM vault.decrypted_secrets
      WHERE name = 'slack_alert_webhook';

      IF slack_url IS NOT NULL THEN
        PERFORM net.http_post(
          url     := slack_url,
          headers := '{"Content-Type": "application/json"}'::jsonb,
          body    := jsonb_build_object(
            'text', format(
              ':red_circle: *lifecycle-direct dead-man alert* — no scheduled tick since %s (>35 min gap). Check pg_cron job `lifecycle-direct-poll`.',
              COALESCE(last_tick::text, 'never')
            )
          )
        );
      END IF;
    END IF;
  END;
  $$ LANGUAGE plpgsql;
  $$
);
