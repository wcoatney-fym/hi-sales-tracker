/*
  # Production DB via postgres_fdw — compatibility layer + get_quality_metrics proof

  Goal: read the current-state policy book straight from Max's production
  `analytics` database (single source of truth, fed one carrier file/day)
  instead of the locally-imported `form_submissions` table.

  This migration is ADDITIVE and NON-DESTRUCTIVE:
    - It does not touch `form_submissions` or the live `get_quality_metrics`.
    - It creates a foreign server + foreign table over Max's typed view,
      a compatibility view that remaps his columns to the names our RPCs
      already expect, and a parallel `get_quality_metrics_fdw` so we can
      validate side-by-side before cutting over.

  MANUAL SECRET STEP (NOT in git — see docs/fdw-production-cutover.md):
    The FDW user mapping carries the read-only reader password. It is created
    ONCE by a human in the Supabase SQL editor (or via Vault), never committed:

      CREATE USER MAPPING FOR postgres
        SERVER prod_analytics
        OPTIONS (user 'unl_fym_policy_reader', password '<READER_PASSWORD>');

    (Also add a mapping for the role that OWNS/EXECUTES the RPC if different.)
    Until that mapping exists, the foreign table returns a permission error —
    expected, and by design keeps the secret out of the repo.
*/

-- 1. FDW extension (already enabled on the project; idempotent guard).
CREATE EXTENSION IF NOT EXISTS postgres_fdw;

-- 2. Foreign server -> Max's production analytics DB. Host/port/dbname are
--    non-secret connection metadata; the password lives only in the user
--    mapping created manually (see header).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_foreign_server WHERE srvname = 'prod_analytics') THEN
    CREATE SERVER prod_analytics
      FOREIGN DATA WRAPPER postgres_fdw
      OPTIONS (
        host 'a480800-akamai-prod-5877024-default.g2a.akamaidb.net',
        port '27319',
        dbname 'analytics',
        sslmode 'require',
        -- keep planner from pushing pathological cross-network work:
        fetch_size '10000'
      );
  END IF;
END $$;

-- 3. Foreign table over Max's typed current-state snapshot.
--    One row per current policy; retains terminated policies (term_date set),
--    which persistency math needs in the denominator.
CREATE SCHEMA IF NOT EXISTS prod;

DROP FOREIGN TABLE IF EXISTS prod.unl_fym_policy_latest_load;
CREATE FOREIGN TABLE prod.unl_fym_policy_latest_load (
  policy_nbr            varchar,
  issue_date            date,
  app_recvd_date        date,
  paid_to_date          date,
  term_date             date,
  billing_mode          integer,
  annual_premium        double precision,
  plan_code             varchar,
  cntrct_code           varchar,
  at_risk_policy        boolean,
  roster_hierarchy_json jsonb
)
SERVER prod_analytics
OPTIONS (schema_name 'typed', table_name 'unl_fym_policy_latest_load');

-- 4. Compatibility view: present Max's columns under the names our RPCs use.
--    Column/semantic remap (validate before cutover):
--      policy_number         <- policy_nbr
--      policy_effective_date <- issue_date
--      app_submit_date       <- app_recvd_date
--      paid_to_date          <- paid_to_date (same)
--      billing_mode          <- billing_mode (same int code map)
--      status                <- derived: terminated if term_date set, else active
--      source                <- constant 'Data Source' (whole table IS the daily
--                               carrier load; preserves the RPC's provenance filter)
--      agency_id             <- resolved from roster_hierarchy_json depth-02 node
--                               name joined to public.agencies by normalized name
--                               (matches how the tracker buckets, e.g. Guardian).
--    NOTE: agency granularity is depth-02 (direct sub-agency), same bucket the
--    current tracker uses. Deeper downlines (e.g. BWL @ depth-03) are not in
--    public.agencies and roll up to their depth-02 parent here, preserving parity.
CREATE OR REPLACE VIEW public.form_submissions_fdw AS
SELECT
  p.policy_nbr                                   AS policy_number,
  p.issue_date                                   AS policy_effective_date,
  p.app_recvd_date                               AS app_submit_date,
  p.paid_to_date                                 AS paid_to_date,
  p.billing_mode                                 AS billing_mode,
  p.annual_premium                               AS annual_premium,
  p.plan_code                                    AS plan_code,
  p.at_risk_policy                               AS at_risk_policy,
  CASE WHEN p.term_date IS NOT NULL THEN 'terminated' ELSE 'active' END AS status,
  'Data Source'::text                            AS source,
  a.id                                           AS agency_id,
  -- stable synthetic id for row_to_json/count(id) parity in RPCs:
  p.policy_nbr                                   AS id
FROM prod.unl_fym_policy_latest_load p
LEFT JOIN LATERAL (
  SELECT elem->>'name' AS agency_name
  FROM jsonb_array_elements(p.roster_hierarchy_json) elem
  WHERE elem->>'depth' = '02'
  LIMIT 1
) d2 ON TRUE
LEFT JOIN public.agencies a
  ON upper(btrim(a.name)) = upper(btrim(d2.agency_name));

COMMENT ON VIEW public.form_submissions_fdw IS
  'FDW compatibility view over Max production analytics DB (typed.unl_fym_policy_latest_load). Column/semantic remap for RPC parity. See migration 20260707170000 and docs/fdw-production-cutover.md.';

-- 5. Parallel proof RPC: identical logic to get_quality_metrics(uuid, uuid[]),
--    but reading the FDW compat view. Kept separate so the live RPC is untouched
--    and we can diff outputs 1:1 before cutover.
CREATE OR REPLACE FUNCTION get_quality_metrics_fdw(
  p_agency_id uuid DEFAULT NULL,
  p_agency_ids uuid[] DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE result json;
BEGIN
SELECT json_build_object(
  'placement', (
    SELECT COALESCE(json_agg(row_to_json(p) ORDER BY p.month), '[]'::json)
    FROM (
      SELECT to_char(date_trunc('month', app_submit_date), 'YYYY-MM') AS month,
             count(*) AS submitted,
             count(*) FILTER (WHERE policy_effective_date IS NOT NULL AND policy_effective_date <= CURRENT_DATE) AS eligible,
             count(*) FILTER (WHERE policy_effective_date IS NOT NULL AND policy_effective_date <= CURRENT_DATE
                                AND paid_to_date IS NOT NULL AND paid_to_date > policy_effective_date) AS placed,
             round(100.0 * count(*) FILTER (WHERE policy_effective_date IS NOT NULL AND policy_effective_date <= CURRENT_DATE
                                              AND paid_to_date IS NOT NULL AND paid_to_date > policy_effective_date)
               / nullif(count(*) FILTER (WHERE policy_effective_date IS NOT NULL AND policy_effective_date <= CURRENT_DATE), 0), 1) AS placement_pct
      FROM public.form_submissions_fdw
      WHERE source = 'Data Source'
        AND app_submit_date >= date_trunc('month', CURRENT_DATE) - interval '3 months'
        AND app_submit_date < date_trunc('month', CURRENT_DATE)
        AND (
          CASE
            WHEN p_agency_ids IS NOT NULL THEN agency_id = ANY(p_agency_ids)
            WHEN p_agency_id IS NOT NULL THEN agency_id = p_agency_id
            ELSE TRUE
          END
        )
      GROUP BY 1
    ) p
  ),
  'persistency', (
    SELECT COALESCE(json_agg(row_to_json(q) ORDER BY q.months_ago), '[]'::json)
    FROM (
      SELECT m.months_ago,
             to_char(date_trunc('month', CURRENT_DATE) - make_interval(months => m.months_ago), 'YYYY-MM') AS cohort_month,
             count(fs.id) FILTER (WHERE fs.paid_to_date > fs.policy_effective_date) AS went_active,
             count(fs.id) FILTER (WHERE fs.paid_to_date > fs.policy_effective_date AND fs.status = 'active') AS still_active,
             round(100.0 * count(fs.id) FILTER (WHERE fs.paid_to_date > fs.policy_effective_date AND fs.status = 'active')
               / nullif(count(fs.id) FILTER (WHERE fs.paid_to_date > fs.policy_effective_date), 0), 1) AS persistency_pct
      FROM (VALUES (3),(6),(9),(13)) AS m(months_ago)
      LEFT JOIN public.form_submissions_fdw fs
        ON fs.source = 'Data Source'
        AND (
          CASE
            WHEN p_agency_ids IS NOT NULL THEN fs.agency_id = ANY(p_agency_ids)
            WHEN p_agency_id IS NOT NULL THEN fs.agency_id = p_agency_id
            ELSE TRUE
          END
        )
        AND fs.policy_effective_date >= date_trunc('month', CURRENT_DATE) - make_interval(months => m.months_ago)
        AND fs.policy_effective_date < date_trunc('month', CURRENT_DATE) - make_interval(months => m.months_ago - 1)
      GROUP BY m.months_ago
    ) q
  )
) INTO result;
RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_quality_metrics_fdw(uuid, uuid[]) FROM anon, authenticated;
