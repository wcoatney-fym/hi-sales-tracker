/*
  # Fix Wisechoice Agent Writing Number Prefix

  1. Data Fix
    - 4 agents in the Wisechoice agency roster have writing numbers missing the "202" prefix
    - Ryan Martin: NBL00 → 202NBL00
    - Ryam Martin (terminated): NBL00 → 202NBL00
    - George Williams: NBA00 → 202NBA00
    - Brian Jenkins: NAP00 → 202NAP00

  2. Affected Table
    - `agency_rosters` - 4 rows updated by ID
*/

UPDATE agency_rosters
SET writing_number = '202' || writing_number,
    updated_at = now()
WHERE id IN (
  'ce2bb20b-f949-4426-84fe-ca7f07f75f43',
  '9eab471f-ac23-4bfb-802e-f836a0912790',
  '0bc3607e-410c-455a-9fdb-2f32e16fff01',
  '77b708bd-f875-48e0-8aef-65416a5709e9'
);