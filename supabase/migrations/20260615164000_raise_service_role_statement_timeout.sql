-- The sync (run by edge functions as service_role) upserts into a 27k-row
-- table in batches; on nano compute a batch occasionally exceeded the implicit
-- default statement timeout and the whole import errored (hitting the
-- autonomous 3 PM run as well as manual imports). service_role is backend-only
-- (never exposed to clients), so a generous explicit ceiling is safe.
ALTER ROLE service_role SET statement_timeout = '120s';
