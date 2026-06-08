/*
  # Strip middle initials from form_submissions agent_last_name

  1. Modified Tables
    - `form_submissions`: Remove middle initial prefix from `agent_last_name`
      for all rows where the pattern is a single letter (optionally with period)
      followed by a space and then the actual surname

  2. Affected Records (~84 rows)
    - "A Cole" -> "Cole" (42 rows)
    - "B Mitchell" -> "Mitchell" (6 rows)
    - "B Mitchll" -> "Mitchell" (1 row, also fixes typo)
    - "D Alfaro" -> "Alfaro" (7 rows)
    - "D Bill" -> "Bill" (1 row)
    - "D Jones" -> "Jones" (1 row)
    - "E Poole" -> "Poole" (9 rows)
    - "J Webber" -> "Webber" (2 rows)
    - "L. Cathcart" -> "Cathcart" (1 row)
    - "M Voorhees" -> "Voorhees" (1 row)
    - "O Redding" -> "Redding" (8 rows)
    - "S Canady" -> "Canady" (4 rows)
    - "Michael Goldberg" -> "Goldberg" (1 row)

  3. Important Notes
    - The regex strips patterns like "X " or "X. " at the start of last_name
    - The typo "B Mitchll" is separately corrected to "Mitchell"
    - Connor's "Michael Goldberg" is handled explicitly
*/

UPDATE form_submissions
SET agent_last_name = REGEXP_REPLACE(agent_last_name, '^[A-Za-z]\.?\s+', '')
WHERE agent_last_name ~ '^[A-Za-z]\.?\s+\w';

UPDATE form_submissions
SET agent_last_name = 'Mitchell'
WHERE agent_last_name = 'Mitchll';

UPDATE form_submissions
SET agent_last_name = 'Goldberg'
WHERE agent_first_name = 'Connor' AND agent_last_name = 'Michael Goldberg';
