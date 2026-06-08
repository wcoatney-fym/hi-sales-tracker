/*
  # Merge Multi-Number Agents and Populate Writing Number Aliases

  Problem: 31 agents have multiple writing numbers (carrier reassigned numbers).
  The leaderboard groups by agent_number, causing these agents to appear multiple times.

  Fix:
  1. Identify canonical writing number per agent (most recent by app_submit_date)
  2. Update form_submissions to canonical number
  3. Populate agent_writing_numbers alias table
  4. Consolidate duplicate agents table records
*/

-- Step 1: Create a temp table with canonical number per multi-number agent
CREATE TEMP TABLE multi_number_agents AS
WITH multi AS (
  SELECT lower(trim(agent_first_name || ' ' || agent_last_name)) as agent_name,
         agency,
         array_agg(DISTINCT agent_number ORDER BY agent_number) as all_numbers
  FROM form_submissions
  WHERE duplicate_flag = false
    AND agent_number IS NOT NULL AND agent_number != ''
  GROUP BY lower(trim(agent_first_name || ' ' || agent_last_name)), agency
  HAVING count(DISTINCT agent_number) > 1
),
canonical AS (
  SELECT DISTINCT ON (lower(trim(fs.agent_first_name || ' ' || fs.agent_last_name)), fs.agency)
    lower(trim(fs.agent_first_name || ' ' || fs.agent_last_name)) as agent_name,
    fs.agency,
    fs.agent_number as canonical_number,
    fs.agent_first_name as first_name,
    fs.agent_last_name as last_name
  FROM form_submissions fs
  JOIN multi m ON lower(trim(fs.agent_first_name || ' ' || fs.agent_last_name)) = m.agent_name
    AND fs.agency = m.agency
  WHERE fs.app_submit_date IS NOT NULL
  ORDER BY lower(trim(fs.agent_first_name || ' ' || fs.agent_last_name)), fs.agency, fs.app_submit_date DESC
)
SELECT c.agent_name, c.agency, c.canonical_number, c.first_name, c.last_name, m.all_numbers
FROM canonical c
JOIN multi m ON c.agent_name = m.agent_name AND c.agency = m.agency;

-- Step 2: Update form_submissions to use canonical writing number
UPDATE form_submissions fs
SET agent_number = mna.canonical_number
FROM multi_number_agents mna
WHERE lower(trim(fs.agent_first_name || ' ' || fs.agent_last_name)) = mna.agent_name
  AND fs.agency = mna.agency
  AND fs.agent_number != mna.canonical_number;

-- Also fix intake form submissions (no agency set) for these agents
UPDATE form_submissions fs
SET agent_number = mna.canonical_number
FROM multi_number_agents mna
WHERE lower(trim(fs.agent_first_name || ' ' || fs.agent_last_name)) = mna.agent_name
  AND fs.agency IS NULL
  AND fs.source = 'Intake Form'
  AND fs.agent_number != mna.canonical_number
  AND fs.agent_number = ANY(mna.all_numbers);

-- Step 3: Populate agent_writing_numbers with all aliases
-- Use a lateral unnest to get one row per number per agent
INSERT INTO agent_writing_numbers (id, agent_id, agency_id, carrier_name, writing_number, created_at)
SELECT
  gen_random_uuid(),
  a.id,
  ag.id,
  'UNL',
  num.writing_number,
  now()
FROM multi_number_agents mna
CROSS JOIN LATERAL unnest(mna.all_numbers) AS num(writing_number)
JOIN agents a ON lower(trim(a.first_name || ' ' || a.last_name)) = mna.agent_name
  AND a.agency = mna.agency
  AND a.unl_writing_number = mna.canonical_number
JOIN agencies ag ON ag.name = mna.agency
ON CONFLICT DO NOTHING;

-- Step 4: For agents where canonical record doesn't exist yet, update one of the dupes
UPDATE agents a
SET unl_writing_number = mna.canonical_number,
    updated_at = now()
FROM multi_number_agents mna
WHERE lower(trim(a.first_name || ' ' || a.last_name)) = mna.agent_name
  AND a.agency = mna.agency
  AND a.unl_writing_number != mna.canonical_number
  AND NOT EXISTS (
    SELECT 1 FROM agents a2
    WHERE lower(trim(a2.first_name || ' ' || a2.last_name)) = mna.agent_name
      AND a2.agency = mna.agency
      AND a2.unl_writing_number = mna.canonical_number
  );

-- Step 5: Delete duplicate agents records (keep only the one with canonical number)
DELETE FROM agents a
USING multi_number_agents mna
WHERE lower(trim(a.first_name || ' ' || a.last_name)) = mna.agent_name
  AND a.agency = mna.agency
  AND a.unl_writing_number != mna.canonical_number
  AND EXISTS (
    SELECT 1 FROM agents a2
    WHERE lower(trim(a2.first_name || ' ' || a2.last_name)) = mna.agent_name
      AND a2.agency = mna.agency
      AND a2.unl_writing_number = mna.canonical_number
  );

DROP TABLE multi_number_agents;