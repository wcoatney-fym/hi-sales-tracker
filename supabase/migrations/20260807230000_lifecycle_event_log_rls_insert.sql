-- Fix: lifecycle_event_log has RLS enabled with only a service_role policy.
-- lifecycle-direct authenticates with the publishable key (anon role), so
-- every INSERT is silently rejected. Add a public INSERT policy matching the
-- pattern used by lifecycle_cron_runs.
--
-- Root cause: 0 audit-log entries written since 2026-07-19 despite 490+
-- successful GHL pushes. fired_triggers (RLS disabled) and lifecycle_cron_runs
-- (public INSERT policy) were unaffected.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'lifecycle_event_log'
      AND policyname = 'anon_insert_lifecycle_event_log'
  ) THEN
    EXECUTE 'CREATE POLICY anon_insert_lifecycle_event_log ON public.lifecycle_event_log FOR INSERT TO public WITH CHECK (true)';
  END IF;
END $$;
