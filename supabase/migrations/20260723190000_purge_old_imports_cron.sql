-- Purge old import artifacts (source_uploads + source_records) older than 7 days.
--
-- The sql-import pipeline creates a new source_upload + ~42K source_records per
-- import run. Only the most recent upload matters (it tags form_submissions rows
-- via source_upload_id for reconciliation). Older uploads and their staging rows
-- are dead weight.
--
-- This cron job runs daily at 05:00 UTC (midnight CT) and deletes:
--   1. source_records tied to uploads older than 7 days
--   2. the source_uploads rows themselves
--   3. upload_history_log entries older than 30 days (audit noise)
--
-- Safe to re-run: idempotent (unschedule + reschedule pattern).

DO $$ BEGIN PERFORM cron.unschedule('purge-old-imports'); EXCEPTION WHEN others THEN NULL; END; $$;

SELECT cron.schedule(
  'purge-old-imports',
  '0 5 * * *',
  $$
  -- Delete staging rows for old uploads first (FK dependency)
  DELETE FROM source_records
  WHERE source_upload_id IN (
    SELECT id FROM source_uploads
    WHERE created_at < now() - interval '7 days'
  );

  -- Delete the old upload records
  DELETE FROM source_uploads
  WHERE created_at < now() - interval '7 days';

  -- Trim old upload history log entries (keep 30 days)
  DELETE FROM upload_history_log
  WHERE created_at < now() - interval '30 days';
  $$
);
