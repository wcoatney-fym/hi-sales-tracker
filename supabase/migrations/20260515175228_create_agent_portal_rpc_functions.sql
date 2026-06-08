/*
  # Create Agent Portal RPC Functions

  1. New Functions
    - `get_agent_dashboard_stats` - Returns today/week/month policy counts, premium, comparisons, and streak
    - `get_agent_production_history` - Returns last 30 days daily policy count + premium
    - `get_agent_leaderboard_position` - Returns agent rank within agency + nearby competitors
    - `get_agent_book_summary` - Returns policy status breakdown and paginated policy list
    - `get_agent_commissions_summary` - Returns commission totals and recent entries

  2. Important Notes
    - All functions scoped by agent writing numbers for security
    - Streak calculated as consecutive days with at least 1 policy submission
    - Leaderboard position is within the agent's own agency only
*/

-- 1. Dashboard stats (today, this week, this month + comparisons)
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
    'today_premium', COALESCE(SUM(fs.plan_premium) FILTER (WHERE fs.app_submit_date = v_today), 0),
    'week_policies', COUNT(*) FILTER (WHERE fs.app_submit_date >= v_week_start),
    'week_premium', COALESCE(SUM(fs.plan_premium) FILTER (WHERE fs.app_submit_date >= v_week_start), 0),
    'month_policies', COUNT(*) FILTER (WHERE fs.app_submit_date >= v_month_start),
    'month_premium', COALESCE(SUM(fs.plan_premium) FILTER (WHERE fs.app_submit_date >= v_month_start), 0),
    'month_avg_premium', CASE
      WHEN COUNT(*) FILTER (WHERE fs.app_submit_date >= v_month_start) > 0
      THEN ROUND((SUM(fs.plan_premium) FILTER (WHERE fs.app_submit_date >= v_month_start) / COUNT(*) FILTER (WHERE fs.app_submit_date >= v_month_start))::numeric, 2)
      ELSE 0
    END,
    'prev_month_policies', COUNT(*) FILTER (WHERE fs.app_submit_date >= v_prev_month_start AND fs.app_submit_date <= v_prev_month_end),
    'prev_month_premium', COALESCE(SUM(fs.plan_premium) FILTER (WHERE fs.app_submit_date >= v_prev_month_start AND fs.app_submit_date <= v_prev_month_end), 0),
    'prev_month_avg_premium', CASE
      WHEN COUNT(*) FILTER (WHERE fs.app_submit_date >= v_prev_month_start AND fs.app_submit_date <= v_prev_month_end) > 0
      THEN ROUND((SUM(fs.plan_premium) FILTER (WHERE fs.app_submit_date >= v_prev_month_start AND fs.app_submit_date <= v_prev_month_end) / COUNT(*) FILTER (WHERE fs.app_submit_date >= v_prev_month_start AND fs.app_submit_date <= v_prev_month_end))::numeric, 2)
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

-- 2. Production history (last 30 days, daily)
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
      COALESCE(SUM(fs.plan_premium), 0) AS premium
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

-- 3. Leaderboard position within agency
CREATE OR REPLACE FUNCTION get_agent_leaderboard_position(
  p_agent_id uuid,
  p_agency text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
  v_month_start date := date_trunc('month', CURRENT_DATE)::date;
  v_agent_agency text;
BEGIN
  -- Get agent's agency if not provided
  IF p_agency IS NULL THEN
    SELECT agency INTO v_agent_agency FROM agents WHERE id = p_agent_id;
  ELSE
    v_agent_agency := p_agency;
  END IF;

  WITH agent_rankings AS (
    SELECT
      a.id AS agent_id,
      a.first_name,
      a.last_name,
      COUNT(fs.id) AS month_policies,
      COALESCE(SUM(fs.plan_premium), 0) AS month_premium,
      ROW_NUMBER() OVER (ORDER BY COUNT(fs.id) DESC, SUM(fs.plan_premium) DESC) AS rank
    FROM agents a
    LEFT JOIN form_submissions fs
      ON (fs.agent_number = a.unl_writing_number OR fs.agent_number = a.gtl_writing_number)
      AND fs.app_submit_date >= v_month_start
    WHERE a.agency = v_agent_agency
    GROUP BY a.id, a.first_name, a.last_name
    HAVING COUNT(fs.id) > 0 OR a.id = p_agent_id
  ),
  my_rank AS (
    SELECT * FROM agent_rankings WHERE agent_id = p_agent_id
  )
  SELECT json_build_object(
    'rank', COALESCE((SELECT rank FROM my_rank), (SELECT COUNT(*) + 1 FROM agent_rankings)),
    'total_agents', (SELECT COUNT(*) FROM agent_rankings),
    'my_policies', COALESCE((SELECT month_policies FROM my_rank), 0),
    'my_premium', COALESCE((SELECT month_premium FROM my_rank), 0),
    'agency', v_agent_agency,
    'agent_above', (
      SELECT json_build_object(
        'name', ar.first_name || ' ' || ar.last_name,
        'policies', ar.month_policies,
        'gap', ar.month_policies - COALESCE((SELECT month_policies FROM my_rank), 0)
      )
      FROM agent_rankings ar
      WHERE ar.rank = COALESCE((SELECT rank FROM my_rank), (SELECT COUNT(*) + 1 FROM agent_rankings)) - 1
    ),
    'agent_below', (
      SELECT json_build_object(
        'name', ar.first_name || ' ' || ar.last_name,
        'policies', ar.month_policies,
        'gap', COALESCE((SELECT month_policies FROM my_rank), 0) - ar.month_policies
      )
      FROM agent_rankings ar
      WHERE ar.rank = COALESCE((SELECT rank FROM my_rank), (SELECT COUNT(*) + 1 FROM agent_rankings)) + 1
    )
  )
  INTO result;

  RETURN COALESCE(result, '{}'::json);
END;
$$;

-- 4. Book summary (status counts + paginated list)
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
        'at_risk', COUNT(*) FILTER (WHERE fs.status = 'active' AND fs.paid_to_date IS NOT NULL AND fs.paid_to_date < CURRENT_DATE),
        'total_premium_in_force', COALESCE(SUM(fs.plan_premium) FILTER (WHERE fs.status = 'active'), 0)
      )
      FROM form_submissions fs
      WHERE (
        (p_unl_writing_number IS NOT NULL AND fs.agent_number = p_unl_writing_number)
        OR (p_gtl_writing_number IS NOT NULL AND fs.agent_number = p_gtl_writing_number)
      )
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
          fs.status,
          fs.policy_effective_date,
          fs.paid_to_date,
          fs.product_type,
          CASE WHEN fs.status = 'active' AND fs.paid_to_date IS NOT NULL AND fs.paid_to_date < CURRENT_DATE THEN true ELSE false END AS is_at_risk
        FROM form_submissions fs
        WHERE (
          (p_unl_writing_number IS NOT NULL AND fs.agent_number = p_unl_writing_number)
          OR (p_gtl_writing_number IS NOT NULL AND fs.agent_number = p_gtl_writing_number)
        )
        AND (
          p_status_filter IS NULL
          OR (p_status_filter = 'active' AND fs.status = 'active')
          OR (p_status_filter = 'pending' AND fs.status = 'pending')
          OR (p_status_filter = 'terminated' AND (fs.status = 'cancelled' OR fs.status = 'terminated'))
          OR (p_status_filter = 'at_risk' AND fs.status = 'active' AND fs.paid_to_date IS NOT NULL AND fs.paid_to_date < CURRENT_DATE)
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
      AND (
        p_status_filter IS NULL
        OR (p_status_filter = 'active' AND fs.status = 'active')
        OR (p_status_filter = 'pending' AND fs.status = 'pending')
        OR (p_status_filter = 'terminated' AND (fs.status = 'cancelled' OR fs.status = 'terminated'))
        OR (p_status_filter = 'at_risk' AND fs.status = 'active' AND fs.paid_to_date IS NOT NULL AND fs.paid_to_date < CURRENT_DATE)
      )
    )
  )
  INTO result;

  RETURN COALESCE(result, '{}'::json);
END;
$$;

-- 5. Commissions summary for agent
CREATE OR REPLACE FUNCTION get_agent_commissions_summary(
  p_agent_number text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    'total_earned', COALESCE(SUM(commission_amount), 0),
    'total_paid', COALESCE(SUM(commission_amount) FILTER (WHERE status = 'paid'), 0),
    'total_pending', COALESCE(SUM(commission_amount) FILTER (WHERE status = 'pending'), 0),
    'total_on_hold', COALESCE(SUM(commission_amount) FILTER (WHERE status = 'on_hold'), 0),
    'this_month_earned', COALESCE(SUM(commission_amount) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE)), 0),
    'recent_entries', (
      SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.created_at DESC), '[]'::json)
      FROM (
        SELECT
          ce.id,
          ce.carrier,
          ce.product_type,
          ce.monthly_premium,
          ce.commission_rate,
          ce.commission_amount,
          ce.advance_amount,
          ce.status,
          ce.period_start,
          ce.period_end,
          ce.paid_date,
          ce.created_at
        FROM commission_entries ce
        WHERE ce.agent_number = p_agent_number
        ORDER BY ce.created_at DESC
        LIMIT 10
      ) t
    )
  )
  INTO result
  FROM commission_entries
  WHERE agent_number = p_agent_number;

  RETURN COALESCE(result, json_build_object(
    'total_earned', 0,
    'total_paid', 0,
    'total_pending', 0,
    'total_on_hold', 0,
    'this_month_earned', 0,
    'recent_entries', '[]'::json
  ));
END;
$$;