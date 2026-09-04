/*
  # REVOKE ALL anon grants on agents table

  Context:
  - 2,802 rows with agent PII (first_name, last_name, NPN, writing_numbers)
  - anon had SELECT with qual=true RLS policy ("anon read agents")
  - Anyone with the publishable key could read all 2,802 agent records
  - Zero frontend reads — only edge functions (service_role) read this table
  - REVOKE ALL + drop the anon policy

  Changes:
  - REVOKE ALL ON agents FROM anon
  - DROP POLICY "anon read agents"

  Result:
  - anon cannot touch agents table
  - service_role (edge functions) unaffected
  - Zero frontend breakage
*/

REVOKE ALL ON public.agents FROM anon;
DROP POLICY IF EXISTS "anon read agents" ON public.agents;
