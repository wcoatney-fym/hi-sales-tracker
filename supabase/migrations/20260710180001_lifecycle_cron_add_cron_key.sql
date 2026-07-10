-- Update lifecycle-direct-poll cron job to send X-Cron-Key header.
-- This header, combined with the LIFECYCLE_CRON_KEY secret set on the function,
-- identifies the invocation as a scheduled cron run and exempts it from the
-- manual-fire confirmation token gate.
--
-- DEPLOY ORDER (must be followed exactly to avoid silent pipeline outage):
--   1. supabase secrets set LIFECYCLE_CRON_KEY=<secret> DEPLOY_LIFECYCLE_SHA=<sha>
--   2. supabase db push  (applies this migration — updates cron job BEFORE new function lands)
--   3. supabase functions deploy lifecycle-direct
--
-- If step 3 runs before steps 1+2, every scheduled tick returns awaiting_confirmation
-- and processes nothing. The deploy order in the PR description enforces this.

SELECT cron.unschedule('lifecycle-direct-poll');

SELECT cron.schedule(
  'lifecycle-direct-poll',
  '*/15 * * * *',
  $$
SELECT net.http_post(
  url     := 'https://lryxxnpafaxjgehqirdp.supabase.co/functions/v1/lifecycle-direct',
  headers := jsonb_build_object(
    'Content-Type',  'application/json',
    'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_import_secret'),
    'X-Cron-Key',    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'lifecycle_cron_key')
  ),
  body    := '{}'::jsonb
);
$$
);
