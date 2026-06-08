/*
  # Create dashboard_policy_status_kpis function

  1. New Functions
    - `dashboard_policy_status_kpis` - Returns current and baseline counts for policy statuses
      - Active policies count (status = 'active')
      - Terminated policies count (status = 'terminated')
      - Pending policies count (status = 'pending')
      - At Risk policies count (status = 'active' AND paid_to_date < reference date)

  2. Parameters
    - p_reference_date: The "active date" used to determine at-risk (paid_to_date in the past)
    - p_period_start_date: Start of selected time period for baseline comparison
    - p_agency: Single agency filter
    - p_agencies: Array of agencies filter
    - p_agent_number: Specific agent filter

  3. Trend Logic
    - Current = all policies currently in that status (with filters applied)
    - Previous = policies that were in that status as of the period start date
      - For active/pending: policies with app_submit_date < period_start AND status matches
        (approximation: policies submitted before the period that still have that status now)
      - For terminated: policies with app_submit_date < period_start AND status = terminated
      - For at-risk: active policies with app_submit_date < period_start AND paid_to_date < period_start

  4. Security
    - Function is accessible via RPC with service role
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
  period_start date;
  active_count bigint;
  terminated_count bigint;
  pending_count bigint;
  at_risk_count bigint;
  prev_active_count bigint;
  prev_terminated_count bigint;
  prev_pending_count bigint;
  prev_at_risk_count bigint;
BEGIN
  ref_date := COALESCE(p_reference_date::date, CURRENT_DATE);
  period_start := COALESCE(p_period_start_date::date, CURRENT_DATE - INTERVAL '30 days');

  -- Current counts
  SELECT
    COUNT(*) FILTER (WHERE status = 'active'),
    COUNT(*) FILTER (WHERE status = 'terminated'),
    COUNT(*) FILTER (WHERE status = 'pending'),
    COUNT(*) FILTER (WHERE status = 'active' AND paid_to_date IS NOT NULL AND paid_to_date < ref_date)
  INTO active_count, terminated_count, pending_count, at_risk_count
  FROM form_submissions
  WHERE
    CASE
      WHEN p_agent_number IS NOT NULL THEN agent_number = p_agent_number
      WHEN p_agencies IS NOT NULL THEN agency = ANY(p_agencies)
      WHEN p_agency IS NOT NULL THEN agency = p_agency
      ELSE TRUE
    END;

  -- Baseline counts (policies submitted before period start that are in each status now)
  SELECT
    COUNT(*) FILTER (WHERE status = 'active'),
    COUNT(*) FILTER (WHERE status = 'terminated'),
    COUNT(*) FILTER (WHERE status = 'pending'),
    COUNT(*) FILTER (WHERE status = 'active' AND paid_to_date IS NOT NULL AND paid_to_date < period_start)
  INTO prev_active_count, prev_terminated_count, prev_pending_count, prev_at_risk_count
  FROM form_submissions
  WHERE
    COALESCE(app_submit_date, created_at::date) < period_start
    AND CASE
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
    'prev_active_count', prev_active_count,
    'prev_terminated_count', prev_terminated_count,
    'prev_pending_count', prev_pending_count,
    'prev_at_risk_count', prev_at_risk_count
  );
END;
$$;