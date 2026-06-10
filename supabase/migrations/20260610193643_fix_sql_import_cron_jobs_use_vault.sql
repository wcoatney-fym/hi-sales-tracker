/*
  # Fix SQL Import Cron Jobs

  The previous cron jobs referenced `app.settings.supabase_url` and
  `app.settings.service_role_key` which are not configured as database GUCs,
  causing every scheduled run to fail.

  This migration:
  1. Drops the broken cron jobs
  2. Recreates them with hardcoded Supabase URL (not secret) and auth via
     a cron-specific secret stored in Supabase Vault (name: cron_import_secret)
  3. Also creates the RPC helper the edge function uses to validate the secret

  Schedule: 7:30am EST (12:30 UTC) and 6:30pm EST (23:30 UTC)
  The 30-min offset gives Max's daily DB refresh time to complete before we pull.
*/

-- Helper RPC for the edge function to validate the cron secret
CREATE OR REPLACE FUNCTION public.get_cron_import_secret()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_import_secret' LIMIT 1;
$$;

-- Revoke from public/anon - only service_role should call this
REVOKE EXECUTE ON FUNCTION public.get_cron_import_secret() FROM anon, authenticated;

-- Drop the broken cron jobs
SELECT cron.unschedule('sql-import-morning');
SELECT cron.unschedule('sql-import-evening');

-- Recreate with hardcoded URL + Vault-based secret auth
SELECT cron.schedule(
  'sql-import-morning',
  '30 12 * * *',
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

SELECT cron.schedule(
  'sql-import-evening',
  '30 23 * * *',
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
