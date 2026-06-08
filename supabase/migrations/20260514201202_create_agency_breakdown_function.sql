/*
  # Create agency breakdown function for hierarchy drill-down

  1. New Functions
    - `dashboard_agency_breakdown(p_start_date text, p_end_date text, p_prev_start text, p_prev_end text)`
      Returns per-agency metrics including policies, revenue, agent count, and previous period revenue for growth comparison
    - `dashboard_agent_breakdown(p_start_date text, p_end_date text, p_prev_start text, p_prev_end text, p_agency text)`
      Returns per-agent metrics within an agency including policies, revenue, avg premium, and previous period revenue

  2. Purpose
    - Powers the Overview tab hierarchy drill-down (Level 1: agency list, Level 2: agent list within agency)
    - Provides growth comparison between current and previous periods
    - Single efficient query per level instead of N+1 calls
*/

-- Agency breakdown for the Overview level 1
CREATE OR REPLACE FUNCTION dashboard_agency_breakdown(
  p_start_date text,
  p_end_date text,
  p_prev_start text DEFAULT NULL,
  p_prev_end text DEFAULT NULL
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
      cur.agency,
      cur.policies,
      cur.revenue,
      cur.avg_premium,
      cur.agent_count,
      COALESCE(prev.revenue, 0) AS prev_revenue
    FROM (
      SELECT
        COALESCE(agency, 'Unknown') AS agency,
        COUNT(*) AS policies,
        COALESCE(SUM(plan_premium), 0) * 12 AS revenue,
        CASE WHEN COUNT(*) > 0 THEN (SUM(plan_premium) * 12) / COUNT(*) ELSE 0 END AS avg_premium,
        COUNT(DISTINCT (agent_first_name || '|' || agent_last_name)) AS agent_count
      FROM form_submissions
      WHERE app_submit_date >= p_start_date::date
        AND app_submit_date < p_end_date::date
      GROUP BY COALESCE(agency, 'Unknown')
    ) cur
    LEFT JOIN (
      SELECT
        COALESCE(agency, 'Unknown') AS agency,
        COALESCE(SUM(plan_premium), 0) * 12 AS revenue
      FROM form_submissions
      WHERE p_prev_start IS NOT NULL
        AND app_submit_date >= p_prev_start::date
        AND app_submit_date < p_prev_end::date
      GROUP BY COALESCE(agency, 'Unknown')
    ) prev ON prev.agency = cur.agency
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- Agent breakdown within a specific agency for Overview level 2
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
        agent_first_name,
        agent_last_name,
        agent_number,
        COUNT(*) AS policies,
        COALESCE(SUM(plan_premium), 0) * 12 AS revenue,
        CASE WHEN COUNT(*) > 0 THEN (SUM(plan_premium) * 12) / COUNT(*) ELSE 0 END AS avg_premium
      FROM form_submissions
      WHERE app_submit_date >= p_start_date::date
        AND app_submit_date < p_end_date::date
        AND (p_agency IS NULL OR agency = p_agency)
      GROUP BY agent_first_name, agent_last_name, agent_number
    ) cur
    LEFT JOIN (
      SELECT
        agent_number,
        COALESCE(SUM(plan_premium), 0) * 12 AS revenue
      FROM form_submissions
      WHERE p_prev_start IS NOT NULL
        AND app_submit_date >= p_prev_start::date
        AND app_submit_date < p_prev_end::date
        AND (p_agency IS NULL OR agency = p_agency)
      GROUP BY agent_number
    ) prev ON prev.agent_number = cur.agent_number
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;
