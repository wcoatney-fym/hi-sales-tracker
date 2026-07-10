-- Upsert the lifecycle_cron_key in Supabase Vault so pg_cron can read it.
-- Value must match the LIFECYCLE_CRON_KEY function secret.
-- This migration is re-runnable: updates if exists, creates if not.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'lifecycle_cron_key') THEN
    UPDATE vault.secrets SET secret = '4043b25b1eaa06a00e5f260e660331a3fb197196b6f0777625cd3226c57d8dce' WHERE name = 'lifecycle_cron_key';
  ELSE
    PERFORM vault.create_secret('4043b25b1eaa06a00e5f260e660331a3fb197196b6f0777625cd3226c57d8dce', 'lifecycle_cron_key');
  END IF;
END$$;
