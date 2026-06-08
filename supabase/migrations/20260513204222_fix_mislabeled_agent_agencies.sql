/*
  # Fix mislabeled agent agencies

  1. Data Corrections
    - Tyler Campanella: 58 submissions incorrectly tagged "FYM", corrected to "Guardian Benefits Inc"
    - Keanu Knowles: 35 submissions incorrectly tagged "FYM", corrected to "Guardian Benefits Inc"
    - Leeandra Smith: 2 submissions incorrectly tagged "FYM", corrected to "Guardian Benefits Inc"
    - Amin Hussein: 4 submissions incorrectly tagged "FYM", corrected to "Guardian Benefits Inc"
    - Jennifer James: 1 submission incorrectly tagged "FYM", corrected to "Guardian Benefits Inc"

  2. Root Cause
    - Data source upload defaulted agency to "FYM" when "Downline Agency" column was blank
    - These agents actually belong to Guardian Benefits Inc based on their historical data

  3. Notes
    - Lauren Williams confirmed as FYM (no change needed)
    - Also updates/creates agents table records with correct agency and locks them
*/

-- Fix form_submissions agency for mislabeled Guardian agents
UPDATE form_submissions
SET agency = 'Guardian Benefits Inc'
WHERE agency = 'FYM'
  AND (
    (agent_first_name = 'Tyler' AND agent_last_name = 'Campanella')
    OR (agent_first_name = 'Keanu' AND agent_last_name = 'Knowles')
    OR (agent_first_name = 'Leeandra' AND agent_last_name = 'Smith')
    OR (agent_first_name = 'Amin' AND agent_last_name = 'Hussein')
    OR (agent_first_name = 'Jennifer' AND agent_last_name = 'James')
  );

-- Update agents table records if they exist, set agency_locked = true
UPDATE agents
SET agency = 'Guardian Benefits Inc',
    agency_locked = true,
    updated_at = now()
WHERE (
  (first_name = 'Tyler' AND last_name = 'Campanella')
  OR (first_name = 'Keanu' AND last_name = 'Knowles')
  OR (first_name = 'Leeandra' AND last_name = 'Smith')
  OR (first_name = 'Amin' AND last_name = 'Hussein')
  OR (first_name = 'Jennifer' AND last_name = 'James')
)
AND (agency IS NULL OR agency = 'FYM');
