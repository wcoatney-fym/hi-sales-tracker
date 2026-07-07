/*
  # Materialize the FDW production book into a fast local snapshot (daily refresh)

  Follow-up to 20260707170000. A live postgres_fdw query per dashboard hit is too
  slow (whole-book scan across the network to Max's Akamai DB times out the SQL
  editor's ~60s proxy). Since production lands as ONE carrier file per day, we
  don't need live cross-network reads — we pull once daily into a local table and
  let every RPC read that. Same pattern the repo already uses for monte carlo.

  This migration:
    - creates a local snapshot table `prod_cache.policies`
    - creates `prod_cache.refresh_policies()` — pulls the FDW compat mapping into
      the local table (this is the ONLY step that touches the network)
    - repoints `public.form_submissions_fdw` to read the LOCAL snapshot (fast)
    - schedules a daily pg_cron refresh

  The refresh runs SERVER-SIDE (pg_cron / direct connection), so it is NOT subject
  to the dashboard's 60s proxy cap. Still additive: form_submissions + live RPC
  untouched.
*/

-- 1. Local snapshot table (mirrors the compat view's output columns).
CREATE SCHEMA IF NOT EXISTS prod_cache;

CREATE TABLE IF NOT EXISTS prod_cache.policies (
  policy_number         text,
  policy_effective_date date,
  app_submit_date       date,
  paid_to_date          date,
  billing_mode          integer,
  annual_premium        double precision,
  plan_code             text,
  at_risk_policy        boolean,
  status                text,
  source                text,
  agency_id             uuid,
  id                    text,
  _refreshed_at         timestamptz
);

CREATE INDEX IF NOT EXISTS idx_prod_cache_policies_agency   ON prod_cache.policies (agency_id);
CREATE INDEX IF NOT EXISTS idx_prod_cache_policies_eff_date ON prod_cache.policies (policy_effective_date);
CREATE INDEX IF NOT EXISTS idx_prod_cache_policies_appdate  ON prod_cache.policies (app_submit_date);

-- 2. Refresh function: the one network pull. Does the column/semantic remap from
--    Max's foreign table into the local snapshot. Atomic (truncate+insert in a txn).
CREATE OR REPLACE FUNCTION prod_cache.refresh_policies()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE n integer;
BEGIN
  TRUNCATE prod_cache.policies;
  INSERT INTO prod_cache.policies (
    policy_number, policy_effective_date, app_submit_date, paid_to_date,
    billing_mode, annual_premium, plan_code, at_risk_policy, status, source,
    agency_id, id, _refreshed_at
  )
  SELECT
    p.policy_nbr,
    p.issue_date,
    p.app_recvd_date,
    p.paid_to_date,
    p.billing_mode,
    p.annual_premium,
    p.plan_code,
    p.at_risk_policy,
    CASE WHEN p.term_date IS NOT NULL THEN 'terminated' ELSE 'active' END,
    'Data Source',
    a.id,
    p.policy_nbr,
    now()
  FROM prod.unl_fym_policy_latest_load p
  LEFT JOIN LATERAL (
    SELECT elem->>'name' AS agency_name
    FROM jsonb_array_elements(p.roster_hierarchy_json) elem
    WHERE elem->>'depth' = '02'
    LIMIT 1
  ) d2 ON TRUE
  LEFT JOIN public.agencies a
    ON upper(btrim(a.name)) = upper(btrim(d2.agency_name));

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- 3. Repoint the compat view to the LOCAL snapshot. RPCs (get_quality_metrics_fdw)
--    now read a fast local table instead of the network. Column set is identical,
--    so get_quality_metrics_fdw needs no change.
CREATE OR REPLACE VIEW public.form_submissions_fdw AS
SELECT
  policy_number, policy_effective_date, app_submit_date, paid_to_date,
  billing_mode, annual_premium, plan_code, at_risk_policy, status, source,
  agency_id, id
FROM prod_cache.policies;

COMMENT ON VIEW public.form_submissions_fdw IS
  'Reads the local daily snapshot prod_cache.policies (refreshed from Max prod DB via prod_cache.refresh_policies()). See migrations 20260707170000/20260707180000 and docs/fdw-production-cutover.md.';

-- 4. Daily refresh via pg_cron (server-side; not subject to the dashboard proxy).
--    NOTE: adjust the time to run shortly AFTER Max's daily file lands.
--    Placeholder: 06:30 UTC daily. Requires the pg_cron extension.
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-prod-policies') THEN
    PERFORM cron.schedule(
      'refresh-prod-policies',
      '30 6 * * *',
      $cron$ SELECT prod_cache.refresh_policies(); $cron$
    );
  END IF;
END $$;
