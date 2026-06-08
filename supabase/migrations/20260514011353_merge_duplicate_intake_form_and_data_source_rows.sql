/*
  # Merge Duplicate Intake Form and Data Source Submissions

  1. Problem
    - When an agent submits through the Intake Form, a row is created with policy_number = NULL
    - When the same policy arrives via Data Source upload, a second row is created with a real policy_number
    - Both rows represent the same client/policy but are counted separately on the leaderboard

  2. Fix
    - Find Intake Form rows that have a matching Data Source row (same agent_number + same client name)
    - Pick only one Intake Form row per Data Source row (handles edge case of duplicate intake submissions)
    - Delete the Data Source row to free the unique constraint, then update the Intake Form row
    - Mark remaining unmatched duplicate Intake Form rows for the same client as 'Duplicate'

  3. Scope
    - 39 known duplicate pairs across all agents
    - Affects leaderboard counts for May 2026 and prior months
*/

DO $$
DECLARE
  merged_count integer := 0;
  r record;
BEGIN
  -- Use DISTINCT ON to pick exactly one intake row per data source row
  FOR r IN
    SELECT DISTINCT ON (fs_data.id)
      fs_intake.id AS intake_id,
      fs_data.id AS data_id,
      fs_data.policy_number,
      fs_data.status AS data_status,
      fs_data.agency AS data_agency,
      fs_data.carrier AS data_carrier,
      fs_data.plan_name AS data_plan_name,
      fs_data.plan_premium AS data_premium,
      fs_data.policy_effective_date AS data_effective_date,
      fs_data.policy_report_upload_id
    FROM form_submissions fs_intake
    JOIN form_submissions fs_data
      ON fs_intake.agent_number = fs_data.agent_number
      AND lower(trim(fs_intake.client_first_name)) = lower(trim(fs_data.client_first_name))
      AND lower(trim(fs_intake.client_last_name)) = lower(trim(fs_data.client_last_name))
      AND fs_intake.source = 'Intake Form'
      AND fs_data.source = 'Data Source'
      AND fs_intake.id != fs_data.id
      AND fs_intake.policy_number IS NULL
      AND fs_data.policy_number IS NOT NULL
    ORDER BY fs_data.id, fs_intake.created_at ASC
  LOOP
    -- Delete the Data Source row first to free the unique policy_number
    DELETE FROM form_submissions WHERE id = r.data_id;

    -- Update the Intake Form row with Data Source details
    UPDATE form_submissions
    SET
      policy_number = r.policy_number,
      status = r.data_status,
      agency = r.data_agency,
      carrier = CASE WHEN r.data_carrier != '' THEN r.data_carrier ELSE carrier END,
      plan_name = CASE WHEN r.data_plan_name != '' THEN r.data_plan_name ELSE plan_name END,
      plan_premium = CASE WHEN r.data_premium > 0 THEN r.data_premium ELSE plan_premium END,
      policy_effective_date = COALESCE(r.data_effective_date, policy_effective_date),
      policy_report_upload_id = r.policy_report_upload_id,
      source = 'Merged'
    WHERE id = r.intake_id;

    merged_count := merged_count + 1;
  END LOOP;

  RAISE NOTICE 'Merged % duplicate pairs', merged_count;
END $$;

-- Mark remaining duplicate Intake Form rows (same agent + same client, already merged above)
-- These are true duplicates submitted by the agent multiple times
UPDATE form_submissions fs1
SET status = 'duplicate'
WHERE fs1.source = 'Intake Form'
  AND fs1.policy_number IS NULL
  AND EXISTS (
    SELECT 1 FROM form_submissions fs2
    WHERE fs2.agent_number = fs1.agent_number
      AND lower(trim(fs2.client_first_name)) = lower(trim(fs1.client_first_name))
      AND lower(trim(fs2.client_last_name)) = lower(trim(fs1.client_last_name))
      AND fs2.source = 'Merged'
      AND fs2.id != fs1.id
  );
