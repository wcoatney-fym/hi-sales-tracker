/*
  # Agent Goals, Attention Actions, and Quality Metrics

  1. New Tables
    - `wa_personal_goals`
      - `id` (uuid, primary key)
      - `agent_id` (uuid, FK to agents)
      - `monthly_ap_target` (numeric, not null)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    - `policy_attention_actions`
      - `id` (uuid, primary key)
      - `agent_id` (uuid, FK to agents)
      - `form_submission_id` (uuid, FK to form_submissions)
      - `state` (text: got_it, working, done)
      - `updated_at` (timestamptz)

  2. New RPC Functions
    - `get_agent_quality_snapshot` - Computes retention/persistency metrics from form_submissions
    - Updated `get_agent_book_summary` - Now includes contract_code, billing_mode, billing_form

  3. Security
    - RLS enabled on both new tables
    - Policies restrict access to authenticated service role
*/

-- wa_personal_goals table
CREATE TABLE IF NOT EXISTS wa_personal_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  monthly_ap_target numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT wa_personal_goals_agent_unique UNIQUE (agent_id)
);

ALTER TABLE wa_personal_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage goals"
  ON wa_personal_goals
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- policy_attention_actions table
CREATE TABLE IF NOT EXISTS policy_attention_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  form_submission_id uuid NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'got_it',
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT policy_attention_actions_unique UNIQUE (agent_id, form_submission_id),
  CONSTRAINT policy_attention_actions_state_check CHECK (state IN ('got_it', 'working', 'done'))
);

ALTER TABLE policy_attention_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage attention actions"
  ON policy_attention_actions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_policy_attention_actions_agent
  ON policy_attention_actions(agent_id);

CREATE INDEX IF NOT EXISTS idx_policy_attention_actions_state
  ON policy_attention_actions(agent_id, state);

-- Quality snapshot RPC
CREATE OR REPLACE FUNCTION get_agent_quality_snapshot(
  p_unl_writing_number text DEFAULT NULL,
  p_gtl_writing_number text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
  v_first_effective_date date;
  v_today date := CURRENT_DATE;
BEGIN
  -- Find earliest effective date for this agent
  SELECT MIN(fs.policy_effective_date)
  INTO v_first_effective_date
  FROM form_submissions fs
  WHERE (
    (p_unl_writing_number IS NOT NULL AND fs.agent_number = p_unl_writing_number)
    OR (p_gtl_writing_number IS NOT NULL AND fs.agent_number = p_gtl_writing_number)
  )
  AND fs.status != 'duplicate';

  SELECT json_build_object(
    'first_effective_date', v_first_effective_date,
    'policies_taken', (
      SELECT COUNT(*)
      FROM form_submissions fs
      WHERE (
        (p_unl_writing_number IS NOT NULL AND fs.agent_number = p_unl_writing_number)
        OR (p_gtl_writing_number IS NOT NULL AND fs.agent_number = p_gtl_writing_number)
      )
      AND fs.status = 'active'
      AND fs.policy_effective_date >= date_trunc('month', v_today)
    ),
    'policies_taken_ytd', (
      SELECT COUNT(*)
      FROM form_submissions fs
      WHERE (
        (p_unl_writing_number IS NOT NULL AND fs.agent_number = p_unl_writing_number)
        OR (p_gtl_writing_number IS NOT NULL AND fs.agent_number = p_gtl_writing_number)
      )
      AND fs.status = 'active'
      AND fs.policy_effective_date >= date_trunc('year', v_today)
    ),
    'retention_30d', (
      SELECT CASE
        WHEN COUNT(*) = 0 THEN NULL
        ELSE ROUND(
          COUNT(*) FILTER (WHERE fs.contract_code = 'A' OR fs.status = 'active')::numeric
          / COUNT(*)::numeric * 100, 1
        )
      END
      FROM form_submissions fs
      WHERE (
        (p_unl_writing_number IS NOT NULL AND fs.agent_number = p_unl_writing_number)
        OR (p_gtl_writing_number IS NOT NULL AND fs.agent_number = p_gtl_writing_number)
      )
      AND fs.status != 'duplicate'
      AND fs.policy_effective_date BETWEEN (v_today - INTERVAL '60 days')::date AND (v_today - INTERVAL '30 days')::date
    ),
    'retention_30d_eligible', (v_first_effective_date IS NOT NULL AND v_first_effective_date <= (v_today - INTERVAL '30 days')::date),
    'retention_30d_eligible_date', (v_first_effective_date + INTERVAL '30 days')::date,
    'retention_90d', (
      SELECT CASE
        WHEN COUNT(*) = 0 THEN NULL
        ELSE ROUND(
          COUNT(*) FILTER (WHERE fs.contract_code = 'A' OR fs.status = 'active')::numeric
          / COUNT(*)::numeric * 100, 1
        )
      END
      FROM form_submissions fs
      WHERE (
        (p_unl_writing_number IS NOT NULL AND fs.agent_number = p_unl_writing_number)
        OR (p_gtl_writing_number IS NOT NULL AND fs.agent_number = p_gtl_writing_number)
      )
      AND fs.status != 'duplicate'
      AND fs.policy_effective_date BETWEEN (v_today - INTERVAL '120 days')::date AND (v_today - INTERVAL '90 days')::date
    ),
    'retention_90d_eligible', (v_first_effective_date IS NOT NULL AND v_first_effective_date <= (v_today - INTERVAL '90 days')::date),
    'retention_90d_eligible_date', (v_first_effective_date + INTERVAL '90 days')::date,
    'persistency_9mo', (
      SELECT CASE
        WHEN COUNT(*) = 0 THEN NULL
        ELSE ROUND(
          COUNT(*) FILTER (WHERE fs.contract_code = 'A' OR fs.status = 'active')::numeric
          / COUNT(*)::numeric * 100, 1
        )
      END
      FROM form_submissions fs
      WHERE (
        (p_unl_writing_number IS NOT NULL AND fs.agent_number = p_unl_writing_number)
        OR (p_gtl_writing_number IS NOT NULL AND fs.agent_number = p_gtl_writing_number)
      )
      AND fs.status != 'duplicate'
      AND fs.policy_effective_date BETWEEN (v_today - INTERVAL '10 months')::date AND (v_today - INTERVAL '9 months')::date
    ),
    'persistency_9mo_eligible', (v_first_effective_date IS NOT NULL AND v_first_effective_date <= (v_today - INTERVAL '9 months')::date),
    'persistency_9mo_eligible_date', (v_first_effective_date + INTERVAL '9 months')::date,
    'persistency_13mo', (
      SELECT CASE
        WHEN COUNT(*) = 0 THEN NULL
        ELSE ROUND(
          COUNT(*) FILTER (WHERE fs.contract_code = 'A' OR fs.status = 'active')::numeric
          / COUNT(*)::numeric * 100, 1
        )
      END
      FROM form_submissions fs
      WHERE (
        (p_unl_writing_number IS NOT NULL AND fs.agent_number = p_unl_writing_number)
        OR (p_gtl_writing_number IS NOT NULL AND fs.agent_number = p_gtl_writing_number)
      )
      AND fs.status != 'duplicate'
      AND fs.policy_effective_date BETWEEN (v_today - INTERVAL '14 months')::date AND (v_today - INTERVAL '13 months')::date
    ),
    'persistency_13mo_eligible', (v_first_effective_date IS NOT NULL AND v_first_effective_date <= (v_today - INTERVAL '13 months')::date),
    'persistency_13mo_eligible_date', (v_first_effective_date + INTERVAL '13 months')::date,
    'attention_rate', (
      SELECT CASE
        WHEN COUNT(*) FILTER (WHERE fs.status = 'active') = 0 THEN NULL
        ELSE ROUND(
          COUNT(*) FILTER (WHERE fs.status = 'active' AND fs.paid_to_date IS NOT NULL AND fs.paid_to_date < v_today AND fs.billing_form = 'DIR')::numeric
          / COUNT(*) FILTER (WHERE fs.status = 'active')::numeric * 100, 1
        )
      END
      FROM form_submissions fs
      WHERE (
        (p_unl_writing_number IS NOT NULL AND fs.agent_number = p_unl_writing_number)
        OR (p_gtl_writing_number IS NOT NULL AND fs.agent_number = p_gtl_writing_number)
      )
      AND fs.status != 'duplicate'
    )
  )
  INTO result;

  RETURN COALESCE(result, '{}'::json);
END;
$$;

-- Updated book summary to include contract_code, billing_mode, billing_form
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
        'total_premium_in_force', COALESCE(SUM(fs.plan_premium) FILTER (WHERE fs.status = 'active'), 0)
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
