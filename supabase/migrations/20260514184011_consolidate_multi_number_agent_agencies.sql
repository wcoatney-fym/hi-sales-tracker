/*
  # Consolidate Multi-Number Agent Agencies

  1. Logic
    - For agents who appear with multiple writing numbers, determine their "current" agency
      based on the downline agency from their most recent form submission
    - If the most recent submission has no downline agency, default to FYM
    - Update ALL agent table entries for that person to the determined agency
    - Lock the agency so future imports don't override

  2. Affected Agents (33 total)
    - Most are FYM agents who transitioned to Wisechoice Senior Advisors Llc
    - A few are Guardian Benefits agents with updated writing numbers
    - Agents like Anthony Crosby, Fawn Alfaro, Kevin Lindsey stay as FYM (most recent is FYM)

  3. Important Notes
    - form_submissions.agency is NOT changed here -- each policy row already has
      the correct per-row agency from its data source downline field
    - Only the agents table is updated so the agent appears under one consistent agency
    - agency_locked is set to true to prevent future imports from reverting this
*/

-- Update all agent rows for multi-number agents to their most-recent agency
WITH dual_agent_names AS (
  SELECT LOWER(TRIM(agent_first_name || ' ' || agent_last_name)) as agent_name
  FROM form_submissions
  WHERE agent_first_name IS NOT NULL AND agent_first_name != ''
    AND agent_number IS NOT NULL AND agent_number != ''
  GROUP BY LOWER(TRIM(agent_first_name || ' ' || agent_last_name))
  HAVING COUNT(DISTINCT agent_number) > 1
),
latest_agency AS (
  SELECT DISTINCT ON (LOWER(TRIM(fs.agent_first_name || ' ' || fs.agent_last_name)))
    LOWER(TRIM(fs.agent_first_name || ' ' || fs.agent_last_name)) as agent_name,
    fs.agency as target_agency
  FROM form_submissions fs
  JOIN dual_agent_names da ON LOWER(TRIM(fs.agent_first_name || ' ' || fs.agent_last_name)) = da.agent_name
  WHERE fs.app_submit_date IS NOT NULL
  ORDER BY LOWER(TRIM(fs.agent_first_name || ' ' || fs.agent_last_name)), fs.app_submit_date DESC
)
UPDATE agents a
SET agency = la.target_agency,
    agency_locked = true,
    updated_at = now()
FROM latest_agency la
WHERE LOWER(TRIM(a.first_name || ' ' || a.last_name)) = la.agent_name
  AND a.agency IS DISTINCT FROM la.target_agency;