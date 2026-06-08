/*
  # Create dashboard aggregate functions

  1. New Functions
    - `dashboard_kpis(p_start_date text, p_end_date text, p_agency text)` 
      Returns policy count, sum of premiums, distinct agents, distinct clients for a date range
    - `dashboard_sales_chart(p_start_date text, p_end_date text, p_agency text, p_bucket text)`
      Returns date-bucketed (day/week/month) aggregates for the chart
    - `dashboard_agent_leaderboard(p_start_date text, p_end_date text, p_agency text)`
      Returns agent-grouped totals for the leaderboard

  2. Purpose
    - Moves aggregation from JavaScript (limited to 1000 rows by PostgREST default) to SQL
    - Handles any data volume correctly
    - Improves performance by avoiding large data transfers
*/

-- KPI aggregates for a date range
CREATE OR REPLACE FUNCTION dashboard_kpis(
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
  SELECT json_build_object(
    'policies_sold', COUNT(*),
    'total_premium_sum', COALESCE(SUM(plan_premium), 0),
    'active_agents', COUNT(DISTINCT (agent_first_name || '|' || agent_last_name)),
    'new_clients', COUNT(DISTINCT (client_first_name || '|' || client_last_name || '|' || COALESCE(email, '')))
  )
  INTO result
  FROM form_submissions
  WHERE app_submit_date >= p_start_date::date
    AND app_submit_date < p_end_date::date
    AND (p_agency IS NULL OR agency = p_agency);

  RETURN result;
END;
$$;

-- Sales chart bucketed by day, week, or month
CREATE OR REPLACE FUNCTION dashboard_sales_chart(
  p_start_date text,
  p_end_date text,
  p_agency text DEFAULT NULL,
  p_bucket text DEFAULT 'day'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_agg(row_to_json(t) ORDER BY t.bucket_date)
  INTO result
  FROM (
    SELECT
      CASE p_bucket
        WHEN 'month' THEN to_char(app_submit_date, 'YYYY-MM')
        WHEN 'week' THEN to_char(date_trunc('week', app_submit_date), 'YYYY-MM-DD')
        ELSE to_char(app_submit_date, 'YYYY-MM-DD')
      END AS bucket_date,
      COUNT(*) AS policies,
      COALESCE(SUM(plan_premium), 0) AS premium_sum
    FROM form_submissions
    WHERE app_submit_date >= p_start_date::date
      AND app_submit_date < p_end_date::date
      AND (p_agency IS NULL OR agency = p_agency)
    GROUP BY bucket_date
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- Agent leaderboard aggregated
CREATE OR REPLACE FUNCTION dashboard_agent_leaderboard(
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
  SELECT json_agg(row_to_json(t) ORDER BY t.total_sales DESC)
  INTO result
  FROM (
    SELECT
      agent_first_name,
      agent_last_name,
      agent_number,
      MAX(carrier) AS carrier,
      COUNT(*) AS policies_sold,
      COALESCE(SUM(plan_premium * 12), 0) AS total_sales
    FROM form_submissions
    WHERE app_submit_date >= p_start_date::date
      AND app_submit_date < p_end_date::date
      AND (p_agency IS NULL OR agency = p_agency)
    GROUP BY agent_first_name, agent_last_name, agent_number
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- Distinct agencies
CREATE OR REPLACE FUNCTION dashboard_agencies()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_agg(agency ORDER BY agency)
  INTO result
  FROM (SELECT DISTINCT agency FROM form_submissions WHERE agency IS NOT NULL AND agency != '') t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;
