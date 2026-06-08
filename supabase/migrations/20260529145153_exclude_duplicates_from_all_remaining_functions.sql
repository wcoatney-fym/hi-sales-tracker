/*
  # Exclude duplicate/superseded records from all remaining dashboard and analytics functions

  1. Modified Functions
    - `dashboard_kpis` (3-param overload) - Add status NOT IN filter
    - `dashboard_kpis` (4-param overload) - Add status NOT IN filter
    - `dashboard_sales_chart` (4-param overload) - Add status NOT IN filter
    - `dashboard_sales_chart` (5-param overload) - Add status NOT IN filter
    - `dashboard_agency_breakdown` - Add status NOT IN filter to both current and previous subqueries
    - `dashboard_agent_breakdown` - Add status NOT IN filter to both current and previous subqueries
    - `monte_carlo_daily_history_by_agency` - Add status NOT IN filter
    - `monte_carlo_monthly_trend_by_agency` - Add status NOT IN filter
    - `monte_carlo_meta_by_agency` - Add status NOT IN filter
    - `monte_carlo_daily_history_by_agent` - Add status NOT IN filter
    - `monte_carlo_monthly_trend_by_agent` - Add status NOT IN filter
    - `monte_carlo_meta_by_agent` - Add status NOT IN filter

  2. Important Notes
    - These functions were missed in the prior duplicate exclusion migration
    - Records with status 'duplicate' or 'superseded' were being counted in analytics
    - This ensures consistent exclusion across ALL reporting surfaces
*/

-- 1. dashboard_kpis (3-param: p_start_date, p_end_date, p_agency)
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
    AND status NOT IN ('duplicate', 'superseded')
    AND (p_agency IS NULL OR agency = p_agency);

  RETURN result;
END;
$$;

-- 2. dashboard_kpis (4-param: p_start_date, p_end_date, p_agency, p_agencies)
CREATE OR REPLACE FUNCTION dashboard_kpis(
  p_start_date text,
  p_end_date text,
  p_agency text DEFAULT NULL,
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
    'policies_sold', COUNT(*),
    'total_premium_sum', COALESCE(SUM(plan_premium), 0),
    'active_agents', COUNT(DISTINCT (agent_first_name || '|' || agent_last_name)),
    'new_clients', COUNT(DISTINCT (client_first_name || '|' || client_last_name || '|' || COALESCE(email, '')))
  )
  INTO result
  FROM form_submissions
  WHERE app_submit_date >= p_start_date::date
    AND app_submit_date < p_end_date::date
    AND status NOT IN ('duplicate', 'superseded')
    AND (
      CASE
        WHEN p_agencies IS NOT NULL THEN agency = ANY(p_agencies)
        WHEN p_agency IS NOT NULL THEN agency = p_agency
        ELSE TRUE
      END
    );

  RETURN result;
END;
$$;

-- 3. dashboard_sales_chart (4-param: without p_agencies/p_agent_number)
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
      AND status NOT IN ('duplicate', 'superseded')
      AND (p_agency IS NULL OR agency = p_agency)
    GROUP BY bucket_date
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- 4. dashboard_sales_chart (5-param: with p_agencies but no p_agent_number)
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
      AND status NOT IN ('duplicate', 'superseded')
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

-- 5. dashboard_agency_breakdown
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
        AND status NOT IN ('duplicate', 'superseded')
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
        AND status NOT IN ('duplicate', 'superseded')
      GROUP BY COALESCE(agency, 'Unknown')
    ) prev ON prev.agency = cur.agency
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- 6. dashboard_agent_breakdown
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
        AND status NOT IN ('duplicate', 'superseded')
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
        AND status NOT IN ('duplicate', 'superseded')
        AND (p_agency IS NULL OR agency = p_agency)
      GROUP BY agent_number
    ) prev ON prev.agent_number = cur.agent_number
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- 7. monte_carlo_daily_history_by_agency
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
      AND status NOT IN ('duplicate', 'superseded')
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
      AND status NOT IN ('duplicate', 'superseded')
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

-- 8. monte_carlo_monthly_trend_by_agency
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
      AND status NOT IN ('duplicate', 'superseded')
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

-- 9. monte_carlo_meta_by_agency
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
    AND status NOT IN ('duplicate', 'superseded')
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

-- 10. monte_carlo_daily_history_by_agent
CREATE OR REPLACE FUNCTION monte_carlo_daily_history_by_agent(
  p_agent_number text,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
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
      AND agent_number = p_agent_number
      AND status NOT IN ('duplicate', 'superseded')
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
      AND agent_number = p_agent_number
      AND status NOT IN ('duplicate', 'superseded')
      AND app_submit_date >= v_min_date
      AND app_submit_date <= v_max_date
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

-- 11. monte_carlo_monthly_trend_by_agent
CREATE OR REPLACE FUNCTION monte_carlo_monthly_trend_by_agent(
  p_agent_number text,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
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
      AND agent_number = p_agent_number
      AND status NOT IN ('duplicate', 'superseded')
      AND (p_start_date IS NULL OR app_submit_date >= p_start_date)
      AND (p_end_date IS NULL OR app_submit_date <= p_end_date)
    GROUP BY to_char(app_submit_date, 'YYYY-MM')
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- 12. monte_carlo_meta_by_agent
CREATE OR REPLACE FUNCTION monte_carlo_meta_by_agent(
  p_agent_number text,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
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
    AND agent_number = p_agent_number
    AND status NOT IN ('duplicate', 'superseded')
    AND (p_start_date IS NULL OR app_submit_date >= p_start_date)
    AND (p_end_date IS NULL OR app_submit_date <= p_end_date);

  RETURN COALESCE(result, json_build_object(
    'total_days', 0,
    'selling_days', 0,
    'earliest_date', null,
    'latest_date', null
  ));
END;
$$;
