-- Migrate ghl-canary to Sunfire-only.
--
-- Previously the canary supported two targets: Build (default) and Sunfire
-- (opt-in). Build has been removed — Sunfire is now the only target.
-- The pg_cron backup job body is updated to reflect this, and stale comments
-- referencing the Build sub-account are removed.
--
-- The daily canary now:
--   1. Resolves field IDs at runtime from Sunfire's /customFields endpoint.
--   2. Creates a synthetic contact tagged 'canary | do not automate'.
--   3. Reads it back and asserts all field IDs + Title Case values.
--   4. Deletes the contact.
--
-- Required secrets (unchanged):
--   GHL_API_KEY_HIP_PORTAL_SUNFIRE  — Sunfire Production token
--   GHL_LOCATION_ID_SUNFIRE         — IQljfeWX6wWHmzUtgSyz

-- Update the table comment to reflect Sunfire-only target.
COMMENT ON TABLE public.lifecycle_canary_runs IS
  'Daily GHL canary run log. One row per invocation. Purged after 90 days. '
  'Canary targets Sunfire Production (IQljfeWX6wWHmzUtgSyz) only — no Build. '
  'Authoritative trigger: OpenClaw cron at 08:30 CT (tz-aware). '
  'pg_cron ghl-canary-daily-backup fires at 13:30 UTC as fallback only.';

-- Drop and recreate the backup cron job.
-- Body is now empty ({}) — only Sunfire exists; no target param needed.
SELECT cron.unschedule('ghl-canary-daily-backup');

SELECT cron.schedule(
  'ghl-canary-daily-backup',
  '30 13 * * *',
  $$
  SELECT net.http_post(
    url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url')
               || '/ghl-canary',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key'
      )
    ),
    body    := '{}'::jsonb
  );
  $$
);
