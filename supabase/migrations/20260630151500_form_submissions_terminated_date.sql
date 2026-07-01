/*
  # Map the UNL Term Date onto form_submissions

  The terminated win-back lane auto-drops policies 45 days after they terminate
  so it stays a fresh, workable list. The UNL data source DOES carry the
  termination date (the "Term Date" / TERM_DATE column) — we just weren't
  importing it. This adds the column so the import can populate it and the lane
  can window on a real, source-provided date (no derived/guessed logic).

  Additive + reversible: one nullable date column. On the next import every
  terminated policy backfills its true Term Date from the source.
*/

ALTER TABLE form_submissions
  ADD COLUMN IF NOT EXISTS terminated_date date;

-- Window lookups on the terminated win-back lane.
CREATE INDEX IF NOT EXISTS idx_form_submissions_terminated_date
  ON form_submissions(agency_id, terminated_date)
  WHERE status = 'terminated';
