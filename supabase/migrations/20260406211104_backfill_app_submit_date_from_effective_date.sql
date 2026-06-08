/*
  # Backfill app_submit_date for existing records

  1. Changes
    - Sets `app_submit_date` on all `form_submissions` rows where it is currently NULL
    - Uses `policy_effective_date` as the primary fallback (most accurate date)
    - Falls back to `created_at::date` if `policy_effective_date` is also missing

  2. Reason
    - BoB-uploaded records were inserted without `app_submit_date`
    - Dashboard queries filter on `app_submit_date`, so NULL values are excluded
*/

UPDATE form_submissions
SET app_submit_date = COALESCE(policy_effective_date::date, created_at::date)
WHERE app_submit_date IS NULL;
