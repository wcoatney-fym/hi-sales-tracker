/*
  # Add NPN (National Producer Number) to agent rosters

  1. Modified Tables
    - `agent_rosters`
      - Added `npn` (text) - National Producer Number, optional, defaults to empty string

  2. Notes
    - NPN is optional since not all roster CSVs will include it
    - Existing rows will have an empty string as their NPN value
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agent_rosters' AND column_name = 'npn'
  ) THEN
    ALTER TABLE agent_rosters ADD COLUMN npn text NOT NULL DEFAULT '';
  END IF;
END $$;
