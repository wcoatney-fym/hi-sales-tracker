/*
  # Update at-risk RPC functions to filter on billing_form = 'DIR'

  1. Modified Functions
    - `get_at_risk_agents_summary` - at-risk counts now only include DIR policies; denominator stays as all active policies
    - `get_at_risk_policies_for_agent` - only returns DIR policies that are at-risk
    - `get_at_risk_aging_distribution` - only counts DIR policies in aging buckets
    - `get_at_risk_trend` - only counts DIR policies in weekly trend
    - `get_agent_own_at_risk_policies` - agent portal only shows DIR at-risk policies

  2. Important Notes
    - At-risk definition: status='active' AND paid_to_date < CURRENT_DATE AND billing_form = 'DIR'
    - Denominator for at_risk_percentage remains ALL active policies (not just DIR)
    - Policies with NULL or non-DIR billing_form are excluded from at-risk counts
*/

-- 1. Flagged agents summary (denominator = all active, numerator = DIR only)
CREATE OR REPLACE FUNCTION get_at_risk_agents_summary(
  p_agency text DEFAULT NULL,
  p_agencies text[] DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_agg(row_to_json(t) ORDER BY t.at_risk_percentage DESC)
  INTO result
  FROM (
    SELECT
      fs.agent_number,
      fs.agent_first_name,
      fs.agent_last_name,
      fs.agency,
      COUNT(*) FILTER (WHERE fs.status = 'active') AS active_count,
      COUNT(*) FILTER (WHERE fs.status = 'active' AND fs.billing_form = 'DIR' AND fs.paid_to_date IS NOT NULL AND fs.paid_to_date < CURRENT_DATE) AS at_risk_count,
      CASE
        WHEN COUNT(*) FILTER (WHERE fs.status = 'active') > 0
        THEN ROUND((COUNT(*) FILTER (WHERE fs.status = 'active' AND fs.billing_form = 'DIR' AND fs.paid_to_date IS NOT NULL AND fs.paid_to_date < CURRENT_DATE)::numeric
              / COUNT(*) FILTER (WHERE fs.status = 'active') * 100), 1)
        ELSE 0
      END AS at_risk_percentage,
      COALESCE(SUM(fs.plan_premium) FILTER (WHERE fs.status = 'active' AND fs.billing_form = 'DIR' AND fs.paid_to_date IS NOT NULL AND fs.paid_to_date < CURRENT_DATE), 0) AS total_premium_at_risk,
      COALESCE(MAX(CURRENT_DATE - fs.paid_to_date) FILTER (WHERE fs.status = 'active' AND fs.billing_form = 'DIR' AND fs.paid_to_date IS NOT NULL AND fs.paid_to_date < CURRENT_DATE), 0) AS worst_days_lapsed,
      (
        SELECT MAX(ara.created_at)
        FROM at_risk_activities ara
        JOIN form_submissions fs2 ON ara.policy_id = fs2.id
        WHERE fs2.agent_number = fs.agent_number
      ) AS last_activity_date
    FROM form_submissions fs
    WHERE
      fs.agent_number IS NOT NULL
      AND (
        CASE
          WHEN p_agencies IS NOT NULL THEN fs.agency = ANY(p_agencies)
          WHEN p_agency IS NOT NULL THEN fs.agency = p_agency
          ELSE TRUE
        END
      )
    GROUP BY fs.agent_number, fs.agent_first_name, fs.agent_last_name, fs.agency
    HAVING COUNT(*) FILTER (WHERE fs.status = 'active') > 0
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- 2. At-risk policies for a specific agent (admin drill-down, DIR only)
CREATE OR REPLACE FUNCTION get_at_risk_policies_for_agent(
  p_agent_number text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_agg(row_to_json(t) ORDER BY t.days_lapsed DESC)
  INTO result
  FROM (
    SELECT
      fs.id AS policy_id,
      fs.policy_number,
      fs.client_first_name,
      fs.client_last_name,
      fs.plan_name,
      fs.carrier,
      fs.plan_premium,
      fs.policy_effective_date,
      fs.paid_to_date,
      (CURRENT_DATE - fs.paid_to_date) AS days_lapsed,
      (
        SELECT json_agg(json_build_object(
          'id', ara.id,
          'action_type', ara.action_type,
          'note', ara.note,
          'admin_user', ara.admin_user,
          'agent_id', ara.agent_id,
          'created_at', ara.created_at
        ) ORDER BY ara.created_at DESC)
        FROM at_risk_activities ara
        WHERE ara.policy_id = fs.id
      ) AS activities
    FROM form_submissions fs
    WHERE fs.agent_number = p_agent_number
      AND fs.status = 'active'
      AND fs.billing_form = 'DIR'
      AND fs.paid_to_date IS NOT NULL
      AND fs.paid_to_date < CURRENT_DATE
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- 3. Aging distribution (DIR only)
CREATE OR REPLACE FUNCTION get_at_risk_aging_distribution(
  p_agency text DEFAULT NULL,
  p_agencies text[] DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    'bucket_1_15', COUNT(*) FILTER (WHERE (CURRENT_DATE - fs.paid_to_date) BETWEEN 1 AND 15),
    'bucket_16_30', COUNT(*) FILTER (WHERE (CURRENT_DATE - fs.paid_to_date) BETWEEN 16 AND 30),
    'bucket_31_60', COUNT(*) FILTER (WHERE (CURRENT_DATE - fs.paid_to_date) BETWEEN 31 AND 60),
    'bucket_61_plus', COUNT(*) FILTER (WHERE (CURRENT_DATE - fs.paid_to_date) > 60)
  )
  INTO result
  FROM form_submissions fs
  WHERE fs.status = 'active'
    AND fs.billing_form = 'DIR'
    AND fs.paid_to_date IS NOT NULL
    AND fs.paid_to_date < CURRENT_DATE
    AND (
      CASE
        WHEN p_agencies IS NOT NULL THEN fs.agency = ANY(p_agencies)
        WHEN p_agency IS NOT NULL THEN fs.agency = p_agency
        ELSE TRUE
      END
    );

  RETURN result;
END;
$$;

-- 4. Weekly trend over last 90 days (DIR only)
CREATE OR REPLACE FUNCTION get_at_risk_trend(
  p_agency text DEFAULT NULL,
  p_agencies text[] DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_agg(row_to_json(t) ORDER BY t.week_date)
  INTO result
  FROM (
    SELECT
      d.week_date,
      COUNT(*) FILTER (
        WHERE fs.status = 'active'
          AND fs.billing_form = 'DIR'
          AND fs.paid_to_date IS NOT NULL
          AND fs.paid_to_date < d.week_date
          AND fs.policy_effective_date <= d.week_date
      ) AS at_risk_count
    FROM generate_series(
      CURRENT_DATE - INTERVAL '90 days',
      CURRENT_DATE,
      INTERVAL '7 days'
    ) AS d(week_date)
    CROSS JOIN form_submissions fs
    WHERE (
      CASE
        WHEN p_agencies IS NOT NULL THEN fs.agency = ANY(p_agencies)
        WHEN p_agency IS NOT NULL THEN fs.agency = p_agency
        ELSE TRUE
      END
    )
    GROUP BY d.week_date
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- 5. Agent's own at-risk policies (agent portal, DIR only)
CREATE OR REPLACE FUNCTION get_agent_own_at_risk_policies(
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
  SELECT json_agg(row_to_json(t) ORDER BY t.days_lapsed DESC)
  INTO result
  FROM (
    SELECT
      fs.id AS policy_id,
      fs.policy_number,
      fs.client_first_name,
      fs.client_last_name,
      fs.plan_name,
      fs.carrier,
      fs.plan_premium,
      fs.policy_effective_date,
      fs.paid_to_date,
      (CURRENT_DATE - fs.paid_to_date) AS days_lapsed,
      (
        SELECT json_agg(json_build_object(
          'id', ara.id,
          'action_type', ara.action_type,
          'note', ara.note,
          'admin_user', ara.admin_user,
          'agent_id', ara.agent_id,
          'created_at', ara.created_at
        ) ORDER BY ara.created_at DESC)
        FROM at_risk_activities ara
        WHERE ara.policy_id = fs.id
      ) AS activities
    FROM form_submissions fs
    WHERE fs.status = 'active'
      AND fs.billing_form = 'DIR'
      AND fs.paid_to_date IS NOT NULL
      AND fs.paid_to_date < CURRENT_DATE
      AND (
        (p_unl_writing_number IS NOT NULL AND fs.agent_number = p_unl_writing_number)
        OR (p_gtl_writing_number IS NOT NULL AND fs.agent_number = p_gtl_writing_number)
      )
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;