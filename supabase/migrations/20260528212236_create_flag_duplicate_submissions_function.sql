/*
  # Create duplicate detection and flagging function

  1. New Functions
    - `flag_duplicate_submissions()` - Detects and flags duplicate policies
    - `flag_superseded_by_data_source(p_source_upload_id uuid)` - Marks Intake Form/BoB records as superseded

  2. Important Notes
    - Data Source records with different policy_numbers for the same client are NOT duplicates
    - The 14-day window accounts for slight date variations between form entry and official records
    - Only one record per duplicate group is kept active (the newest, or the Data Source record)
*/

CREATE OR REPLACE FUNCTION flag_duplicate_submissions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  flagged_count integer := 0;
  additional_count integer := 0;
BEGIN
  -- Flag Intake Form and Book of Business records that are duplicates of each other
  WITH duplicate_groups AS (
    SELECT
      id,
      agent_number,
      LOWER(client_first_name) as fn,
      LOWER(client_last_name) as ln,
      zip,
      policy_effective_date,
      source,
      created_at,
      ROW_NUMBER() OVER (
        PARTITION BY agent_number, LOWER(client_first_name), LOWER(client_last_name), zip
        ORDER BY
          CASE WHEN source = 'Data Source' THEN 0 ELSE 1 END,
          created_at DESC
      ) as rn
    FROM form_submissions
    WHERE status NOT IN ('duplicate', 'superseded')
      AND (policy_number IS NULL OR policy_number = '')
  ),
  to_flag AS (
    SELECT d.id
    FROM duplicate_groups d
    INNER JOIN duplicate_groups keeper
      ON keeper.agent_number = d.agent_number
      AND keeper.fn = d.fn
      AND keeper.ln = d.ln
      AND keeper.zip = d.zip
      AND keeper.rn = 1
    WHERE d.rn > 1
      AND (
        d.policy_effective_date IS NULL
        OR keeper.policy_effective_date IS NULL
        OR ABS(d.policy_effective_date - keeper.policy_effective_date) <= 14
      )
  )
  UPDATE form_submissions
  SET status = 'duplicate', duplicate_flag = true
  WHERE id IN (SELECT id FROM to_flag)
    AND status NOT IN ('duplicate', 'superseded');

  GET DIAGNOSTICS flagged_count = ROW_COUNT;

  -- Also flag Data Source records with identical policy_numbers (true duplicates)
  WITH ds_duplicate_groups AS (
    SELECT
      id,
      policy_number,
      ROW_NUMBER() OVER (
        PARTITION BY policy_number
        ORDER BY created_at DESC
      ) as rn
    FROM form_submissions
    WHERE source = 'Data Source'
      AND status NOT IN ('duplicate', 'superseded')
      AND policy_number IS NOT NULL
      AND policy_number != ''
  ),
  ds_to_flag AS (
    SELECT id FROM ds_duplicate_groups WHERE rn > 1
  )
  UPDATE form_submissions
  SET status = 'duplicate', duplicate_flag = true
  WHERE id IN (SELECT id FROM ds_to_flag)
    AND status NOT IN ('duplicate', 'superseded');

  GET DIAGNOSTICS additional_count = ROW_COUNT;

  RETURN flagged_count + additional_count;
END;
$$;

-- Function to supersede Intake Form/BoB records when Data Source confirms them
CREATE OR REPLACE FUNCTION flag_superseded_by_data_source(p_source_upload_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  superseded_count integer := 0;
BEGIN
  WITH data_source_records AS (
    SELECT DISTINCT
      agent_number,
      LOWER(client_first_name) as fn,
      LOWER(client_last_name) as ln,
      zip
    FROM form_submissions
    WHERE source = 'Data Source'
      AND status NOT IN ('duplicate', 'superseded')
      AND (p_source_upload_id IS NULL OR source_upload_id = p_source_upload_id)
  ),
  to_supersede AS (
    SELECT fs.id
    FROM form_submissions fs
    INNER JOIN data_source_records ds
      ON fs.agent_number = ds.agent_number
      AND LOWER(fs.client_first_name) = ds.fn
      AND LOWER(fs.client_last_name) = ds.ln
      AND fs.zip = ds.zip
    WHERE fs.source IN ('Intake Form', 'Book of Business')
      AND fs.status NOT IN ('duplicate', 'superseded')
  )
  UPDATE form_submissions
  SET status = 'superseded', duplicate_flag = true
  WHERE id IN (SELECT id FROM to_supersede);

  GET DIAGNOSTICS superseded_count = ROW_COUNT;

  RETURN superseded_count;
END;
$$;
