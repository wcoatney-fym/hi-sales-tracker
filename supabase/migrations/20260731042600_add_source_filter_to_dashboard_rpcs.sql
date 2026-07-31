/*
  # Add source = 'Data Source' filter to all dashboard/analytics RPCs

  Fixes intake form rows (source = 'Intake Form') bleeding into dashboard
  KPI cards, charts, graphs, leaderboards, at-risk panels, agent app views,
  and Monte Carlo simulations.

  Only UNL-imported policy data (source = 'Data Source') should feed
  production analytics. Agent intake form submissions are a separate
  data stream and must not inflate policy counts or premium totals.

  Scope: UI data RPCs only. No GHL, lifecycle, or push logic touched.

  Functions updated (32):
    - dashboard_agencies
    - dashboard_agency_breakdown
    - dashboard_agent_breakdown
    - dashboard_agent_leaderboard
    - dashboard_enhanced_leaderboard
    - dashboard_kpis
    - dashboard_plan_breakdown
    - dashboard_policy_status_kpis
    - dashboard_sales_chart
    - get_agent_book_summary
    - get_agent_dashboard_stats
    - get_agent_own_at_risk_policies
    - get_agent_quality_snapshot
    - get_at_risk_agents_summary
    - get_at_risk_aging_distribution
    - get_at_risk_policies_for_agent
    - monte_carlo_daily_history_by_agency
    - monte_carlo_daily_history_by_agency
    - monte_carlo_daily_history_by_agent
    - monte_carlo_meta_by_agency
    - monte_carlo_meta_by_agency
    - monte_carlo_meta_by_agent
    - monte_carlo_monthly_trend_by_agency
    - monte_carlo_monthly_trend_by_agency
    - monte_carlo_monthly_trend_by_agent
*/

CREATE OR REPLACE FUNCTION public.dashboard_agencies()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
result json;
BEGIN
SELECT json_agg(agency ORDER BY agency)
INTO result
FROM (SELECT DISTINCT agency FROM form_submissions
    WHERE source = 'Data Source'
    AND agency IS NOT NULL AND agency != '') t;

RETURN COALESCE(result, '[]'::json);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.dashboard_agency_breakdown(p_start_date text, p_end_date text, p_prev_start text DEFAULT NULL::text, p_prev_end text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
result json;
BEGIN
SELECT json_agg(row_to_json(t) ORDER BY t.revenue DESC)
INTO result
FROM (
SELECT
cur.agency,
cur.policies,
cur.revenue,
cur.avg_premium,
cur.agent_count,
COALESCE(prev.revenue, 0) AS prev_revenue
FROM (
SELECT
COALESCE(agency, 'Unknown') AS agency,
COUNT(*) AS policies,
COALESCE(SUM(plan_premium), 0) * 12 AS revenue,
CASE WHEN COUNT(*) > 0 THEN (SUM(plan_premium) * 12) / COUNT(*) ELSE 0 END AS avg_premium,
COUNT(DISTINCT (agent_first_name || '|' || agent_last_name)) AS agent_count
FROM form_submissions
    WHERE source = 'Data Source'
    AND source = 'Data Source'
    AND app_submit_date >= p_start_date::date
AND app_submit_date < p_end_date::date
AND status NOT IN ('duplicate', 'superseded')
GROUP BY COALESCE(agency, 'Unknown')
) cur
LEFT JOIN (
SELECT
COALESCE(agency, 'Unknown') AS agency,
COALESCE(SUM(plan_premium), 0) * 12 AS revenue
FROM form_submissions
    WHERE source = 'Data Source'
    AND source = 'Data Source'
    AND p_prev_start IS NOT NULL
AND app_submit_date >= p_prev_start::date
AND app_submit_date < p_prev_end::date
AND status NOT IN ('duplicate', 'superseded')
GROUP BY COALESCE(agency, 'Unknown')
) prev ON prev.agency = cur.agency
) t;

RETURN COALESCE(result, '[]'::json);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.dashboard_agent_breakdown(p_start_date text, p_end_date text, p_prev_start text DEFAULT NULL::text, p_prev_end text DEFAULT NULL::text, p_agency text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
result json;
BEGIN
SELECT json_agg(row_to_json(t) ORDER BY t.revenue DESC)
INTO result
FROM (
SELECT
cur.agent_first_name,
cur.agent_last_name,
cur.agent_number,
cur.policies,
cur.revenue,
cur.avg_premium,
COALESCE(prev.revenue, 0) AS prev_revenue
FROM (
SELECT
MODE() WITHIN GROUP (ORDER BY agent_first_name) AS agent_first_name,
MODE() WITHIN GROUP (ORDER BY agent_last_name) AS agent_last_name,
agent_number,
COUNT(*) AS policies,
COALESCE(SUM(plan_premium), 0) * 12 AS revenue,
CASE WHEN COUNT(*) > 0 THEN (SUM(plan_premium) * 12) / COUNT(*) ELSE 0 END AS avg_premium
FROM form_submissions
    WHERE source = 'Data Source'
    AND source = 'Data Source'
    AND app_submit_date >= p_start_date::date
AND app_submit_date < p_end_date::date
AND status NOT IN ('duplicate', 'superseded')
AND (p_agency IS NULL OR agency = p_agency)
GROUP BY agent_number
) cur
LEFT JOIN (
SELECT
agent_number,
COALESCE(SUM(plan_premium), 0) * 12 AS revenue
FROM form_submissions
    WHERE source = 'Data Source'
    AND source = 'Data Source'
    AND p_prev_start IS NOT NULL
AND app_submit_date >= p_prev_start::date
AND app_submit_date < p_prev_end::date
AND status NOT IN ('duplicate', 'superseded')
AND (p_agency IS NULL OR agency = p_agency)
GROUP BY agent_number
) prev ON prev.agent_number = cur.agent_number
) t;

RETURN COALESCE(result, '[]'::json);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.dashboard_agent_leaderboard(p_start_date text, p_end_date text, p_agency text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
result json;
BEGIN
SELECT json_agg(row_to_json(t) ORDER BY t.total_sales DESC)
INTO result
FROM (
SELECT
agent_first_name,
agent_last_name,
agent_number,
MAX(carrier) AS carrier,
COUNT(*) AS policies_sold,
COALESCE(SUM(plan_premium * 12), 0) AS total_sales
FROM form_submissions
    WHERE source = 'Data Source'
    AND source = 'Data Source'
    AND app_submit_date >= p_start_date::date
AND app_submit_date < p_end_date::date
AND (p_agency IS NULL OR agency = p_agency)
GROUP BY agent_first_name, agent_last_name, agent_number
) t;

RETURN COALESCE(result, '[]'::json);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.dashboard_enhanced_leaderboard(p_start_date text, p_end_date text, p_agency text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
result json;
BEGIN
WITH period_data AS (
SELECT
fs.agent_number,
MODE() WITHIN GROUP (ORDER BY fs.agent_first_name) AS agent_first_name,
MODE() WITHIN GROUP (ORDER BY fs.agent_last_name) AS agent_last_name,
MAX(fs.carrier) AS carrier,
MAX(fs.agency) AS agency,
COUNT(*) AS policies,
COALESCE(SUM(fs.plan_premium * 12), 0) AS annual_premium,
COALESCE(AVG(fs.plan_premium), 0) AS avg_monthly_premium,
MAX(fs.app_submit_date) AS last_sale_date
FROM form_submissions fs
WHERE fs.source = 'Data Source'
    AND fs.app_submit_date >= p_start_date::date
AND fs.app_submit_date < p_end_date::date
AND fs.status NOT IN ('duplicate', 'superseded')
AND (p_agency IS NULL OR fs.agency = p_agency)
AND fs.app_submit_date IS NOT NULL
GROUP BY fs.agent_number
),
last30 AS (
SELECT
fs.agent_number,
COUNT(*) AS policies_30d,
COALESCE(SUM(fs.plan_premium * 12), 0) AS premium_30d
FROM form_submissions fs
WHERE fs.source = 'Data Source'
    AND fs.app_submit_date >= (CURRENT_DATE - 30)
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
WHERE fs.source = 'Data Source'
    AND fs.app_submit_date >= (CURRENT_DATE - 60)
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
    WHERE source = 'Data Source'
    AND source = 'Data Source'
    AND app_submit_date >= (CURRENT_DATE - 56)
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
$function$
;

CREATE OR REPLACE FUNCTION public.dashboard_kpis(p_start_date text, p_end_date text, p_agency text DEFAULT NULL::text, p_agencies text[] DEFAULT NULL::text[], p_agent_number text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
    WHERE source = 'Data Source'
    AND source = 'Data Source'
    AND app_submit_date >= p_start_date::date
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
$function$
;

CREATE OR REPLACE FUNCTION public.dashboard_kpis(p_start_date text, p_end_date text, p_agency text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
    WHERE source = 'Data Source'
    AND source = 'Data Source'
    AND app_submit_date >= p_start_date::date
AND app_submit_date < p_end_date::date
AND status NOT IN ('duplicate', 'superseded')
AND (p_agency IS NULL OR agency = p_agency);

RETURN result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.dashboard_kpis(p_start_date text, p_end_date text, p_agency text DEFAULT NULL::text, p_agencies text[] DEFAULT NULL::text[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
    WHERE source = 'Data Source'
    AND source = 'Data Source'
    AND app_submit_date >= p_start_date::date
AND app_submit_date < p_end_date::date
AND status NOT IN ('duplicate', 'superseded')
AND (
CASE
WHEN p_agencies IS NOT NULL THEN agency = ANY(p_agencies)
WHEN p_agency IS NOT NULL THEN agency = p_agency
ELSE TRUE
END
);

RETURN result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.dashboard_plan_breakdown(p_start_date text, p_end_date text, p_agency text DEFAULT NULL::text, p_agencies text[] DEFAULT NULL::text[])
 RETURNS TABLE(plan_name text, policies bigint, revenue numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
RETURN QUERY
SELECT
COALESCE(fs.plan_name, 'Unknown') AS plan_name,
COUNT(*)::bigint AS policies,
COALESCE(SUM(fs.plan_premium::numeric), 0) AS revenue
FROM form_submissions fs
WHERE fs.source = 'Data Source'
    AND fs.app_submit_date >= p_start_date::date
AND fs.app_submit_date <= p_end_date::date
AND fs.status NOT IN ('duplicate', 'superseded')
AND (p_agency IS NULL OR fs.agency = p_agency)
AND (p_agencies IS NULL OR fs.agency = ANY(p_agencies))
GROUP BY COALESCE(fs.plan_name, 'Unknown')
ORDER BY COUNT(*) DESC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.dashboard_policy_status_kpis(p_reference_date text DEFAULT NULL::text, p_period_start_date text DEFAULT NULL::text, p_agency text DEFAULT NULL::text, p_agencies text[] DEFAULT NULL::text[], p_agent_number text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
    WHERE source = 'Data Source'
    AND source = 'Data Source'
    AND status NOT IN ('duplicate', 'superseded')
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
$function$
;

CREATE OR REPLACE FUNCTION public.dashboard_sales_chart(p_start_date text, p_end_date text, p_agency text DEFAULT NULL::text, p_bucket text DEFAULT 'day'::text, p_agencies text[] DEFAULT NULL::text[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
    WHERE source = 'Data Source'
    AND source = 'Data Source'
    AND app_submit_date >= p_start_date::date
AND app_submit_date < p_end_date::date
AND status NOT IN ('duplicate', 'superseded')
AND (
CASE
WHEN p_agencies IS NOT NULL THEN agency = ANY(p_agencies)
WHEN p_agency IS NOT NULL THEN agency = p_agency
ELSE TRUE
END
)
GROUP BY bucket_date
) t;

RETURN COALESCE(result, '[]'::json);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.dashboard_sales_chart(p_start_date text, p_end_date text, p_agency text DEFAULT NULL::text, p_bucket text DEFAULT 'day'::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
    WHERE source = 'Data Source'
    AND source = 'Data Source'
    AND app_submit_date >= p_start_date::date
AND app_submit_date < p_end_date::date
AND status NOT IN ('duplicate', 'superseded')
AND (p_agency IS NULL OR agency = p_agency)
GROUP BY bucket_date
) t;

RETURN COALESCE(result, '[]'::json);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.dashboard_sales_chart(p_start_date text, p_end_date text, p_agency text DEFAULT NULL::text, p_bucket text DEFAULT 'day'::text, p_agencies text[] DEFAULT NULL::text[], p_agent_number text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
    WHERE source = 'Data Source'
    AND source = 'Data Source'
    AND app_submit_date >= p_start_date::date
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_agent_book_summary(p_unl_writing_number text DEFAULT NULL::text, p_gtl_writing_number text DEFAULT NULL::text, p_status_filter text DEFAULT NULL::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
      WHERE fs.source = 'Data Source'
      AND fs.source = 'Data Source'
    AND fs.agent_number = ANY(v_numbers)
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
        WHERE fs.source = 'Data Source'
      AND fs.source = 'Data Source'
    AND fs.agent_number = ANY(v_numbers)
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
      WHERE fs.source = 'Data Source'
      AND fs.source = 'Data Source'
    AND fs.agent_number = ANY(v_numbers)
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_agent_dashboard_stats(p_unl_writing_number text DEFAULT NULL::text, p_gtl_writing_number text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
  WHERE fs.source = 'Data Source'
      AND fs.source = 'Data Source'
    AND fs.agent_number = ANY(v_numbers);

  RETURN COALESCE(result, '{}'::json);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_agent_own_at_risk_policies(p_unl_writing_number text DEFAULT NULL::text, p_gtl_writing_number text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
WHERE fs.source = 'Data Source'
    AND fs.status = 'active'
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_agent_quality_snapshot(p_unl_writing_number text DEFAULT NULL::text, p_gtl_writing_number text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
result json;
v_first_effective_date date;
v_today date := CURRENT_DATE;
BEGIN
-- Find earliest effective date for this agent
SELECT MIN(fs.policy_effective_date)
INTO v_first_effective_date
FROM form_submissions fs
WHERE fs.source = 'Data Source'
    AND (
(p_unl_writing_number IS NOT NULL AND fs.agent_number = p_unl_writing_number)
OR (p_gtl_writing_number IS NOT NULL AND fs.agent_number = p_gtl_writing_number)
)
AND fs.status != 'duplicate';

SELECT json_build_object(
'first_effective_date', v_first_effective_date,
'policies_taken', (
SELECT COUNT(*)
FROM form_submissions fs
WHERE fs.source = 'Data Source'
    AND (
(p_unl_writing_number IS NOT NULL AND fs.agent_number = p_unl_writing_number)
OR (p_gtl_writing_number IS NOT NULL AND fs.agent_number = p_gtl_writing_number)
)
AND fs.status = 'active'
AND fs.policy_effective_date >= date_trunc('month', v_today)
),
'policies_taken_ytd', (
SELECT COUNT(*)
FROM form_submissions fs
WHERE fs.source = 'Data Source'
    AND (
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
WHERE fs.source = 'Data Source'
    AND (
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
WHERE fs.source = 'Data Source'
    AND (
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
WHERE fs.source = 'Data Source'
    AND (
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
WHERE fs.source = 'Data Source'
    AND (
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
WHERE fs.source = 'Data Source'
    AND (
(p_unl_writing_number IS NOT NULL AND fs.agent_number = p_unl_writing_number)
OR (p_gtl_writing_number IS NOT NULL AND fs.agent_number = p_gtl_writing_number)
)
AND fs.status != 'duplicate'
)
)
INTO result;

RETURN COALESCE(result, '{}'::json);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_at_risk_agents_summary(p_agency text DEFAULT NULL::text, p_agencies text[] DEFAULT NULL::text[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
fs.source = 'Data Source'
    AND fs.agent_number IS NOT NULL
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_at_risk_aging_distribution(p_agency text DEFAULT NULL::text, p_agencies text[] DEFAULT NULL::text[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
WHERE fs.source = 'Data Source'
    AND fs.status = 'active'
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_at_risk_policies_for_agent(p_agent_number text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
WHERE fs.source = 'Data Source'
    AND fs.agent_number = p_agent_number
AND fs.status = 'active'
AND fs.billing_form = 'DIR'
AND fs.paid_to_date IS NOT NULL
AND fs.paid_to_date < CURRENT_DATE
) t;

RETURN COALESCE(result, '[]'::json);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.monte_carlo_daily_history_by_agency(p_agency text DEFAULT NULL::text, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
result json;
v_min_date date;
v_max_date date;
BEGIN
v_min_date := COALESCE(p_start_date, (
SELECT MIN(app_submit_date) FROM form_submissions
    WHERE source = 'Data Source'
    AND source = 'Data Source'
    AND app_submit_date IS NOT NULL
AND (p_agency IS NULL OR agency = p_agency)
));
v_max_date := COALESCE(p_end_date, CURRENT_DATE);

WITH date_range AS (
SELECT generate_series(v_min_date, v_max_date, '1 day'::interval)::date AS submit_date
),
daily_stats AS (
SELECT
app_submit_date AS submit_date,
COUNT(*) AS policy_count,
COALESCE(SUM(plan_premium), 0) AS total_premium,
COALESCE(AVG(plan_premium), 0) AS avg_premium
FROM form_submissions
    WHERE source = 'Data Source'
    AND source = 'Data Source'
    AND app_submit_date IS NOT NULL
AND (p_agency IS NULL OR agency = p_agency)
AND app_submit_date >= v_min_date
AND app_submit_date <= v_max_date
GROUP BY app_submit_date
)
SELECT json_agg(row_to_json(t) ORDER BY t.submit_date)
INTO result
FROM (
SELECT
dr.submit_date::text AS submit_date,
EXTRACT(DOW FROM dr.submit_date)::int AS day_of_week,
COALESCE(ds.policy_count, 0)::int AS policy_count,
COALESCE(ds.total_premium, 0)::float AS total_premium,
COALESCE(ds.avg_premium, 0)::float AS avg_premium
FROM date_range dr
LEFT JOIN daily_stats ds ON ds.submit_date = dr.submit_date
) t;

RETURN COALESCE(result, '[]'::json);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.monte_carlo_daily_history_by_agency(p_agency text DEFAULT NULL::text, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date, p_agencies text[] DEFAULT NULL::text[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
result json;
v_min_date date;
v_max_date date;
BEGIN
v_min_date := COALESCE(p_start_date, (
SELECT MIN(app_submit_date) FROM form_submissions
    WHERE source = 'Data Source'
    AND source = 'Data Source'
    AND app_submit_date IS NOT NULL
AND status NOT IN ('duplicate', 'superseded')
AND (
CASE
WHEN p_agencies IS NOT NULL THEN agency = ANY(p_agencies)
WHEN p_agency IS NOT NULL THEN agency = p_agency
ELSE TRUE
END
)
));
v_max_date := COALESCE(p_end_date, CURRENT_DATE);

IF v_min_date IS NULL THEN
RETURN '[]'::json;
END IF;

WITH date_range AS (
SELECT generate_series(v_min_date, v_max_date, '1 day'::interval)::date AS submit_date
),
daily_stats AS (
SELECT
app_submit_date AS submit_date,
COUNT(*) AS policy_count,
COALESCE(SUM(plan_premium), 0) AS total_premium,
COALESCE(AVG(plan_premium), 0) AS avg_premium
FROM form_submissions
    WHERE source = 'Data Source'
    AND source = 'Data Source'
    AND app_submit_date IS NOT NULL
AND app_submit_date >= v_min_date
AND app_submit_date <= v_max_date
AND status NOT IN ('duplicate', 'superseded')
AND (
CASE
WHEN p_agencies IS NOT NULL THEN agency = ANY(p_agencies)
WHEN p_agency IS NOT NULL THEN agency = p_agency
ELSE TRUE
END
)
GROUP BY app_submit_date
)
SELECT json_agg(row_to_json(t) ORDER BY t.submit_date)
INTO result
FROM (
SELECT
dr.submit_date::text AS submit_date,
EXTRACT(DOW FROM dr.submit_date)::int AS day_of_week,
COALESCE(ds.policy_count, 0)::int AS policy_count,
COALESCE(ds.total_premium, 0)::float AS total_premium,
COALESCE(ds.avg_premium, 0)::float AS avg_premium
FROM date_range dr
LEFT JOIN daily_stats ds ON ds.submit_date = dr.submit_date
) t;

RETURN COALESCE(result, '[]'::json);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.monte_carlo_daily_history_by_agency(p_agency text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
result json;
BEGIN
WITH date_range AS (
SELECT generate_series(
(SELECT MIN(app_submit_date) FROM form_submissions
    WHERE source = 'Data Source'
    AND source = 'Data Source'
    AND app_submit_date IS NOT NULL
AND (p_agency IS NULL OR agency = p_agency)),
CURRENT_DATE,
'1 day'::interval
)::date AS submit_date
),
daily_stats AS (
SELECT
app_submit_date AS submit_date,
COUNT(*) AS policy_count,
COALESCE(SUM(plan_premium), 0) AS total_premium,
COALESCE(AVG(plan_premium), 0) AS avg_premium
FROM form_submissions
    WHERE source = 'Data Source'
    AND source = 'Data Source'
    AND app_submit_date IS NOT NULL
AND (p_agency IS NULL OR agency = p_agency)
GROUP BY app_submit_date
)
SELECT json_agg(row_to_json(t) ORDER BY t.submit_date)
INTO result
FROM (
SELECT
dr.submit_date::text AS submit_date,
EXTRACT(DOW FROM dr.submit_date)::int AS day_of_week,
COALESCE(ds.policy_count, 0)::int AS policy_count,
COALESCE(ds.total_premium, 0)::float AS total_premium,
COALESCE(ds.avg_premium, 0)::float AS avg_premium
FROM date_range dr
LEFT JOIN daily_stats ds ON ds.submit_date = dr.submit_date
) t;

RETURN COALESCE(result, '[]'::json);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.monte_carlo_daily_history_by_agent(p_agent_number text, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
result json;
v_min_date date;
v_max_date date;
BEGIN
v_min_date := COALESCE(p_start_date, (
SELECT MIN(app_submit_date) FROM form_submissions
    WHERE source = 'Data Source'
    AND source = 'Data Source'
    AND app_submit_date IS NOT NULL
AND agent_number = p_agent_number
AND status NOT IN ('duplicate', 'superseded')
));
v_max_date := COALESCE(p_end_date, CURRENT_DATE);

IF v_min_date IS NULL THEN
RETURN '[]'::json;
END IF;

WITH date_range AS (
SELECT generate_series(v_min_date, v_max_date, '1 day'::interval)::date AS submit_date
),
daily_stats AS (
SELECT
app_submit_date AS submit_date,
COUNT(*) AS policy_count,
COALESCE(SUM(plan_premium), 0) AS total_premium,
COALESCE(AVG(plan_premium), 0) AS avg_premium
FROM form_submissions
    WHERE source = 'Data Source'
    AND source = 'Data Source'
    AND app_submit_date IS NOT NULL
AND agent_number = p_agent_number
AND status NOT IN ('duplicate', 'superseded')
AND app_submit_date >= v_min_date
AND app_submit_date <= v_max_date
GROUP BY app_submit_date
)
SELECT json_agg(row_to_json(t) ORDER BY t.submit_date)
INTO result
FROM (
SELECT
dr.submit_date::text AS submit_date,
EXTRACT(DOW FROM dr.submit_date)::int AS day_of_week,
COALESCE(ds.policy_count, 0)::int AS policy_count,
COALESCE(ds.total_premium, 0)::float AS total_premium,
COALESCE(ds.avg_premium, 0)::float AS avg_premium
FROM date_range dr
LEFT JOIN daily_stats ds ON ds.submit_date = dr.submit_date
) t;

RETURN COALESCE(result, '[]'::json);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.monte_carlo_meta_by_agency(p_agency text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
result json;
BEGIN
SELECT json_build_object(
'total_days', (CURRENT_DATE - MIN(app_submit_date))::int,
'selling_days', COUNT(DISTINCT app_submit_date)::int,
'earliest_date', MIN(app_submit_date)::text,
'latest_date', MAX(app_submit_date)::text
)
INTO result
FROM form_submissions
    WHERE source = 'Data Source'
    AND source = 'Data Source'
    AND app_submit_date IS NOT NULL
AND (p_agency IS NULL OR agency = p_agency);

RETURN COALESCE(result, json_build_object(
'total_days', 0,
'selling_days', 0,
'earliest_date', null,
'latest_date', null
));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.monte_carlo_meta_by_agency(p_agency text DEFAULT NULL::text, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
result json;
BEGIN
SELECT json_build_object(
'total_days', (COALESCE(p_end_date, CURRENT_DATE) - MIN(app_submit_date))::int,
'selling_days', COUNT(DISTINCT app_submit_date)::int,
'earliest_date', MIN(app_submit_date)::text,
'latest_date', MAX(app_submit_date)::text
)
INTO result
FROM form_submissions
    WHERE source = 'Data Source'
    AND source = 'Data Source'
    AND app_submit_date IS NOT NULL
AND (p_agency IS NULL OR agency = p_agency)
AND (p_start_date IS NULL OR app_submit_date >= p_start_date)
AND (p_end_date IS NULL OR app_submit_date <= p_end_date);

RETURN COALESCE(result, json_build_object(
'total_days', 0,
'selling_days', 0,
'earliest_date', null,
'latest_date', null
));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.monte_carlo_meta_by_agency(p_agency text DEFAULT NULL::text, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date, p_agencies text[] DEFAULT NULL::text[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
result json;
BEGIN
SELECT json_build_object(
'total_days', (COALESCE(p_end_date, CURRENT_DATE) - MIN(app_submit_date))::int,
'selling_days', COUNT(DISTINCT app_submit_date)::int,
'earliest_date', MIN(app_submit_date)::text,
'latest_date', MAX(app_submit_date)::text
)
INTO result
FROM form_submissions
    WHERE source = 'Data Source'
    AND source = 'Data Source'
    AND app_submit_date IS NOT NULL
AND status NOT IN ('duplicate', 'superseded')
AND (p_start_date IS NULL OR app_submit_date >= p_start_date)
AND (p_end_date IS NULL OR app_submit_date <= p_end_date)
AND (
CASE
WHEN p_agencies IS NOT NULL THEN agency = ANY(p_agencies)
WHEN p_agency IS NOT NULL THEN agency = p_agency
ELSE TRUE
END
);

RETURN COALESCE(result, json_build_object(
'total_days', 0,
'selling_days', 0,
'earliest_date', null,
'latest_date', null
));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.monte_carlo_meta_by_agent(p_agent_number text, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
result json;
BEGIN
SELECT json_build_object(
'total_days', (COALESCE(p_end_date, CURRENT_DATE) - MIN(app_submit_date))::int,
'selling_days', COUNT(DISTINCT app_submit_date)::int,
'earliest_date', MIN(app_submit_date)::text,
'latest_date', MAX(app_submit_date)::text
)
INTO result
FROM form_submissions
    WHERE source = 'Data Source'
    AND source = 'Data Source'
    AND app_submit_date IS NOT NULL
AND agent_number = p_agent_number
AND status NOT IN ('duplicate', 'superseded')
AND (p_start_date IS NULL OR app_submit_date >= p_start_date)
AND (p_end_date IS NULL OR app_submit_date <= p_end_date);

RETURN COALESCE(result, json_build_object(
'total_days', 0,
'selling_days', 0,
'earliest_date', null,
'latest_date', null
));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.monte_carlo_monthly_trend_by_agency(p_agency text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
result json;
BEGIN
SELECT json_agg(row_to_json(t) ORDER BY t.month)
INTO result
FROM (
SELECT
to_char(app_submit_date, 'YYYY-MM') AS month,
COUNT(*)::int AS policy_count,
COALESCE(SUM(plan_premium), 0)::float AS total_premium
FROM form_submissions
    WHERE source = 'Data Source'
    AND source = 'Data Source'
    AND app_submit_date IS NOT NULL
AND (p_agency IS NULL OR agency = p_agency)
GROUP BY to_char(app_submit_date, 'YYYY-MM')
) t;

RETURN COALESCE(result, '[]'::json);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.monte_carlo_monthly_trend_by_agency(p_agency text DEFAULT NULL::text, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date, p_agencies text[] DEFAULT NULL::text[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
result json;
BEGIN
SELECT json_agg(row_to_json(t) ORDER BY t.month)
INTO result
FROM (
SELECT
to_char(app_submit_date, 'YYYY-MM') AS month,
COUNT(*)::int AS policy_count,
COALESCE(SUM(plan_premium), 0)::float AS total_premium
FROM form_submissions
    WHERE source = 'Data Source'
    AND source = 'Data Source'
    AND app_submit_date IS NOT NULL
AND status NOT IN ('duplicate', 'superseded')
AND (p_start_date IS NULL OR app_submit_date >= p_start_date)
AND (p_end_date IS NULL OR app_submit_date <= p_end_date)
AND (
CASE
WHEN p_agencies IS NOT NULL THEN agency = ANY(p_agencies)
WHEN p_agency IS NOT NULL THEN agency = p_agency
ELSE TRUE
END
)
GROUP BY to_char(app_submit_date, 'YYYY-MM')
) t;

RETURN COALESCE(result, '[]'::json);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.monte_carlo_monthly_trend_by_agency(p_agency text DEFAULT NULL::text, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
result json;
BEGIN
SELECT json_agg(row_to_json(t) ORDER BY t.month)
INTO result
FROM (
SELECT
to_char(app_submit_date, 'YYYY-MM') AS month,
COUNT(*)::int AS policy_count,
COALESCE(SUM(plan_premium), 0)::float AS total_premium
FROM form_submissions
    WHERE source = 'Data Source'
    AND source = 'Data Source'
    AND app_submit_date IS NOT NULL
AND (p_agency IS NULL OR agency = p_agency)
AND (p_start_date IS NULL OR app_submit_date >= p_start_date)
AND (p_end_date IS NULL OR app_submit_date <= p_end_date)
GROUP BY to_char(app_submit_date, 'YYYY-MM')
) t;

RETURN COALESCE(result, '[]'::json);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.monte_carlo_monthly_trend_by_agent(p_agent_number text, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
result json;
BEGIN
SELECT json_agg(row_to_json(t) ORDER BY t.month)
INTO result
FROM (
SELECT
to_char(app_submit_date, 'YYYY-MM') AS month,
COUNT(*)::int AS policy_count,
COALESCE(SUM(plan_premium), 0)::float AS total_premium
FROM form_submissions
    WHERE source = 'Data Source'
    AND source = 'Data Source'
    AND app_submit_date IS NOT NULL
AND agent_number = p_agent_number
AND status NOT IN ('duplicate', 'superseded')
AND (p_start_date IS NULL OR app_submit_date >= p_start_date)
AND (p_end_date IS NULL OR app_submit_date <= p_end_date)
GROUP BY to_char(app_submit_date, 'YYYY-MM')
) t;

RETURN COALESCE(result, '[]'::json);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_agent_leaderboard_position(p_agent_id uuid, p_agency text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  result json;
  v_month_start date := date_trunc('month', CURRENT_DATE)::date;
  v_agent_agency text;
BEGIN
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
      AND fs.source = 'Data Source'
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
$function$;

CREATE OR REPLACE FUNCTION public.get_agent_production_history(p_unl_writing_number text DEFAULT NULL::text, p_gtl_writing_number text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
      AND fs.source = 'Data Source'
    GROUP BY d.day
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_at_risk_trend(p_agency text DEFAULT NULL::text, p_agencies text[] DEFAULT NULL::text[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
    WHERE fs.source = 'Data Source'
    AND (
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
$function$;

