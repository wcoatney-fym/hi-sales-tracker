/*
  # Normalize Agent Name Spacing and Casing in Form Submissions

  1. Problem
    - Some agent names have double spaces (e.g. "Braylon  Redding")
    - Some agent names are all lowercase (e.g. "max goepper")
    - Inconsistent casing causes the leaderboard to split the same agent into multiple entries

  2. Fix
    - Trim extra internal whitespace from agent_first_name and agent_last_name
    - Apply proper case (capitalize first letter of each word) to agent names
    - Only update rows where changes are needed

  3. Scope
    - All form_submissions rows with extra spaces or incorrect casing
*/

-- Fix double/extra spaces in agent names
UPDATE form_submissions
SET agent_first_name = regexp_replace(trim(agent_first_name), '\s+', ' ', 'g')
WHERE agent_first_name ~ '\s{2,}' OR agent_first_name != trim(agent_first_name);

UPDATE form_submissions
SET agent_last_name = regexp_replace(trim(agent_last_name), '\s+', ' ', 'g')
WHERE agent_last_name ~ '\s{2,}' OR agent_last_name != trim(agent_last_name);

-- Apply proper case to agent names that are all lowercase or all uppercase
UPDATE form_submissions
SET agent_first_name = initcap(agent_first_name)
WHERE agent_first_name = lower(agent_first_name)
  AND agent_first_name != '';

UPDATE form_submissions
SET agent_last_name = initcap(agent_last_name)
WHERE agent_last_name = lower(agent_last_name)
  AND agent_last_name != '';

-- Also fix client names with extra spaces
UPDATE form_submissions
SET client_first_name = regexp_replace(trim(client_first_name), '\s+', ' ', 'g')
WHERE client_first_name ~ '\s{2,}' OR client_first_name != trim(client_first_name);

UPDATE form_submissions
SET client_last_name = regexp_replace(trim(client_last_name), '\s+', ' ', 'g')
WHERE client_last_name ~ '\s{2,}' OR client_last_name != trim(client_last_name);
