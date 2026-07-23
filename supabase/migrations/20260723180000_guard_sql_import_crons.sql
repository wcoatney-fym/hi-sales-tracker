-- Retire sql-import cron jobs (pipeline retired 2026-07-23, Charlie).
--
-- The sql-import-cron pipeline that synced Max's DB → form_submissions is
-- permanently retired. All metrics now read directly from Max's production DB
-- via quality-metrics-direct, lifecycle-direct, and admin-api edge functions.
--
-- This migration idempotently removes both sql-import cron jobs so they cannot
-- be accidentally re-registered by a future db push. Safe to re-run: the
-- exception handler swallows "not found" errors.
--
-- Replaces the original guard migration (PR #142) which re-registered the jobs.
-- Since the pipeline is retired, re-registration is the wrong behavior.

DO $$ BEGIN PERFORM cron.unschedule('sql-import-daily'); EXCEPTION WHEN others THEN NULL; END; $$;
DO $$ BEGIN PERFORM cron.unschedule('sql-import-poll'); EXCEPTION WHEN others THEN NULL; END; $$;
