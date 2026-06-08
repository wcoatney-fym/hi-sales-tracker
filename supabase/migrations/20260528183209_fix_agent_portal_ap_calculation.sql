/*
  # Fix Agent Portal AP Calculation

  1. Changes
    - Fixed AP calculation to use `plan_premium * 12` instead of billing_mode-based multiplier
    - The source data provides true Annual Premium which is always divided by 12 before storage
    - Recovery is therefore always plan_premium * 12 regardless of billing_mode

  2. Affected Functions
    - `get_agent_dashboard_stats` - all premium fields now use plan_premium * 12
    - `get_agent_production_history` - premium field uses plan_premium * 12
    - `get_agent_book_summary` - total_premium_in_force and per-policy annual_premium use plan_premium * 12
*/

-- 1. Dashboard stats with correct AP (plan_premium * 12)
CREATE OR REPLACE FUNCTION get_agent_dashboard_stats(
  p_unl_writing_number text DEFAULT NULL,
  p_gtl_writing_number text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
  v_today date := CURRENT_DATE;
  v_week_start date := date_trunc('week', CURRENT_DATE)::date;
  v_month_start date := date_trunc('month', CURRENT_DATE)::date;
  v_prev_month_start date := (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month')::date;
  v_prev_month_end date := (date_trunc('month', CURRENT_DATE) - INTERVAL '1 day')::date;
BEGIN
  SELECT json_build_object(
    'today_policies', COUNT(*) FILTER (WHERE fs.app_submit_date = v_today),
    'today_premium', COALESCE(SUM(fs.plan_premium * 12) FILTER (WHERE fs.app_submit_date = v_today), 0),
    'week_policies', COUNT(*) FILTER (WHERE fs.app_submit_date >= v_week_start),
    'week_premium', COALESCE(SUM(fs.plan_premium * 12) FILTER (WHERE fs.app_submit_date >= v_week_start), 0),
    'month_policies', COUNT(*) FILTER (WHERE fs.app_submit_date >= v_month_start),
    'month_premium', COALESCE(SUM(fs.plan_premium * 12) FILTER (WHERE fs.app_submit_date >= v_month_start), 0),
    'month_avg_premium', CASE
      WHEN COUNT(*) FILTER (WHERE fs.app_submit_date >= v_month_start) > 0
      THEN ROUND((SUM(fs.plan_premium * 12) FILTER (WHERE fs.app_submit_date >= v_month_start) / COUNT(*) FILTER (WHERE fs.app_submit_date >= v_month_start))::numeric, 2)
      ELSE 0
    END,
    'prev_month_policies', COUNT(*) FILTER (WHERE fs.app_submit_date >= v_prev_month_start AND fs.app_submit_date <= v_prev_month_end),
    'prev_month_premium', COALESCE(SUM(fs.plan_premium * 12) FILTER (WHERE fs.app_submit_date >= v_prev_month_start AND fs.app_submit_date <= v_prev_month_end), 0),
    'prev_month_avg_premium', CASE
      WHEN COUNT(*) FILTER (WHERE fs.app_submit_date >= v_prev_month_start AND fs.app_submit_date <= v_prev_month_end) > 0
      THEN ROUND((SUM(fs.plan_premium * 12) FILTER (WHERE fs.app_submit_date >= v_prev_month_start AND fs.app_submit_date <= v_prev_month_end) / COUNT(*) FILTER (WHERE fs.app_submit_date >= v_prev_month_start AND fs.app_submit_date <= v_prev_month_end))::numeric, 2)
      ELSE 0
    END
  )
  INTO result
  FROM form_submissions fs
  WHERE (
    (p_unl_writing_number IS NOT NULL AND fs.agent_number = p_unl_writing_number)
    OR (p_gtl_writing_number IS NOT NULL AND fs.agent_number = p_gtl_writing_number)
  );

  RETURN COALESCE(result, '{}'::json);
END;
$$;

-- 2. Production history with correct AP
CREATE OR REPLACE FUNCTION get_agent_production_history(
  p_unl_writing_number text DEFAULT NULL,
  p_gtl_writing_number text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_agg(row_to_json(t) ORDER BY t.day)
  INTO result
  FROM (
    SELECT
      d.day::date AS day,
      COALESCE(COUNT(fs.id), 0) AS policies,
      COALESCE(SUM(fs.plan_premium * 12), 0) AS premium
    FROM generate_series(
      CURRENT_DATE - INTERVAL '29 days',
      CURRENT_DATE,
      INTERVAL '1 day'
    ) AS d(day)
    LEFT JOIN form_submissions fs
      ON fs.app_submit_date = d.day::date
      AND (
        (p_unl_writing_number IS NOT NULL AND fs.agent_number = p_unl_writing_number)
        OR (p_gtl_writing_number IS NOT NULL AND fs.agent_number = p_gtl_writing_number)
      )
    GROUP BY d.day
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- 3. Book summary with correct AP
CREATE OR REPLACE FUNCTION get_agent_book_summary(
  p_unl_writing_number text DEFAULT NULL,
  p_gtl_writing_number text DEFAULT NULL,
  p_status_filter text DEFAULT NULL,
  p_page int DEFAULT 1,
  p_page_size int DEFAULT 20
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
  v_offset int := (p_page - 1) * p_page_size;
BEGIN
  SELECT json_build_object(
    'counts', (
      SELECT json_build_object(
        'active', COUNT(*) FILTER (WHERE fs.status = 'active'),
        'pending', COUNT(*) FILTER (WHERE fs.status = 'pending'),
        'terminated', COUNT(*) FILTER (WHERE fs.status = 'cancelled' OR fs.status = 'terminated'),
        'at_risk', COUNT(*) FILTER (WHERE fs.status = 'active' AND fs.paid_to_date IS NOT NULL AND fs.paid_to_date < CURRENT_DATE AND fs.billing_form = 'DIR'),
        'total_premium_in_force', COALESCE(SUM(fs.plan_premium * 12) FILTER (WHERE fs.status = 'active'), 0)
      )
      FROM form_submissions fs
      WHERE (
        (p_unl_writing_number IS NOT NULL AND fs.agent_number = p_unl_writing_number)
        OR (p_gtl_writing_number IS NOT NULL AND fs.agent_number = p_gtl_writing_number)
      )
      AND fs.status != 'duplicate'
    ),
    'policies', (
      SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.policy_effective_date DESC), '[]'::json)
      FROM (
        SELECT
          fs.id,
          fs.policy_number,
          fs.client_first_name,
          fs.client_last_name,
          fs.plan_name,
          fs.carrier,
          fs.plan_premium,
          fs.plan_premium * 12 AS annual_premium,
          fs.status,
          fs.policy_effective_date,
          fs.paid_to_date,
          fs.product_type,
          fs.contract_code,
          fs.billing_mode,
          fs.billing_form,
          CASE WHEN fs.status = 'active' AND fs.paid_to_date IS NOT NULL AND fs.paid_to_date < CURRENT_DATE AND fs.billing_form = 'DIR' THEN true ELSE false END AS is_at_risk
        FROM form_submissions fs
        WHERE (
          (p_unl_writing_number IS NOT NULL AND fs.agent_number = p_unl_writing_number)
          OR (p_gtl_writing_number IS NOT NULL AND fs.agent_number = p_gtl_writing_number)
        )
        AND fs.status != 'duplicate'
        AND (
          p_status_filter IS NULL
          OR (p_status_filter = 'active' AND fs.status = 'active')
          OR (p_status_filter = 'pending' AND fs.status = 'pending')
          OR (p_status_filter = 'terminated' AND (fs.status = 'cancelled' OR fs.status = 'terminated'))
          OR (p_status_filter = 'at_risk' AND fs.status = 'active' AND fs.paid_to_date IS NOT NULL AND fs.paid_to_date < CURRENT_DATE AND fs.billing_form = 'DIR')
        )
        ORDER BY fs.policy_effective_date DESC
        LIMIT p_page_size
        OFFSET v_offset
      ) t
    ),
    'total', (
      SELECT COUNT(*)
      FROM form_submissions fs
      WHERE (
        (p_unl_writing_number IS NOT NULL AND fs.agent_number = p_unl_writing_number)
        OR (p_gtl_writing_number IS NOT NULL AND fs.agent_number = p_gtl_writing_number)
      )
      AND fs.status != 'duplicate'
      AND (
        p_status_filter IS NULL
        OR (p_status_filter = 'active' AND fs.status = 'active')
        OR (p_status_filter = 'pending' AND fs.status = 'pending')
        OR (p_status_filter = 'terminated' AND (fs.status = 'cancelled' OR fs.status = 'terminated'))
        OR (p_status_filter = 'at_risk' AND fs.status = 'active' AND fs.paid_to_date IS NOT NULL AND fs.paid_to_date < CURRENT_DATE AND fs.billing_form = 'DIR')
      )
    )
  )
  INTO result;

  RETURN COALESCE(result, '{}'::json);
END;
$$;
