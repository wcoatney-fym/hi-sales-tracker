/*
  # Monte Carlo Forecast Infrastructure

  1. New Functions
    - `monte_carlo_daily_history()` - Returns daily submission stats for FYM + Wisechoice agencies
      including zero-submission days via generate_series
      - `submit_date` (date)
      - `day_of_week` (int, 0=Sun to 6=Sat)
      - `policy_count` (int)
      - `total_premium` (numeric)
      - `avg_premium` (numeric)
    - `monte_carlo_monthly_trend()` - Returns monthly aggregates for trend fitting
      - `month` (text, YYYY-MM)
      - `policy_count` (int)
      - `total_premium` (numeric)
    - `refresh_monte_carlo_view()` - Refreshes the materialized view on demand
    - `monte_carlo_last_refresh()` - Returns metadata about the view

  2. Materialized View
    - `mv_monte_carlo_daily` - Pre-computed daily stats for fast chart loading

  3. Scheduled Refresh
    - pg_cron jobs at 13:00, 16:00, 22:00 UTC (9am, 12pm, 6pm Eastern)

  4. Security
    - Functions use SECURITY DEFINER for controlled access
    - No direct table access exposed
*/

-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- Create the materialized view with daily stats including zero-days
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_monte_carlo_daily AS
WITH date_range AS (
  SELECT
    generate_series(
      (SELECT MIN(app_submit_date) FROM form_submissions WHERE agency IN ('FYM', 'Wisechoice Senior Advisors Llc', 'Wisechoice Senior Advisors  Llc')),
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
  WHERE agency IN ('FYM', 'Wisechoice Senior Advisors Llc', 'Wisechoice Senior Advisors  Llc')
    AND app_submit_date IS NOT NULL
  GROUP BY app_submit_date
)
SELECT
  dr.submit_date,
  EXTRACT(DOW FROM dr.submit_date)::int AS day_of_week,
  COALESCE(ds.policy_count, 0)::int AS policy_count,
  COALESCE(ds.total_premium, 0)::numeric AS total_premium,
  COALESCE(ds.avg_premium, 0)::numeric AS avg_premium
FROM date_range dr
LEFT JOIN daily_stats ds ON ds.submit_date = dr.submit_date
ORDER BY dr.submit_date;

-- Create unique index for concurrent refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_monte_carlo_daily_date ON mv_monte_carlo_daily (submit_date);

-- Function to return daily history from the materialized view
CREATE OR REPLACE FUNCTION monte_carlo_daily_history()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_agg(row_to_json(t) ORDER BY t.submit_date)
  INTO result
  FROM (
    SELECT
      submit_date::text,
      day_of_week,
      policy_count,
      total_premium::float,
      avg_premium::float
    FROM mv_monte_carlo_daily
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- Function to return monthly trend data
CREATE OR REPLACE FUNCTION monte_carlo_monthly_trend()
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
      to_char(submit_date, 'YYYY-MM') AS month,
      SUM(policy_count)::int AS policy_count,
      SUM(total_premium)::float AS total_premium
    FROM mv_monte_carlo_daily
    GROUP BY to_char(submit_date, 'YYYY-MM')
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- Function to refresh the materialized view (callable from admin API)
CREATE OR REPLACE FUNCTION refresh_monte_carlo_view()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monte_carlo_daily;
  RETURN json_build_object('refreshed_at', now()::text);
END;
$$;

-- Function to get the last refresh time and metadata
CREATE OR REPLACE FUNCTION monte_carlo_last_refresh()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    'last_refresh', now()::text,
    'total_days', (SELECT COUNT(*) FROM mv_monte_carlo_daily),
    'selling_days', (SELECT COUNT(*) FROM mv_monte_carlo_daily WHERE policy_count > 0),
    'earliest_date', (SELECT MIN(submit_date)::text FROM mv_monte_carlo_daily),
    'latest_date', (SELECT MAX(submit_date)::text FROM mv_monte_carlo_daily)
  ) INTO result;

  RETURN result;
END;
$$;

-- Schedule pg_cron jobs: 13:00, 16:00, 22:00 UTC = 9am, 12pm, 6pm EDT
SELECT cron.schedule(
  'monte-carlo-refresh-9am',
  '0 13 * * *',
  $$SELECT refresh_monte_carlo_view()$$
);

SELECT cron.schedule(
  'monte-carlo-refresh-12pm',
  '0 16 * * *',
  $$SELECT refresh_monte_carlo_view()$$
);

SELECT cron.schedule(
  'monte-carlo-refresh-6pm',
  '0 22 * * *',
  $$SELECT refresh_monte_carlo_view()$$
);

-- Perform initial analyze to populate stats
ANALYZE mv_monte_carlo_daily;