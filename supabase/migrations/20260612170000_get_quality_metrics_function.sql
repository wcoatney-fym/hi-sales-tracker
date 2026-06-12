-- Placement & persistency for the imported book, optionally scoped to one agency.
-- Placement: of apps submitted in a month, the share whose paid-to date moved past
-- the effective date (first premium drafted). Last 3 complete months.
-- Persistency: of policies that went active (paid_to > effective) in the cohort
-- month, the share still active today. Cohorts at 3/6/9/13 months back.
CREATE OR REPLACE FUNCTION get_quality_metrics(p_agency_id uuid DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE result json;
BEGIN
SELECT json_build_object(
  'placement', (
    SELECT COALESCE(json_agg(row_to_json(p) ORDER BY p.month), '[]'::json)
    FROM (
      SELECT to_char(date_trunc('month', app_submit_date), 'YYYY-MM') AS month,
             count(*) AS submitted,
             count(*) FILTER (WHERE paid_to_date IS NOT NULL AND policy_effective_date IS NOT NULL AND paid_to_date > policy_effective_date) AS placed,
             round(100.0 * count(*) FILTER (WHERE paid_to_date IS NOT NULL AND policy_effective_date IS NOT NULL AND paid_to_date > policy_effective_date)
               / nullif(count(*), 0), 1) AS placement_pct
      FROM form_submissions
      WHERE source = 'Data Source'
        AND app_submit_date >= date_trunc('month', CURRENT_DATE) - interval '3 months'
        AND app_submit_date < date_trunc('month', CURRENT_DATE)
        AND (p_agency_id IS NULL OR agency_id = p_agency_id)
      GROUP BY 1
    ) p
  ),
  'persistency', (
    SELECT COALESCE(json_agg(row_to_json(q) ORDER BY q.months_ago), '[]'::json)
    FROM (
      SELECT m.months_ago,
             to_char(date_trunc('month', CURRENT_DATE) - make_interval(months => m.months_ago), 'YYYY-MM') AS cohort_month,
             count(fs.id) FILTER (WHERE fs.paid_to_date > fs.policy_effective_date) AS went_active,
             count(fs.id) FILTER (WHERE fs.paid_to_date > fs.policy_effective_date AND fs.status = 'active') AS still_active,
             round(100.0 * count(fs.id) FILTER (WHERE fs.paid_to_date > fs.policy_effective_date AND fs.status = 'active')
               / nullif(count(fs.id) FILTER (WHERE fs.paid_to_date > fs.policy_effective_date), 0), 1) AS persistency_pct
      FROM (VALUES (3),(6),(9),(13)) AS m(months_ago)
      LEFT JOIN form_submissions fs
        ON fs.source = 'Data Source'
        AND (p_agency_id IS NULL OR fs.agency_id = p_agency_id)
        AND fs.policy_effective_date >= date_trunc('month', CURRENT_DATE) - make_interval(months => m.months_ago)
        AND fs.policy_effective_date < date_trunc('month', CURRENT_DATE) - make_interval(months => m.months_ago - 1)
      GROUP BY m.months_ago
    ) q
  )
) INTO result;
RETURN result;
END;
$$;

-- Edge functions call this with the service role; no anonymous execution.
REVOKE EXECUTE ON FUNCTION get_quality_metrics(uuid) FROM anon, authenticated;
