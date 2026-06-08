/*
  # Fix Agent Name Spelling Errors

  1. Data Corrections (form_submissions)
    - "Henryk Kupczyk" -> "Henry Kupczyk" (agent_number 202JVVJY)
    - "Barbie Howard" -> "Barbara Howard" (agent_number 202JVVJ5)

  2. Data Corrections (agents table)
    - Same name fixes applied to agents.first_name

  3. Important Notes
    - These are the same physical agents with informal name variants in some data sources
    - Agent numbers remain unchanged
*/

-- form_submissions fixes
UPDATE form_submissions
SET agent_first_name = 'Henry'
WHERE agent_number = '202JVVJY' AND agent_first_name = 'Henryk';

UPDATE form_submissions
SET agent_first_name = 'Barbara'
WHERE agent_number = '202JVVJ5' AND agent_first_name = 'Barbie';

-- agents table fixes
UPDATE agents
SET first_name = 'Henry', updated_at = now()
WHERE unl_writing_number = '202JVVJY' AND first_name = 'Henryk';

UPDATE agents
SET first_name = 'Barbara', updated_at = now()
WHERE unl_writing_number = '202JVVJ5' AND first_name = 'Barbie';