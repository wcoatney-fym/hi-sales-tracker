/*
  # Capture terminated_at on form_submissions (data-source-faithful)

  The manager terminated win-back lane should auto-drop policies 45 days after
  they terminate, so it stays a fresh, workable list instead of a years-deep
  graveyard. The imported UNL data carries NO termination date (only
  effective / submit / paid-to dates + a status code), so we can't time-window
  terminations from the source columns directly.

  This records `terminated_at` by OBSERVING the data source over time (not by
  deriving a guessed date): a trigger stamps `terminated_at = now()` the first
  time a row's status becomes 'terminated', and clears it if the policy ever
  leaves terminated (e.g. reinstated). That timestamp = "first daily import in
  which UNL reported this policy terminated", which is the right anchor for the
  45-day window.

  Caveat: existing terminated rows pre-date the trigger and have NULL
  `terminated_at`. They are therefore excluded from the 45-day window until a
  fresh status transition is observed. We intentionally do NOT backfill a
  derived date (that would be the guess logic we agreed to avoid). If a
  one-time seed is wanted later, do it explicitly and visibly.

  Additive + reversible: one nullable column + one trigger. No data rewrite.
*/

ALTER TABLE form_submissions
  ADD COLUMN IF NOT EXISTS terminated_at timestamptz;

CREATE OR REPLACE FUNCTION set_form_submission_terminated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'terminated' THEN
    -- First time we observe this policy as terminated, stamp it. Preserve an
    -- existing stamp across subsequent imports that keep it terminated.
    IF NEW.terminated_at IS NULL
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'terminated' OR OLD.terminated_at IS NULL)
    THEN
      NEW.terminated_at := COALESCE(OLD.terminated_at, now());
    ELSIF TG_OP = 'UPDATE' THEN
      NEW.terminated_at := COALESCE(NEW.terminated_at, OLD.terminated_at, now());
    END IF;
  ELSE
    -- Left terminated (reinstated / status corrected): clear the stamp.
    NEW.terminated_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_terminated_at ON form_submissions;
CREATE TRIGGER trg_set_terminated_at
  BEFORE INSERT OR UPDATE ON form_submissions
  FOR EACH ROW
  EXECUTE FUNCTION set_form_submission_terminated_at();

-- Window lookups on the terminated win-back lane.
CREATE INDEX IF NOT EXISTS idx_form_submissions_terminated_at
  ON form_submissions(agency_id, terminated_at)
  WHERE status = 'terminated';
