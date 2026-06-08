/*
  # Fix Writing Number 202JVVJF Agent Assignment

  1. Problem
    - Writing number 202JVVJF belongs to Anna Callahan per the carrier data source
    - The agents table and some form_submissions incorrectly list Charlene Stoops as the agent
    - Charlene Stoops is actually a client of Anna Callahan (she appears in source_records as a client)

  2. Fix
    - Update the agents table to show Anna Callahan as the owner of this writing number
    - Update the Book of Business form_submissions to reflect Anna Callahan as the agent

  3. Scope
    - 1 agent record
    - 2 Book of Business form_submissions rows
*/

-- Update agents table
UPDATE agents
SET first_name = 'Anna', last_name = 'Callahan'
WHERE unl_writing_number = '202JVVJF';

-- Update form_submissions with incorrect agent name
UPDATE form_submissions
SET agent_first_name = 'Anna', agent_last_name = 'Callahan'
WHERE agent_number = '202JVVJF'
  AND agent_first_name = 'Charlene'
  AND agent_last_name = 'Stoops';
