-- The action check only allowed the CSV-era values, so every auto-import and
-- reconciliation log insert has silently failed since the cron pipeline existed.
ALTER TABLE upload_history_log DROP CONSTRAINT upload_history_log_action_check;
ALTER TABLE upload_history_log ADD CONSTRAINT upload_history_log_action_check
  CHECK (action = ANY (ARRAY[
    'upload', 'replace', 'supersede',
    'auto_import_init', 'auto_import_complete', 'auto_import_error', 'auto_import_paused',
    'reconciliation_complete', 'reconciliation_aborted'
  ]));
