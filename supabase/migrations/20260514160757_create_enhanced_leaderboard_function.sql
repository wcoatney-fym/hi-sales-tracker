/*
  # Enhanced Leaderboard Function

  1. New Functions
    - `dashboard_enhanced_leaderboard(p_start_date, p_end_date, p_agency)` - Returns enriched agent data:
      - Agent name, number, carrier, agency
      - Total policies and annualized premium for the selected period
      - Average monthly premium per policy
      - Last 30 days production (policies + premium)
      - Prior 30 days production (days 31-60) for comparison
      - Momentum flag: 'up', 'down', or 'flat'
      - Last sale date
      - Weekly production for last 8 weeks (for sparkline)
      
  2. Notes
    - Respects the agency filter parameter
    - Ordered by annualized premium descending
    - Momentum is calculated as: last30 vs prior30, >20% increase = up, >20% decrease = down, else flat
*/

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
      fs.agent_first_name,
      fs.agent_last_name,
      fs.agent_number,
      MAX(fs.carrier) AS carrier,
      MAX(fs.agency) AS agency,
      COUNT(*) AS policies,
      COALESCE(SUM(fs.plan_premium * 12), 0) AS annual_premium,
      COALESCE(AVG(fs.plan_premium), 0) AS avg_monthly_premium,
      MAX(fs.app_submit_date) AS last_sale_date
    FROM form_submissions fs
    WHERE fs.app_submit_date >= p_start_date::date
      AND fs.app_submit_date < p_end_date::date
      AND (p_agency IS NULL OR fs.agency = p_agency)
      AND fs.app_submit_date IS NOT NULL
    GROUP BY fs.agent_first_name, fs.agent_last_name, fs.agent_number
  ),
  last30 AS (
    SELECT
      fs.agent_number,
      COUNT(*) AS policies_30d,
      COALESCE(SUM(fs.plan_premium * 12), 0) AS premium_30d
    FROM form_submissions fs
    WHERE fs.app_submit_date >= (CURRENT_DATE - 30)
      AND fs.app_submit_date <= CURRENT_DATE
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