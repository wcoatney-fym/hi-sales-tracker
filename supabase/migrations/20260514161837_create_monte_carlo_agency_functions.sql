/*
  # Agency-Parameterized Monte Carlo Functions

  1. New Functions
    - `monte_carlo_daily_history_by_agency(p_agency)` - Returns daily submission stats
      filtered by agency (or all agencies if NULL), using all historical data from
      form_submissions directly (not the materialized view)
      - `submit_date` (text)
      - `day_of_week` (int, 0=Sun to 6=Sat)
      - `policy_count` (int)
      - `total_premium` (float)
      - `avg_premium` (float)
    - `monte_carlo_monthly_trend_by_agency(p_agency)` - Returns monthly aggregates
      filtered by agency for trend fitting
      - `month` (text, YYYY-MM)
      - `policy_count` (int)
      - `total_premium` (float)
    - `monte_carlo_meta_by_agency(p_agency)` - Returns metadata about the dataset
      for the given agency
      - `total_days` (int)
      - `selling_days` (int)
      - `earliest_date` (text)
      - `latest_date` (text)

  2. Notes
    - These functions use live queries against form_submissions, not the materialized view
    - They consider ALL historical data for the agency (no date range restriction)
    - When p_agency is NULL, all agencies are included
    - Zero-submission days are included via generate_series for accurate DOW modeling
*/

CREATE OR REPLACE FUNCTION monte_carlo_daily_history_by_agency(p_agency text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  WITH date_range AS (
    SELECT generate_series(
      (SELECT MIN(app_submit_date) FROM form_submissions
       WHERE app_submit_date IS NOT NULL
         AND (p_agency IS NULL OR agency = p_agency)),
      CURRENT_DATE,
      '1 day'::interval
    )::date AS submit_date
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

CREATE OR REPLACE FUNCTION monte_carlo_monthly_trend_by_agency(p_agency text DEFAULT NULL)
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
    GROUP BY to_char(app_submit_date, 'YYYY-MM')
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

CREATE OR REPLACE FUNCTION monte_carlo_meta_by_agency(p_agency text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    'total_days', (CURRENT_DATE - MIN(app_submit_date))::int,
    'selling_days', COUNT(DISTINCT app_submit_date)::int,
    'earliest_date', MIN(app_submit_date)::text,
    'latest_date', MAX(app_submit_date)::text
  )
  INTO result
  FROM form_submissions
  WHERE app_submit_date IS NOT NULL
    AND (p_agency IS NULL OR agency = p_agency);

  RETURN COALESCE(result, json_build_object(
    'total_days', 0,
    'selling_days', 0,
    'earliest_date', null,
    'latest_date', null
  ));
END;
$$;