/*
  # Remove Book of Business (BoB) Feature

  1. Data Cleanup
    - Delete all form_submissions rows where source = 'Book of Business' (122 records)
    - These records are no longer needed as BoB upload is being removed

  2. Dropped Tables
    - `bob_records` - stored raw CSV records from BoB uploads
    - `bob_uploads` - tracked BoB upload history and metadata

  3. Function Updates
    - Replace `flag_duplicate_submissions` to remove 'Book of Business' from source checks
    - Only 'Intake Form' records are now checked for superseding by 'Data Source'

  4. Important Notes
    - The system now only accepts data from two sources: Intake Form and Data Source
    - All leaderboard, chart, and KPI data will be powered exclusively by these two sources
*/

-- Delete all Book of Business form_submissions
DELETE FROM form_submissions WHERE source = 'Book of Business';

-- Drop bob_records first (has FK to bob_uploads)
DROP TABLE IF EXISTS bob_records;

-- Drop bob_uploads
DROP TABLE IF EXISTS bob_uploads;

-- Drop and recreate the flag_duplicate_submissions function
DROP FUNCTION IF EXISTS flag_duplicate_submissions();

CREATE FUNCTION flag_duplicate_submissions()
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  true_dup_count int := 0;
  superseded_count int := 0;
BEGIN
  -- Reset all duplicate/superseded flags first
  UPDATE form_submissions
  SET status = 'active'
  WHERE status IN ('duplicate', 'superseded');

  -- Flag true duplicates within Data Source (same policy_number)
  WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY policy_number
             ORDER BY created_at ASC
           ) AS rn
    FROM form_submissions
    WHERE source = 'Data Source'
      AND policy_number IS NOT NULL
      AND policy_number != ''
  )
  UPDATE form_submissions fs
  SET status = 'duplicate'
  FROM ranked r
  WHERE fs.id = r.id AND r.rn > 1;

  GET DIAGNOSTICS true_dup_count = ROW_COUNT;

  -- Flag Intake Form records superseded by Data Source
  -- Match on: same agent_number + similar client last name + effective date within 14 days
  WITH superseded AS (
    SELECT DISTINCT fs.id
    FROM form_submissions fs
    INNER JOIN form_submissions ds
      ON ds.source = 'Data Source'
      AND ds.status NOT IN ('duplicate', 'superseded')
      AND LOWER(REGEXP_REPLACE(ds.agent_number, '[^a-zA-Z0-9]', '', 'g'))
        = LOWER(REGEXP_REPLACE(fs.agent_number, '[^a-zA-Z0-9]', '', 'g'))
      AND LOWER(REGEXP_REPLACE(ds.client_last_name, '\s+[A-Z]$', '', 'g'))
        = LOWER(REGEXP_REPLACE(fs.client_last_name, '\s+[A-Z]$', '', 'g'))
      AND ABS(ds.policy_effective_date::date - fs.policy_effective_date::date) <= 14
    WHERE fs.source = 'Intake Form'
      AND fs.status NOT IN ('duplicate', 'superseded')
  )
  UPDATE form_submissions
  SET status = 'superseded'
  FROM superseded s
  WHERE form_submissions.id = s.id;

  GET DIAGNOSTICS superseded_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'duplicates_flagged', true_dup_count,
    'superseded_flagged', superseded_count
  );
END;
$$;
