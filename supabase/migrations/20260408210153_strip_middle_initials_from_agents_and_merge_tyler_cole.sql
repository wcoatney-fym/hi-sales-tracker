/*
  # Strip middle initials from agents table and merge duplicate Tyler Cole

  1. Modified Tables
    - `agents`: Remove middle initials from `last_name` for 7 agents
    - `agents`: Delete duplicate Tyler Cole record (NPN 18308252, BoB source)
      keeping the canonical record (NPN 18408252, Roster source with both writing numbers)

  2. Agents Updated
    - Tyler "A Cole" -> "Cole" (the BoB duplicate is deleted entirely)
    - Michael "B Mitchell" -> "Mitchell"
    - Ashley "M Voorhees" -> "Voorhees"
    - Braylon "O Redding" -> "Redding"
    - Dwight "J Webber" -> "Webber"
    - Victoria "D Jones" -> "Jones"
    - Connor "Michael Goldberg" -> "Goldberg"

  3. Important Notes
    - The canonical Tyler Cole (id ecff4846) has NPN 18408252 and both UNL/GTL numbers
    - The duplicate (id 6fbf386d) had an incorrect NPN (18308252) and no GTL number
    - No foreign keys reference the agents table, so deletion is safe
*/

UPDATE agents
SET last_name = REGEXP_REPLACE(last_name, '^\w\.?\s+', '')
WHERE last_name ~ '^[A-Z]\.?\s+\w';

UPDATE agents
SET last_name = 'Goldberg'
WHERE id = '93078731-6569-48e9-b96f-8b670170e6d4';

DELETE FROM agents
WHERE id = '6fbf386d-f655-4d64-bc7f-6956d863eece';
