/*
  # Add Agent Number Filter to KPIs and Sales Chart

  1. Modified Functions
    - `dashboard_kpis` - added `p_agent_number text DEFAULT NULL` parameter
      - When provided, filters results to only that agent's submissions
    - `dashboard_sales_chart` - added `p_agent_number text DEFAULT NULL` parameter
      - When provided, filters chart data to only that agent's submissions

  2. Notes
    - Allows the AgentProductionPanel to show KPIs and trend charts scoped to a single agent
    - Backward compatible: existing callers that don't pass p_agent_number are unaffected
*/

CREATE OR REPLACE FUNCTION dashboard_kpis(
  p_start_date text,
  p_end_date text,
  p_agency text DEFAULT NULL,
  p_agencies text[] DEFAULT NULL,
  p_agent_number text DEFAULT NULL
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
    AND (
      CASE
        WHEN p_agent_number IS NOT NULL THEN agent_number = p_agent_number
        WHEN p_agencies IS NOT NULL THEN agency = ANY(p_agencies)
        WHEN p_agency IS NOT NULL THEN agency = p_agency
        ELSE TRUE
      END
    );

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION dashboard_sales_chart(
  p_start_date text,
  p_end_date text,
  p_agency text DEFAULT NULL,
  p_bucket text DEFAULT 'day',
  p_agencies text[] DEFAULT NULL,
  p_agent_number text DEFAULT NULL
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
      AND (
        CASE
          WHEN p_agent_number IS NOT NULL THEN agent_number = p_agent_number
          WHEN p_agencies IS NOT NULL THEN agency = ANY(p_agencies)
          WHEN p_agency IS NOT NULL THEN agency = p_agency
          ELSE TRUE
        END
      )
    GROUP BY bucket_date
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;
