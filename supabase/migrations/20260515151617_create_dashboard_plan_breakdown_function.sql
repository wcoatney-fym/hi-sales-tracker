/*
  # Create plan breakdown dashboard function

  1. New Functions
    - `dashboard_plan_breakdown` - Returns plan_name, policy count, and total revenue
      grouped by plan name within a date range
    - Supports optional single agency filter and multi-agency array filter
  2. Purpose
    - Powers pie charts showing production distribution by plan/product type
*/

CREATE OR REPLACE FUNCTION dashboard_plan_breakdown(
  p_start_date text,
  p_end_date text,
  p_agency text DEFAULT NULL,
  p_agencies text[] DEFAULT NULL
)
RETURNS TABLE(
  plan_name text,
  policies bigint,
  revenue numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(fs.plan_name, 'Unknown') AS plan_name,
    COUNT(*)::bigint AS policies,
    COALESCE(SUM(fs.plan_premium::numeric), 0) AS revenue
  FROM form_submissions fs
  WHERE fs.app_submit_date >= p_start_date::date
    AND fs.app_submit_date <= p_end_date::date
    AND (p_agency IS NULL OR fs.agency = p_agency)
    AND (p_agencies IS NULL OR fs.agency = ANY(p_agencies))
  GROUP BY COALESCE(fs.plan_name, 'Unknown')
  ORDER BY COUNT(*) DESC;
END;
$$;
