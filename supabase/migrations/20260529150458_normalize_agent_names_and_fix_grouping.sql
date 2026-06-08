/*
  # Normalize agent names and fix leaderboard grouping

  1. Data Normalization
    - TRIM whitespace from agent_first_name and agent_last_name in all form_submissions
    - Apply INITCAP to normalize casing (e.g., "BRAYLON" -> "Braylon", "max" -> "Max")
    - This prevents the same agent from appearing multiple times due to casing/spacing differences

  2. Modified Functions
    - `dashboard_enhanced_leaderboard` - Group by agent_number only, aggregate name with proper casing
    - `dashboard_agent_breakdown` - Group by agent_number only, aggregate name

  3. Important Notes
    - Agents with genuinely different names under the same number (e.g., Walter/Joelwalter) 
      will now show as a single entry using the most common name variant
    - Future ingestion should sanitize names to prevent recurrence
*/

-- 1. Normalize existing data: trim whitespace
UPDATE form_submissions
SET agent_first_name = TRIM(agent_first_name)
WHERE agent_first_name != TRIM(agent_first_name);

UPDATE form_submissions
SET agent_last_name = TRIM(agent_last_name)
WHERE agent_last_name != TRIM(agent_last_name);

-- 2. Normalize casing to INITCAP for agent names that are all-uppercase or all-lowercase
UPDATE form_submissions
SET agent_first_name = INITCAP(agent_first_name)
WHERE agent_first_name = UPPER(agent_first_name)
   OR agent_first_name = LOWER(agent_first_name);

UPDATE form_submissions
SET agent_last_name = INITCAP(agent_last_name)
WHERE agent_last_name = UPPER(agent_last_name)
   OR agent_last_name = LOWER(agent_last_name);

-- 3. Fix dashboard_enhanced_leaderboard to group by agent_number only
CREATE OR REPLACE FUNCTION dashboard_enhanced_leaderboard(
  p_start_date text,
  p_end_date text,
  p_agency text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  WITH period_data AS (
    SELECT
      fs.agent_number,
      MODE() WITHIN GROUP (ORDER BY fs.agent_first_name) AS agent_first_name,
      MODE() WITHIN GROUP (ORDER BY fs.agent_last_name) AS agent_last_name,
      MAX(fs.carrier) AS carrier,
      MAX(fs.agency) AS agency,
      COUNT(*) AS policies,
      COALESCE(SUM(fs.plan_premium * 12), 0) AS annual_premium,
      COALESCE(AVG(fs.plan_premium), 0) AS avg_monthly_premium,
      MAX(fs.app_submit_date) AS last_sale_date
    FROM form_submissions fs
    WHERE fs.app_submit_date >= p_start_date::date
      AND fs.app_submit_date < p_end_date::date
      AND fs.status NOT IN ('duplicate', 'superseded')
      AND (p_agency IS NULL OR fs.agency = p_agency)
      AND fs.app_submit_date IS NOT NULL
    GROUP BY fs.agent_number
  ),
  last30 AS (
    SELECT
      fs.agent_number,
      COUNT(*) AS policies_30d,
      COALESCE(SUM(fs.plan_premium * 12), 0) AS premium_30d
    FROM form_submissions fs
    WHERE fs.app_submit_date >= (CURRENT_DATE - 30)
      AND fs.app_submit_date <= CURRENT_DATE
      AND fs.status NOT IN ('duplicate', 'superseded')
      AND (p_agency IS NULL OR fs.agency = p_agency)
      AND fs.app_submit_date IS NOT NULL
    GROUP BY fs.agent_number
  ),
  prior30 AS (
    SELECT
      fs.agent_number,
      COUNT(*) AS policies_prior,
      COALESCE(SUM(fs.plan_premium * 12), 0) AS premium_prior
    FROM form_submissions fs
    WHERE fs.app_submit_date >= (CURRENT_DATE - 60)
      AND fs.app_submit_date < (CURRENT_DATE - 30)
      AND fs.status NOT IN ('duplicate', 'superseded')
      AND (p_agency IS NULL OR fs.agency = p_agency)
      AND fs.app_submit_date IS NOT NULL
    GROUP BY fs.agent_number
  ),
  weekly AS (
    SELECT
      fs.agent_number,
      json_agg(
        json_build_object(
          'week', wk.week_start::text,
          'policies', COALESCE(wk.cnt, 0),
          'premium', COALESCE(wk.prem, 0)
        ) ORDER BY wk.week_start
      ) AS weekly_data
    FROM (
      SELECT DISTINCT agent_number FROM form_submissions
      WHERE app_submit_date >= (CURRENT_DATE - 56)
        AND status NOT IN ('duplicate', 'superseded')
        AND (p_agency IS NULL OR agency = p_agency)
        AND app_submit_date IS NOT NULL
    ) fs
    CROSS JOIN LATERAL (
      SELECT
        gs::date AS week_start,
        COUNT(f2.id) AS cnt,
        COALESCE(SUM(f2.plan_premium * 12), 0) AS prem
      FROM generate_series(CURRENT_DATE - 56, CURRENT_DATE - 7, '7 days'::interval) gs
      LEFT JOIN form_submissions f2
        ON f2.agent_number = fs.agent_number
        AND f2.app_submit_date >= gs::date
        AND f2.app_submit_date < (gs::date + 7)
        AND f2.status NOT IN ('duplicate', 'superseded')
        AND (p_agency IS NULL OR f2.agency = p_agency)
      GROUP BY gs
    ) wk
    GROUP BY fs.agent_number
  )
  SELECT json_agg(row_to_json(t) ORDER BY t.annual_premium DESC)
  INTO result
  FROM (
    SELECT
      pd.agent_first_name,
      pd.agent_last_name,
      pd.agent_number,
      pd.carrier,
      pd.agency,
      pd.policies::int,
      pd.annual_premium::float,
      pd.avg_monthly_premium::float,
      pd.last_sale_date::text,
      COALESCE(l.policies_30d, 0)::int AS policies_30d,
      COALESCE(l.premium_30d, 0)::float AS premium_30d,
      COALESCE(p.policies_prior, 0)::int AS policies_prior,
      COALESCE(p.premium_prior, 0)::float AS premium_prior,
      CASE
        WHEN COALESCE(p.premium_prior, 0) = 0 AND COALESCE(l.premium_30d, 0) > 0 THEN 'up'
        WHEN COALESCE(l.premium_30d, 0) = 0 AND COALESCE(p.premium_prior, 0) > 0 THEN 'down'
        WHEN COALESCE(p.premium_prior, 0) = 0 AND COALESCE(l.premium_30d, 0) = 0 THEN 'flat'
        WHEN (COALESCE(l.premium_30d, 0)::float / NULLIF(p.premium_prior, 0)::float) > 1.2 THEN 'up'
        WHEN (COALESCE(l.premium_30d, 0)::float / NULLIF(p.premium_prior, 0)::float) < 0.8 THEN 'down'
        ELSE 'flat'
      END AS momentum,
      COALESCE(w.weekly_data, '[]'::json) AS weekly_production
    FROM period_data pd
    LEFT JOIN last30 l ON l.agent_number = pd.agent_number
    LEFT JOIN prior30 p ON p.agent_number = pd.agent_number
    LEFT JOIN weekly w ON w.agent_number = pd.agent_number
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- 4. Fix dashboard_agent_breakdown to group by agent_number only
CREATE OR REPLACE FUNCTION dashboard_agent_breakdown(
  p_start_date text,
  p_end_date text,
  p_prev_start text DEFAULT NULL,
  p_prev_end text DEFAULT NULL,
  p_agency text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_agg(row_to_json(t) ORDER BY t.revenue DESC)
  INTO result
  FROM (
    SELECT
      cur.agent_first_name,
      cur.agent_last_name,
      cur.agent_number,
      cur.policies,
      cur.revenue,
      cur.avg_premium,
      COALESCE(prev.revenue, 0) AS prev_revenue
    FROM (
      SELECT
        MODE() WITHIN GROUP (ORDER BY agent_first_name) AS agent_first_name,
        MODE() WITHIN GROUP (ORDER BY agent_last_name) AS agent_last_name,
        agent_number,
        COUNT(*) AS policies,
        COALESCE(SUM(plan_premium), 0) * 12 AS revenue,
        CASE WHEN COUNT(*) > 0 THEN (SUM(plan_premium) * 12) / COUNT(*) ELSE 0 END AS avg_premium
      FROM form_submissions
      WHERE app_submit_date >= p_start_date::date
        AND app_submit_date < p_end_date::date
        AND status NOT IN ('duplicate', 'superseded')
        AND (p_agency IS NULL OR agency = p_agency)
      GROUP BY agent_number
    ) cur
    LEFT JOIN (
      SELECT
        agent_number,
        COALESCE(SUM(plan_premium), 0) * 12 AS revenue
      FROM form_submissions
      WHERE p_prev_start IS NOT NULL
        AND app_submit_date >= p_prev_start::date
        AND app_submit_date < p_prev_end::date
        AND status NOT IN ('duplicate', 'superseded')
        AND (p_agency IS NULL OR agency = p_agency)
      GROUP BY agent_number
    ) prev ON prev.agent_number = cur.agent_number
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;
