/*
  # Backfill NULL Agency to FYM

  1. Problem
    - 198 form_submissions rows have agency = NULL
    - Per business rule: FYM is the default agency for all submissions unless
      the agent has a specific Downline Agency assigned

  2. Fix
    - For submissions where the agent exists in the agents table with a non-empty agency,
      use that agent's agency
    - For all remaining NULL agency submissions, default to 'FYM'

  3. Scope
    - ~198 form_submissions rows
    - No data loss, only filling in missing values
*/

-- First: set agency from the agents table where agent has a known agency
UPDATE form_submissions fs
SET agency = a.agency
FROM agents a
WHERE fs.agent_number = a.unl_writing_number
  AND fs.agency IS NULL
  AND a.agency IS NOT NULL
  AND a.agency != '';

-- Second: default remaining NULL agency to FYM
UPDATE form_submissions
SET agency = 'FYM'
WHERE agency IS NULL;
