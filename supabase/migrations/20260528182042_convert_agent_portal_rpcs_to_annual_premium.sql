/*
  # Convert Agent Portal RPCs to Use Annual Premium (AP)

  1. Changes
    - Updated `get_agent_dashboard_stats` to return annualized premium (AP) instead of monthly premium
    - Updated `get_agent_book_summary` to return AP in force and per-policy AP
    - Updated `get_agent_production_history` to return AP

  2. AP Calculation Logic
    - billing_mode = '0' (Single): AP = plan_premium (single pay, no annualization)
    - billing_mode = '1' (Monthly) or NULL: AP = plan_premium * 12 (default assumption)
    - billing_mode = '3' (Quarterly): AP = plan_premium * 4
    - billing_mode = '6' (Semi-Annual): AP = plan_premium * 2
    - billing_mode = '12' (Annual): AP = plan_premium * 1

  3. Important Notes
    - NULL billing_mode defaults to monthly (x12) since most policies are monthly
    - All premium-related return values are now annualized
    - Policy-level data includes both plan_premium (monthly) and annual_premium (computed)
*/

-- Helper: compute annualized premium from plan_premium and billing_mode
-- Not a stored function to avoid cross-dependency; logic inlined in each RPC

-- 1. Dashboard stats with AP
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
    'today_premium', COALESCE(SUM(
      fs.plan_premium * CASE
        WHEN fs.billing_mode = '0' THEN 1
        WHEN fs.billing_mode = '3' THEN 4
        WHEN fs.billing_mode = '6' THEN 2
        WHEN fs.billing_mode = '12' THEN 1
        ELSE 12
      END
    ) FILTER (WHERE fs.app_submit_date = v_today), 0),
    'week_policies', COUNT(*) FILTER (WHERE fs.app_submit_date >= v_week_start),
    'week_premium', COALESCE(SUM(
      fs.plan_premium * CASE
        WHEN fs.billing_mode = '0' THEN 1
        WHEN fs.billing_mode = '3' THEN 4
        WHEN fs.billing_mode = '6' THEN 2
        WHEN fs.billing_mode = '12' THEN 1
        ELSE 12
      END
    ) FILTER (WHERE fs.app_submit_date >= v_week_start), 0),
    'month_policies', COUNT(*) FILTER (WHERE fs.app_submit_date >= v_month_start),
    'month_premium', COALESCE(SUM(
      fs.plan_premium * CASE
        WHEN fs.billing_mode = '0' THEN 1
        WHEN fs.billing_mode = '3' THEN 4
        WHEN fs.billing_mode = '6' THEN 2
        WHEN fs.billing_mode = '12' THEN 1
        ELSE 12
      END
    ) FILTER (WHERE fs.app_submit_date >= v_month_start), 0),
    'month_avg_premium', CASE
      WHEN COUNT(*) FILTER (WHERE fs.app_submit_date >= v_month_start) > 0
      THEN ROUND((SUM(
        fs.plan_premium * CASE
          WHEN fs.billing_mode = '0' THEN 1
          WHEN fs.billing_mode = '3' THEN 4
          WHEN fs.billing_mode = '6' THEN 2
          WHEN fs.billing_mode = '12' THEN 1
          ELSE 12
        END
      ) FILTER (WHERE fs.app_submit_date >= v_month_start) / COUNT(*) FILTER (WHERE fs.app_submit_date >= v_month_start))::numeric, 2)
      ELSE 0
    END,
    'prev_month_policies', COUNT(*) FILTER (WHERE fs.app_submit_date >= v_prev_month_start AND fs.app_submit_date <= v_prev_month_end),
    'prev_month_premium', COALESCE(SUM(
      fs.plan_premium * CASE
        WHEN fs.billing_mode = '0' THEN 1
        WHEN fs.billing_mode = '3' THEN 4
        WHEN fs.billing_mode = '6' THEN 2
        WHEN fs.billing_mode = '12' THEN 1
        ELSE 12
      END
    ) FILTER (WHERE fs.app_submit_date >= v_prev_month_start AND fs.app_submit_date <= v_prev_month_end), 0),
    'prev_month_avg_premium', CASE
      WHEN COUNT(*) FILTER (WHERE fs.app_submit_date >= v_prev_month_start AND fs.app_submit_date <= v_prev_month_end) > 0
      THEN ROUND((SUM(
        fs.plan_premium * CASE
          WHEN fs.billing_mode = '0' THEN 1
          WHEN fs.billing_mode = '3' THEN 4
          WHEN fs.billing_mode = '6' THEN 2
          WHEN fs.billing_mode = '12' THEN 1
          ELSE 12
        END
      ) FILTER (WHERE fs.app_submit_date >= v_prev_month_start AND fs.app_submit_date <= v_prev_month_end) / COUNT(*) FILTER (WHERE fs.app_submit_date >= v_prev_month_start AND fs.app_submit_date <= v_prev_month_end))::numeric, 2)
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

-- 2. Production history with AP
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
      COALESCE(SUM(
        fs.plan_premium * CASE
          WHEN fs.billing_mode = '0' THEN 1
          WHEN fs.billing_mode = '3' THEN 4
          WHEN fs.billing_mode = '6' THEN 2
          WHEN fs.billing_mode = '12' THEN 1
          ELSE 12
        END
      ), 0) AS premium
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

-- 3. Book summary with AP
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
        'total_premium_in_force', COALESCE(SUM(
          fs.plan_premium * CASE
            WHEN fs.billing_mode = '0' THEN 1
            WHEN fs.billing_mode = '3' THEN 4
            WHEN fs.billing_mode = '6' THEN 2
            WHEN fs.billing_mode = '12' THEN 1
            ELSE 12
          END
        ) FILTER (WHERE fs.status = 'active'), 0)
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
          fs.plan_premium * CASE
            WHEN fs.billing_mode = '0' THEN 1
            WHEN fs.billing_mode = '3' THEN 4
            WHEN fs.billing_mode = '6' THEN 2
            WHEN fs.billing_mode = '12' THEN 1
            ELSE 12
          END AS annual_premium,
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
