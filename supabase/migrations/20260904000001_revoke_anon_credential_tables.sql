/*
  # Defuse credential landmine — REVOKE ALL anon grants on
  # agency_manager_credentials (holds plaintext passwords)

  Context:
  - agency_manager_credentials holds username + password for agency
    manager logins (5 rows)
  - anon had ALL privileges (Supabase default grants)
  - RLS was the only protection — no anon RLS policies existed
  - ONE future qual=true policy addition would instantly expose
    passwords to anyone with the publishable key
  - REVOKE ALL removes the landmine entirely

  Zero frontend breakage — no anon code paths read this table.
  Manager login validation runs through authenticated/service_role paths.
*/

REVOKE ALL ON public.agency_manager_credentials FROM anon;
