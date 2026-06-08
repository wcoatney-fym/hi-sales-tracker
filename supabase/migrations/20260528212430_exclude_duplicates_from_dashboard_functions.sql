/*
  # Exclude duplicate and superseded records from dashboard functions

  1. Modified Functions
    - `dashboard_kpis` - Adds filter: status NOT IN ('duplicate', 'superseded')
    - `dashboard_sales_chart` - Adds filter: status NOT IN ('duplicate', 'superseded')
    - `dashboard_enhanced_leaderboard` - Adds filter in all CTEs
    - `dashboard_plan_breakdown` - Adds filter
    - `dashboard_policy_status_kpis` - Adds filter (excludes from total_count and active_count)
    - `get_agent_dashboard_stats` - Adds filter (was missing it)
    - `get_agent_production_history` - Adds filter
    - `get_agent_book_summary` - Extends existing duplicate filter to include superseded

  2. Important Notes
    - Records with status 'duplicate' or 'superseded' are kept in the database
    - They are simply excluded from all dashboard metrics and counts
    - This prevents double-counting policies across Intake Form and Data Source
*/

-- 1. dashboard_kpis (latest overload with agent_number)
CREATE OR REPLACE FUNCTION dashboard_kpis(
  p_start_date text,
  p_end_date text,
  p_agency text DEFAULT NULL,
  p_agencies text[] DEFAULT NULL,
  p_agent_number text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    'policies_sold', COUNT(*),
    'total_premium_sum', COALESCE(SUM(plan_premium), 0),
    'active_agents', COUNT(DISTINCT (agent_first_name || '|' || agent_last_name)),
    'new_clients', COUNT(DISTINCT (client_first_name || '|' || client_last_name || '|' || COALESCE(email, '')))
  )
  INTO result
  FROM form_submissions
  WHERE app_submit_date >= p_start_date::date
    AND app_submit_date < p_end_date::date
    AND status NOT IN ('duplicate', 'superseded')
    AND (
      CASE
        WHEN p_agent_number IS NOT NULL THEN agent_number = p_agent_number
        WHEN p_agencies IS NOT NULL THEN agency = ANY(p_agencies)
        WHEN p_agency IS NOT NULL THEN agency = p_agency
        ELSE TRUE
      END
    );

  RETURN result;
END;
$$;

-- 2. dashboard_sales_chart (latest overload with agent_number)
CREATE OR REPLACE FUNCTION dashboard_sales_chart(
  p_start_date text,
  p_end_date text,
  p_agency text DEFAULT NULL,
  p_bucket text DEFAULT 'day',
  p_agencies text[] DEFAULT NULL,
  p_agent_number text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_agg(row_to_json(t) ORDER BY t.bucket_date)
  INTO result
  FROM (
    SELECT
      CASE p_bucket
        WHEN 'month' THEN to_char(app_submit_date, 'YYYY-MM')
        WHEN 'week' THEN to_char(date_trunc('week', app_submit_date), 'YYYY-MM-DD')
        ELSE to_char(app_submit_date, 'YYYY-MM-DD')
      END AS bucket_date,
      COUNT(*) AS policies,
      COALESCE(SUM(plan_premium), 0) AS premium_sum
    FROM form_submissions
    WHERE app_submit_date >= p_start_date::date
      AND app_submit_date < p_end_date::date
      AND status NOT IN ('duplicate', 'superseded')
      AND (
        CASE
          WHEN p_agent_number IS NOT NULL THEN agent_number = p_agent_number
          WHEN p_agencies IS NOT NULL THEN agency = ANY(p_agencies)
          WHEN p_agency IS NOT NULL THEN agency = p_agency
          ELSE TRUE
        END
      )
    GROUP BY bucket_date
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- 3. dashboard_enhanced_leaderboard
CREATE OR REPLACE FUNCTION dashboard_enhanced_leaderboard(
  p_start_date text,
  p_end_date text,
  p_agency text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  WITH period_data AS (
    SELECT
      fs.agent_first_name,
      fs.agent_last_name,
      fs.agent_number,
      MAX(fs.carrier) AS carrier,
      MAX(fs.agency) AS agency,
      COUNT(*) AS policies,
      COALESCE(SUM(fs.plan_premium * 12), 0) AS annual_premium,
      COALESCE(AVG(fs.plan_premium), 0) AS avg_monthly_premium,
      MAX(fs.app_submit_date) AS last_sale_date
    FROM form_submissions fs
    WHERE fs.app_submit_date >= p_start_date::date
      AND fs.app_submit_date < p_end_date::date
      AND fs.status NOT IN ('duplicate', 'superseded')
      AND (p_agency IS NULL OR fs.agency = p_agency)
      AND fs.app_submit_date IS NOT NULL
    GROUP BY fs.agent_first_name, fs.agent_last_name, fs.agent_number
  ),
  last30 AS (
    SELECT
      fs.agent_number,
      COUNT(*) AS policies_30d,
      COALESCE(SUM(fs.plan_premium * 12), 0) AS premium_30d
    FROM form_submissions fs
    WHERE fs.app_submit_date >= (CURRENT_DATE - 30)
      AND fs.app_submit_date <= CURRENT_DATE
      AND fs.status NOT IN ('duplicate', 'superseded')
      AND (p_agency IS NULL OR fs.agency = p_agency)
      AND fs.app_submit_date IS NOT NULL
    GROUP BY fs.agent_number
  ),
  prior30 AS (
    SELECT
      fs.agent_number,
      COUNT(*) AS policies_prior,
      COALESCE(SUM(fs.plan_premium * 12), 0) AS premium_prior
    FROM form_submissions fs
    WHERE fs.app_submit_date >= (CURRENT_DATE - 60)
      AND fs.app_submit_date < (CURRENT_DATE - 30)
      AND fs.status NOT IN ('duplicate', 'superseded')
      AND (p_agency IS NULL OR fs.agency = p_agency)
      AND fs.app_submit_date IS NOT NULL
    GROUP BY fs.agent_number
  ),
  weekly AS (
    SELECT
      fs.agent_number,
      json_agg(
        json_build_object(
          'week', wk.week_start::text,
          'policies', COALESCE(wk.cnt, 0),
          'premium', COALESCE(wk.prem, 0)
        ) ORDER BY wk.week_start
      ) AS weekly_data
    FROM (
      SELECT DISTINCT agent_number FROM form_submissions
      WHERE app_submit_date >= (CURRENT_DATE - 56)
        AND status NOT IN ('duplicate', 'superseded')
        AND (p_agency IS NULL OR agency = p_agency)
        AND app_submit_date IS NOT NULL
    ) fs
    CROSS JOIN LATERAL (
      SELECT
        gs::date AS week_start,
        COUNT(f2.id) AS cnt,
        COALESCE(SUM(f2.plan_premium * 12), 0) AS prem
      FROM generate_series(CURRENT_DATE - 56, CURRENT_DATE - 7, '7 days'::interval) gs
      LEFT JOIN form_submissions f2
        ON f2.agent_number = fs.agent_number
        AND f2.app_submit_date >= gs::date
        AND f2.app_submit_date < (gs::date + 7)
        AND f2.status NOT IN ('duplicate', 'superseded')
        AND (p_agency IS NULL OR f2.agency = p_agency)
      GROUP BY gs
    ) wk
    GROUP BY fs.agent_number
  )
  SELECT json_agg(row_to_json(t) ORDER BY t.annual_premium DESC)
  INTO result
  FROM (
    SELECT
      pd.agent_first_name,
      pd.agent_last_name,
      pd.agent_number,
      pd.carrier,
      pd.agency,
      pd.policies::int,
      pd.annual_premium::float,
      pd.avg_monthly_premium::float,
      pd.last_sale_date::text,
      COALESCE(l.policies_30d, 0)::int AS policies_30d,
      COALESCE(l.premium_30d, 0)::float AS premium_30d,
      COALESCE(p.policies_prior, 0)::int AS policies_prior,
      COALESCE(p.premium_prior, 0)::float AS premium_prior,
      CASE
        WHEN COALESCE(p.premium_prior, 0) = 0 AND COALESCE(l.premium_30d, 0) > 0 THEN 'up'
        WHEN COALESCE(l.premium_30d, 0) = 0 AND COALESCE(p.premium_prior, 0) > 0 THEN 'down'
        WHEN COALESCE(p.premium_prior, 0) = 0 AND COALESCE(l.premium_30d, 0) = 0 THEN 'flat'
        WHEN (COALESCE(l.premium_30d, 0)::float / NULLIF(p.premium_prior, 0)::float) > 1.2 THEN 'up'
        WHEN (COALESCE(l.premium_30d, 0)::float / NULLIF(p.premium_prior, 0)::float) < 0.8 THEN 'down'
        ELSE 'flat'
      END AS momentum,
      COALESCE(w.weekly_data, '[]'::json) AS weekly_production
    FROM period_data pd
    LEFT JOIN last30 l ON l.agent_number = pd.agent_number
    LEFT JOIN prior30 p ON p.agent_number = pd.agent_number
    LEFT JOIN weekly w ON w.agent_number = pd.agent_number
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- 4. dashboard_plan_breakdown
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
    AND fs.status NOT IN ('duplicate', 'superseded')
    AND (p_agency IS NULL OR fs.agency = p_agency)
    AND (p_agencies IS NULL OR fs.agency = ANY(p_agencies))
  GROUP BY COALESCE(fs.plan_name, 'Unknown')
  ORDER BY COUNT(*) DESC;
END;
$$;

-- 5. dashboard_policy_status_kpis
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
  WHERE status NOT IN ('duplicate', 'superseded')
    AND (
      CASE
        WHEN p_agent_number IS NOT NULL THEN agent_number = p_agent_number
        WHEN p_agencies IS NOT NULL THEN agency = ANY(p_agencies)
        WHEN p_agency IS NOT NULL THEN agency = p_agency
        ELSE TRUE
      END
    );

  RETURN json_build_object(
    'active_count', active_count,
    'terminated_count', terminated_count,
    'pending_count', pending_count,
    'at_risk_count', at_risk_count,
    'total_count', total_count
  );
END;
$$;

-- 6. get_agent_dashboard_stats
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
  )
  AND fs.status NOT IN ('duplicate', 'superseded');

  RETURN COALESCE(result, '{}'::json);
END;
$$;

-- 7. get_agent_production_history
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
      AND fs.status NOT IN ('duplicate', 'superseded')
    GROUP BY d.day
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- 8. get_agent_book_summary - extend duplicate filter to include superseded
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
      AND fs.status NOT IN ('duplicate', 'superseded')
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
        AND fs.status NOT IN ('duplicate', 'superseded')
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
      AND fs.status NOT IN ('duplicate', 'superseded')
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
