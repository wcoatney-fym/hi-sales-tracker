/*
  # Normalize Agency Name Duplicates

  1. Data Corrections (form_submissions)
    - "Guide To Insure  Llc" (double space) -> "Guide To Insure Llc" (~323 rows)
    - "Guide To Insure LLC" (uppercase LLC) -> "Guide To Insure Llc" (~25 rows)
    - "Highland Health Direct  Llc" (double space) -> "Highland Health Direct Llc" (~142 rows)
    - "Wisechoice Senior Advisors  Llc" (double space) -> "Wisechoice Senior Advisors Llc" (~81 rows)

  2. Data Corrections (agents table)
    - Same normalizations applied to agents.agency column

  3. Important Notes
    - Only fixes whitespace and capitalization issues
    - No structural changes to schema
*/

-- form_submissions fixes
UPDATE form_submissions
SET agency = 'Guide To Insure Llc'
WHERE agency IN ('Guide To Insure  Llc', 'Guide To Insure LLC');

UPDATE form_submissions
SET agency = 'Highland Health Direct Llc'
WHERE agency = 'Highland Health Direct  Llc';

UPDATE form_submissions
SET agency = 'Wisechoice Senior Advisors Llc'
WHERE agency = 'Wisechoice Senior Advisors  Llc';

-- agents table fixes
UPDATE agents
SET agency = 'Guide To Insure Llc', updated_at = now()
WHERE agency IN ('Guide To Insure  Llc', 'Guide To Insure LLC');

UPDATE agents
SET agency = 'Highland Health Direct Llc', updated_at = now()
WHERE agency = 'Highland Health Direct  Llc';

UPDATE agents
SET agency = 'Wisechoice Senior Advisors Llc', updated_at = now()
WHERE agency = 'Wisechoice Senior Advisors  Llc';