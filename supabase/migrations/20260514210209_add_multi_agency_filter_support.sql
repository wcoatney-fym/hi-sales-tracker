/*
  # Add Multi-Agency Filter Support

  1. Modified Functions
    - `dashboard_sales_chart` - now accepts `p_agencies text[]` parameter for filtering by multiple agencies
    - `dashboard_kpis` - now accepts `p_agencies text[]` for multi-agency KPI aggregation
    - `monte_carlo_daily_history_by_agency` - now accepts `p_agencies text[]` for combined daily stats
    - `monte_carlo_monthly_trend_by_agency` - now accepts `p_agencies text[]` for combined monthly trends
    - `monte_carlo_meta_by_agency` - now accepts `p_agencies text[]` for combined metadata

  2. Notes
    - When p_agencies is NOT NULL, filters by `agency = ANY(p_agencies)`
    - When p_agencies IS NULL, falls back to p_agency single filter behavior
    - This allows the Internal tab to pass ["FYM", "Wisechoice Senior Advisors Llc"] for the combined view
*/

CREATE OR REPLACE FUNCTION dashboard_sales_chart(
  p_start_date text,
  p_end_date text,
  p_agency text DEFAULT NULL,
  p_bucket text DEFAULT 'day',
  p_agencies text[] DEFAULT NULL
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

CREATE OR REPLACE FUNCTION dashboard_kpis(
  p_start_date text,
  p_end_date text,
  p_prev_start_date text DEFAULT NULL,
  p_prev_end_date text DEFAULT NULL,
  p_agency text DEFAULT NULL,
  p_agencies text[] DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
  cur_policies int;
  cur_revenue numeric;
  cur_agents int;
  cur_avg numeric;
  cur_rpa numeric;
  cur_clients int;
  prev_policies int;
  prev_revenue numeric;
  prev_agents int;
  prev_avg numeric;
  prev_rpa numeric;
  prev_clients int;
BEGIN
  SELECT
    COUNT(*),
    COALESCE(SUM(plan_premium * 12), 0),
    COUNT(DISTINCT agent_number),
    COALESCE(AVG(plan_premium * 12), 0),
    COUNT(DISTINCT client_last_name || client_first_name)
  INTO cur_policies, cur_revenue, cur_agents, cur_avg, cur_clients
  FROM form_submissions
  WHERE app_submit_date >= p_start_date::date
    AND app_submit_date < p_end_date::date
    AND (
      CASE
        WHEN p_agencies IS NOT NULL THEN agency = ANY(p_agencies)
        WHEN p_agency IS NOT NULL THEN agency = p_agency
        ELSE TRUE
      END
    );

  cur_rpa := CASE WHEN cur_agents > 0 THEN cur_revenue / cur_agents ELSE 0 END;

  IF p_prev_start_date IS NOT NULL AND p_prev_end_date IS NOT NULL THEN
    SELECT
      COUNT(*),
      COALESCE(SUM(plan_premium * 12), 0),
      COUNT(DISTINCT agent_number),
      COALESCE(AVG(plan_premium * 12), 0),
      COUNT(DISTINCT client_last_name || client_first_name)
    INTO prev_policies, prev_revenue, prev_agents, prev_avg, prev_clients
    FROM form_submissions
    WHERE app_submit_date >= p_prev_start_date::date
      AND app_submit_date < p_prev_end_date::date
      AND (
        CASE
          WHEN p_agencies IS NOT NULL THEN agency = ANY(p_agencies)
          WHEN p_agency IS NOT NULL THEN agency = p_agency
          ELSE TRUE
        END
      );
  ELSE
    prev_policies := 0; prev_revenue := 0; prev_agents := 0; prev_avg := 0; prev_clients := 0;
  END IF;

  prev_rpa := CASE WHEN prev_agents > 0 THEN prev_revenue / prev_agents ELSE 0 END;

  result := json_build_object(
    'policiesSold', cur_policies,
    'totalRevenue', cur_revenue,
    'activeAgents', cur_agents,
    'avgPolicyValue', cur_avg,
    'revenuePerAgent', cur_rpa,
    'newClients', cur_clients,
    'prevPoliciesSold', prev_policies,
    'prevTotalRevenue', prev_revenue,
    'prevActiveAgents', prev_agents,
    'prevAvgPolicyValue', prev_avg,
    'prevRevenuePerAgent', prev_rpa,
    'prevNewClients', prev_clients
  );

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION monte_carlo_daily_history_by_agency(
  p_agency text DEFAULT NULL,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL,
  p_agencies text[] DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
  v_min_date date;
  v_max_date date;
BEGIN
  v_min_date := COALESCE(p_start_date, (
    SELECT MIN(app_submit_date) FROM form_submissions
    WHERE app_submit_date IS NOT NULL
      AND (
        CASE
          WHEN p_agencies IS NOT NULL THEN agency = ANY(p_agencies)
          WHEN p_agency IS NOT NULL THEN agency = p_agency
          ELSE TRUE
        END
      )
  ));
  v_max_date := COALESCE(p_end_date, CURRENT_DATE);

  IF v_min_date IS NULL THEN
    RETURN '[]'::json;
  END IF;

  WITH date_range AS (
    SELECT generate_series(v_min_date, v_max_date, '1 day'::interval)::date AS submit_date
  ),
  daily_stats AS (
    SELECT
      app_submit_date AS submit_date,
      COUNT(*) AS policy_count,
      COALESCE(SUM(plan_premium), 0) AS total_premium,
      COALESCE(AVG(plan_premium), 0) AS avg_premium
    FROM form_submissions
    WHERE app_submit_date IS NOT NULL
      AND app_submit_date >= v_min_date
      AND app_submit_date <= v_max_date
      AND (
        CASE
          WHEN p_agencies IS NOT NULL THEN agency = ANY(p_agencies)
          WHEN p_agency IS NOT NULL THEN agency = p_agency
          ELSE TRUE
        END
      )
    GROUP BY app_submit_date
  )
  SELECT json_agg(row_to_json(t) ORDER BY t.submit_date)
  INTO result
  FROM (
    SELECT
      dr.submit_date::text AS submit_date,
      EXTRACT(DOW FROM dr.submit_date)::int AS day_of_week,
      COALESCE(ds.policy_count, 0)::int AS policy_count,
      COALESCE(ds.total_premium, 0)::float AS total_premium,
      COALESCE(ds.avg_premium, 0)::float AS avg_premium
    FROM date_range dr
    LEFT JOIN daily_stats ds ON ds.submit_date = dr.submit_date
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

CREATE OR REPLACE FUNCTION monte_carlo_monthly_trend_by_agency(
  p_agency text DEFAULT NULL,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL,
  p_agencies text[] DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_agg(row_to_json(t) ORDER BY t.month)
  INTO result
  FROM (
    SELECT
      to_char(app_submit_date, 'YYYY-MM') AS month,
      COUNT(*)::int AS policy_count,
      COALESCE(SUM(plan_premium), 0)::float AS total_premium
    FROM form_submissions
    WHERE app_submit_date IS NOT NULL
      AND (p_start_date IS NULL OR app_submit_date >= p_start_date)
      AND (p_end_date IS NULL OR app_submit_date <= p_end_date)
      AND (
        CASE
          WHEN p_agencies IS NOT NULL THEN agency = ANY(p_agencies)
          WHEN p_agency IS NOT NULL THEN agency = p_agency
          ELSE TRUE
        END
      )
    GROUP BY to_char(app_submit_date, 'YYYY-MM')
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

CREATE OR REPLACE FUNCTION monte_carlo_meta_by_agency(
  p_agency text DEFAULT NULL,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL,
  p_agencies text[] DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    'total_days', (COALESCE(p_end_date, CURRENT_DATE) - MIN(app_submit_date))::int,
    'selling_days', COUNT(DISTINCT app_submit_date)::int,
    'earliest_date', MIN(app_submit_date)::text,
    'latest_date', MAX(app_submit_date)::text
  )
  INTO result
  FROM form_submissions
  WHERE app_submit_date IS NOT NULL
    AND (p_start_date IS NULL OR app_submit_date >= p_start_date)
    AND (p_end_date IS NULL OR app_submit_date <= p_end_date)
    AND (
      CASE
        WHEN p_agencies IS NOT NULL THEN agency = ANY(p_agencies)
        WHEN p_agency IS NOT NULL THEN agency = p_agency
        ELSE TRUE
      END
    );

  RETURN COALESCE(result, json_build_object(
    'total_days', 0,
    'selling_days', 0,
    'earliest_date', null,
    'latest_date', null
  ));
END;
$$;
