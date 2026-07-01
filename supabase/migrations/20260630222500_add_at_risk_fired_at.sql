/*
  # Track at-risk fire state on form_submissions

  1. Schema
    - `form_submissions.at_risk_fired_at` (timestamptz, nullable)
      Timestamp the derived "at risk" lifecycle event last fired for this
      policy. NULL = not currently flagged.

  2. Why
    - The UNL pull is a daily full-state refresh. The lifecycle evaluator must
      push the derived "at risk" event only on flip-true, or every at-risk
      policy re-blasts the Zap every day. This column persists that fired state
      so the evaluator can dedupe across daily pulls and clear it when a policy
      recovers (so it can legitimately re-fire later).

  3. Notes
    - Additive + nullable + reversible. No backfill: existing at-risk policies
      simply fire once on the next pull, which is the desired behavior.
*/

ALTER TABLE public.form_submissions
  ADD COLUMN IF NOT EXISTS at_risk_fired_at timestamptz;

COMMENT ON COLUMN public.form_submissions.at_risk_fired_at IS
  'When the derived "at risk" lifecycle Zap last fired for this policy. NULL = not currently flagged. Set/cleared by sql-import-cron so the daily full-state pull does not re-blast at-risk events.';
