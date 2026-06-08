/*
  # Add agency_locked flag to agents table

  1. Modified Tables
    - `agents`
      - Added `agency_locked` (boolean, default false) - When true, prevents automated data source uploads from overwriting the agency value

  2. Notes
    - This flag is set to true when an admin manually edits an agent's agency
    - Data source imports will skip agency updates for locked agents
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agents' AND column_name = 'agency_locked'
  ) THEN
    ALTER TABLE agents ADD COLUMN agency_locked boolean DEFAULT false NOT NULL;
  END IF;
END $$;
