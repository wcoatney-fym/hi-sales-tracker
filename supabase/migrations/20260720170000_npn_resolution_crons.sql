-- Register cron jobs for npn-resolution and proposed-fires-push.
--
-- npn-resolution: runs once daily at 7:00 AM CT (12:00 UTC) — after
--   lifecycle-direct's nightly batch, before the team's work day starts.
--   Re-checks all held rows against the live NPN map and promotes any
--   newly-resolvable holds to proposed_fires.
--
-- proposed-fires-push: runs once daily at 7:15 AM CT (12:15 UTC) — 15 min
--   after npn-resolution so the proposed_fires table is fresh before the
--   push sweep. Picks up any rows approved_at IS NOT NULL AND fired_at IS NULL
--   and pushes them to GHL.
--
-- Both functions also accept manual POST via confirmation token for
-- ad-hoc resolution (e.g. when a new agent is added mid-day).
--
-- Auth: x-cron-auth header = cron_import_secret (same vault secret as
-- lifecycle-direct). The edge functions check this header before
-- CONFIRMATION_TOKEN to identify scheduled vs manual calls.

SELECT cron.schedule(
  'npn-resolution-daily',
  '0 12 * * *',   -- 7:00 AM CT (UTC-5 standard / UTC-6 DST: use 12:00 UTC year-round,
                  -- accepts ±1hr seasonal shift — alert thresholds absorb it)
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

SELECT cron.schedule(
  'proposed-fires-push-daily',
  '15 12 * * *',   -- 7:15 AM CT (15 min after npn-resolution)
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
