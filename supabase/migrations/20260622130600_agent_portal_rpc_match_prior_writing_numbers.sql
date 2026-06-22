/*
  # Agent-portal RPCs: match prior/alias writing numbers

  Redefines (CREATE OR REPLACE) the agent-portal RPC functions so that policy
  attribution also matches an agent's `prior_writing_numbers` (legacy numbers),
  not just the current UNL/GTL writing number.

  Why: Historical `form_submissions` rows stay stamped with an agent's OLD
  `agent_number` after a writing-number change. The portal previously matched
  only the current number, so the agent lost their historical book in the portal.

  Approach: Each writing-number-driven function builds a single text[] of ALL
  valid numbers at the top -- the passed current UNL/GTL numbers plus any
  `prior_writing_numbers` recorded on the matching agents row -- and replaces the
  old `(fs.agent_number = p_unl... OR fs.agent_number = p_gtl...)` predicate with
  `fs.agent_number = ANY(v_numbers)`.

  Signatures, return types, SECURITY DEFINER, and AP math (plan_premium * 12 where
  the latest definitions use it) are preserved exactly.

  These definitions reflect the CURRENT/latest version of each function:
    - get_agent_dashboard_stats      (latest: 20260528183209 AP fix)
    - get_agent_production_history   (latest: 20260528183209 AP fix)
    - get_agent_book_summary         (latest: 20260528183209 AP fix)
    - get_agent_leaderboard_position (only defined in 20260515175228)

  Read-only w.r.t. production: does NOT modify form_submissions.
*/

-- 0. Helper: resolve the full set of valid writing numbers for a portal request.
--    Returns the passed current UNL/GTL numbers plus any prior_writing_numbers
--    recorded on the matching agents row(s). Always returns a non-NULL text[]
--    (empty array if nothing passed) so `= ANY(...)` is safe.
CREATE OR REPLACE FUNCTION agent_portal_resolve_numbers(
  p_unl_writing_number text DEFAULT NULL,
  p_gtl_writing_number text DEFAULT NULL
)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(
    array_agg(DISTINCT n) FILTER (WHERE n IS NOT NULL AND n <> ''),
    '{}'::text[]
  )
  FROM (
    SELECT p_unl_writing_number AS n
    UNION
    SELECT p_gtl_writing_number
    UNION
    SELECT unnest(a.prior_writing_numbers)
    FROM agents a
    WHERE (p_unl_writing_number IS NOT NULL AND a.unl_writing_number = p_unl_writing_number)
       OR (p_gtl_writing_number IS NOT NULL AND a.gtl_writing_number = p_gtl_writing_number)
  ) s;
$$;

-- 1. Dashboard stats (AP = plan_premium * 12), now matching prior numbers
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
  v_numbers text[];
BEGIN
  v_numbers := agent_portal_resolve_numbers(p_unl_writing_number, p_gtl_writing_number);

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
  WHERE fs.agent_number = ANY(v_numbers);

  RETURN COALESCE(result, '{}'::json);
END;
$$;

-- 2. Production history (AP = plan_premium * 12), now matching prior numbers
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
  v_numbers text[];
BEGIN
  v_numbers := agent_portal_resolve_numbers(p_unl_writing_number, p_gtl_writing_number);

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
      AND fs.agent_number = ANY(v_numbers)
    GROUP BY d.day
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- 3. Book summary (AP = plan_premium * 12), now matching prior numbers
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
  v_numbers text[];
BEGIN
  v_numbers := agent_portal_resolve_numbers(p_unl_writing_number, p_gtl_writing_number);

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
      WHERE fs.agent_number = ANY(v_numbers)
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
        WHERE fs.agent_number = ANY(v_numbers)
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
      WHERE fs.agent_number = ANY(v_numbers)
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

-- 4. Leaderboard position: include prior numbers in per-agent join match
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
      ON (
        fs.agent_number = a.unl_writing_number
        OR fs.agent_number = a.gtl_writing_number
        OR fs.agent_number = ANY(a.prior_writing_numbers)
      )
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
