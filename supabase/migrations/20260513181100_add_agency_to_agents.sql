/*
  # Add agency column to agents table

  1. Modified Tables
    - `agents`
      - Added `agency` (text, nullable) - Stores the agent's agency assignment (e.g., "FYM" for directs, or the Downline Agency name)

  2. Notes
    - Existing agents will have NULL agency until populated via data source sync or manual edit
    - No default value; agency is determined at integration time from data source records
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agents' AND column_name = 'agency'
  ) THEN
    ALTER TABLE agents ADD COLUMN agency text;
  END IF;
END $$;