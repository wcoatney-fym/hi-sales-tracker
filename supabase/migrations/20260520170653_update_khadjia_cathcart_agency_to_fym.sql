/*
  # Update Khadjia Cathcart's agency to FYM

  1. Changes
    - Sets agency to 'FYM' for agent Khadjia Cathcart
    - Locks the agency assignment to prevent automated overwrite
*/

UPDATE agents
SET agency = 'FYM', agency_locked = true, updated_at = now()
WHERE id = '3cdd34c8-4c3a-476b-a94e-2a8362e83cc2';