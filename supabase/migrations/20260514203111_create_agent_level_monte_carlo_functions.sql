/*
  # Agent-Level Monte Carlo Functions

  1. New Functions
    - `monte_carlo_daily_history_by_agent(p_agent_number, p_start_date, p_end_date)`
      Returns daily submission stats for a single agent identified by writing number
      - `submit_date` (text)
      - `day_of_week` (int, 0=Sun to 6=Sat)
      - `policy_count` (int)
      - `total_premium` (float)
      - `avg_premium` (float)
    - `monte_carlo_monthly_trend_by_agent(p_agent_number, p_start_date, p_end_date)`
      Returns monthly aggregates for a single agent for trend fitting
      - `month` (text, YYYY-MM)
      - `policy_count` (int)
      - `total_premium` (float)
    - `monte_carlo_meta_by_agent(p_agent_number, p_start_date, p_end_date)`
      Returns metadata about the dataset for the given agent
      - `total_days` (int)
      - `selling_days` (int)
      - `earliest_date` (text)
      - `latest_date` (text)

  2. Notes
    - Filters form_submissions by agent_number (writing number field)
    - Zero-submission days are included via generate_series for accurate DOW modeling
    - Date range params are optional; defaults to all history when NULL
*/

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
      AND (p_start_date IS NULL OR app_submit_date >= p_start_date)
      AND (p_end_date IS NULL OR app_submit_date <= p_end_date)
    GROUP BY to_char(app_submit_date, 'YYYY-MM')
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

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
