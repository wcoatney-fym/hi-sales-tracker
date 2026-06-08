/*
  # Backfill Agents Agency to FYM

  1. Changes
    - Sets `agency` to 'FYM' for all existing agents where agency is NULL or empty
    - These are all direct-to-FYM agents from the Contracting Portal and Roster sources

  2. Important Notes
    - Non-destructive: only fills in missing values
    - All existing agents without an explicit downline agency are FYM direct agents
*/

UPDATE agents SET agency = 'FYM', updated_at = now()
WHERE agency IS NULL OR agency = '';
