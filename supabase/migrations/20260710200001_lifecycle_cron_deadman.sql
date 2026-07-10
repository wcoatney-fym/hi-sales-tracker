-- Dead-man's switch: alert #crm-openclaw if no scheduled lifecycle-direct
-- tick has landed in lifecycle_cron_runs for >30 minutes.
-- Runs every 30 minutes via pg_cron.
--
-- Residual risk (documented): this job runs on the same pg_cron scheduler
-- it monitors. A full scheduler outage alerts nothing. External uptime
-- monitoring is the eventual fix for that gap.
--
-- Unhandled exceptions in lifecycle-direct (e.g., Max's DB timeout) cause
-- the function to exit before writeCronRun() is called — no row is written,
-- the gap grows, and the dead-man fires. This is intentional: a crashed tick
-- looks identical to a missing tick from the dead-man's perspective, which is
-- the correct and conservative behavior.

SELECT cron.schedule(
  'lifecycle-direct-deadman',
  '*/30 * * * *',
  $cron_cmd$
  DO $inner$
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
  $inner$ LANGUAGE plpgsql;
  $cron_cmd$
);
