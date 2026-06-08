/*
  # Fix Non-Data-Source Agent Agencies

  1. Changes
    - Sets agency to 'FYM' for all agents where source is NOT 'Data Source'
      and agency is NULL, empty, or incorrectly set to the agent's own name
    - Covers Roster, Book of Business, Contracting Portal, and Manual sources

  2. Important Notes
    - Non-destructive: only corrects agents that should default to FYM
    - Data Source agents are left untouched (their agency comes from production data)
    - Contracting Portal agents already backfilled to FYM remain unchanged
*/

UPDATE agents
SET agency = 'FYM', updated_at = now()
WHERE source != 'Data Source'
  AND (
    agency IS NULL
    OR agency = ''
    OR agency = CONCAT(first_name, ' ', last_name)
  );
