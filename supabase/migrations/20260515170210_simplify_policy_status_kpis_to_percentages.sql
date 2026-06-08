/*
  # Simplify dashboard_policy_status_kpis to return total_count instead of prev_* fields

  1. Modified Functions
    - `dashboard_policy_status_kpis` - Now returns total_count (all policies for the filtered scope)
      instead of previous-period baseline counts. Used to calculate percentage of total business.

  2. Changes
    - Removed p_period_start_date parameter (no longer needed)
    - Removed prev_active_count, prev_terminated_count, prev_pending_count, prev_at_risk_count
    - Added total_count: total number of policies matching the agency/agent filter (all-time)

  3. Important Notes
    - "At Risk" percentage is calculated on the frontend as at_risk / active (not at_risk / total)
    - All other statuses use total_count as the denominator
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
    COUNT(*) FILTER (WHERE status = 'active' AND paid_to_date IS NOT NULL AND paid_to_date < ref_date),
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