/*
  # Add Date Range Parameters to Monte Carlo Agency Functions

  1. Modified Functions
    - `monte_carlo_daily_history_by_agency(p_agency, p_start_date, p_end_date)` 
      - Added optional p_start_date and p_end_date parameters
      - When provided, constrains historical data to the given date window
      - When NULL (default), uses all historical data
    - `monte_carlo_monthly_trend_by_agency(p_agency, p_start_date, p_end_date)`
      - Same date range filtering behavior
    - `monte_carlo_meta_by_agency(p_agency, p_start_date, p_end_date)`
      - Same date range filtering behavior

  2. Notes
    - All date parameters default to NULL (all history)
    - Existing callers with no date params continue to work unchanged
*/

CREATE OR REPLACE FUNCTION monte_carlo_daily_history_by_agency(
  p_agency text DEFAULT NULL,
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
      AND (p_agency IS NULL OR agency = p_agency)
  ));
  v_max_date := COALESCE(p_end_date, CURRENT_DATE);

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
      AND (p_agency IS NULL OR agency = p_agency)
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

CREATE OR REPLACE FUNCTION monte_carlo_monthly_trend_by_agency(
  p_agency text DEFAULT NULL,
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
      AND (p_agency IS NULL OR agency = p_agency)
      AND (p_start_date IS NULL OR app_submit_date >= p_start_date)
      AND (p_end_date IS NULL OR app_submit_date <= p_end_date)
    GROUP BY to_char(app_submit_date, 'YYYY-MM')
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

CREATE OR REPLACE FUNCTION monte_carlo_meta_by_agency(
  p_agency text DEFAULT NULL,
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
    AND (p_agency IS NULL OR agency = p_agency)
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