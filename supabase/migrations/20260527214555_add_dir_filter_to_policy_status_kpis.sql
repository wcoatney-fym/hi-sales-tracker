/*
  # Add billing_form = 'DIR' filter to dashboard_policy_status_kpis at-risk count

  1. Modified Functions
    - `dashboard_policy_status_kpis` - at_risk_count now only includes policies where billing_form = 'DIR'

  2. Important Notes
    - Active, terminated, pending, and total counts remain unchanged
    - Only the at-risk count is restricted to DIR billing form policies
    - This affects both the Overview tab (org + per-agency) and Internal tab (FYM + Wisechoice)
    - Agent-level drill-down also inherits this filter
*/

CREATE OR REPLACE FUNCTION dashboard_policy_status_kpis(
  p_reference_date text DEFAULT NULL,
  p_period_start_date text DEFAULT NULL,
  p_agency text DEFAULT NULL,
  p_agencies text[] DEFAULT NULL,
  p_agent_number text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  ref_date date;
  active_count bigint;
  terminated_count bigint;
  pending_count bigint;
  at_risk_count bigint;
  total_count bigint;
BEGIN
  ref_date := COALESCE(p_reference_date::date, CURRENT_DATE);

  SELECT
    COUNT(*) FILTER (WHERE status = 'active'),
    COUNT(*) FILTER (WHERE status = 'terminated'),
    COUNT(*) FILTER (WHERE status = 'pending'),
    COUNT(*) FILTER (WHERE status = 'active' AND billing_form = 'DIR' AND paid_to_date IS NOT NULL AND paid_to_date < ref_date),
    COUNT(*)
  INTO active_count, terminated_count, pending_count, at_risk_count, total_count
  FROM form_submissions
  WHERE
    CASE
      WHEN p_agent_number IS NOT NULL THEN agent_number = p_agent_number
      WHEN p_agencies IS NOT NULL THEN agency = ANY(p_agencies)
      WHEN p_agency IS NOT NULL THEN agency = p_agency
      ELSE TRUE
    END;

  RETURN json_build_object(
    'active_count', active_count,
    'terminated_count', terminated_count,
    'pending_count', pending_count,
    'at_risk_count', at_risk_count,
    'total_count', total_count
  );
END;
$$;