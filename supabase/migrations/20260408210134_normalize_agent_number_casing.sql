/*
  # Normalize writing number casing to uppercase

  1. Modified Tables
    - `form_submissions`: Uppercase all `agent_number` values
    - `agents`: Uppercase all `unl_writing_number` and `gtl_writing_number` values
    - `agent_rosters`: Uppercase all `agent_number` values

  2. Important Notes
    - Several records had lowercase writing numbers (e.g., "202jvvec", "202jvv80")
      which caused duplicate entries in agent dropdowns
    - This normalizes all existing data to uppercase for consistency
*/

UPDATE form_submissions
SET agent_number = UPPER(agent_number)
WHERE agent_number <> UPPER(agent_number);

UPDATE agents
SET unl_writing_number = UPPER(unl_writing_number),
    gtl_writing_number = UPPER(gtl_writing_number)
WHERE unl_writing_number <> UPPER(unl_writing_number)
   OR gtl_writing_number <> UPPER(gtl_writing_number);

UPDATE agent_rosters
SET agent_number = UPPER(agent_number)
WHERE agent_number <> UPPER(agent_number);
