/*
  # Promote Wisechoice Roster Entries and Create Agent Records

  1. Changes
    - Insert 11 agents into `agents` table from Wisechoice agency_rosters entries that are currently unmatched
    - Set agency = 'Wisechoice Senior Advisors Llc', agency_id, agency_locked = true, source = 'Roster'
    - Update agency_rosters entries to match_status = 'confirmed' and link matched_agent_id

  2. Important Notes
    - These agents were uploaded via a Wisechoice agency roster but had no existing records in the system
    - They need to be recognized for intake form submission and data source attribution
    - NPN unique index is partial (non-empty only), so we handle potential conflicts
*/

-- Step 1: Insert agents from unmatched Wisechoice roster entries
-- Use a DO block to insert agents and then link them back to roster entries
DO $$
DECLARE
  wisechoice_agency_id uuid := '982f4e5d-cdff-4b25-bde2-e80c27c4274b';
  r RECORD;
  new_agent_id uuid;
BEGIN
  FOR r IN
    SELECT id, writing_number, carrier, agent_first_name, agent_last_name, npn
    FROM agency_rosters
    WHERE agency_id = wisechoice_agency_id
      AND status = 'active'
      AND match_status = 'unmatched'
  LOOP
    -- Check if agent already exists with this writing number
    SELECT a.id INTO new_agent_id
    FROM agents a
    WHERE a.unl_writing_number = r.writing_number
    LIMIT 1;

    IF new_agent_id IS NULL THEN
      -- Check if an agent exists with the same NPN (if NPN is provided)
      IF r.npn IS NOT NULL AND r.npn != '' THEN
        SELECT a.id INTO new_agent_id
        FROM agents a
        WHERE a.npn = r.npn
        LIMIT 1;
      END IF;
    END IF;

    IF new_agent_id IS NULL THEN
      -- Create new agent record
      INSERT INTO agents (first_name, last_name, npn, unl_writing_number, source, agency, agency_id, agency_locked, status)
      VALUES (
        r.agent_first_name,
        r.agent_last_name,
        r.npn,
        r.writing_number,
        'Roster',
        'Wisechoice Senior Advisors Llc',
        wisechoice_agency_id,
        true,
        'active'
      )
      RETURNING id INTO new_agent_id;
    ELSE
      -- Update existing agent to lock to Wisechoice
      UPDATE agents
      SET agency = 'Wisechoice Senior Advisors Llc',
          agency_id = wisechoice_agency_id,
          agency_locked = true,
          updated_at = now()
      WHERE id = new_agent_id;
    END IF;

    -- Link roster entry and mark confirmed
    UPDATE agency_rosters
    SET match_status = 'confirmed',
        matched_agent_id = new_agent_id,
        updated_at = now()
    WHERE id = r.id;
  END LOOP;
END $$;
