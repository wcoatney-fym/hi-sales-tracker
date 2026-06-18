/*
  # Book Quality: support multi-agency scope (e.g. "All Internal" = FYM + Wisechoice)

  Extends get_quality_metrics with an optional p_agency_ids uuid[] param.
  - p_agency_ids provided  -> scope to agency_id = ANY(p_agency_ids)
  - else p_agency_id        -> single-agency (back-compat)
  - else                    -> whole book

  Rates are computed by summing numerators/denominators across the scoped
  agencies, NOT by averaging per-agency percentages (which would be wrong).
  Placement keeps the effective-date-reached denominator.
*/

CREATE OR REPLACE FUNCTION get_quality_metrics(
  p_agency_id uuid DEFAULT NULL,
  p_agency_ids uuid[] DEFAULT NULL
)
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
             count(*) FILTER (WHERE policy_effective_date IS NOT NULL AND policy_effective_date <= CURRENT_DATE) AS eligible,
             count(*) FILTER (WHERE policy_effective_date IS NOT NULL AND policy_effective_date <= CURRENT_DATE
                                AND paid_to_date IS NOT NULL AND paid_to_date > policy_effective_date) AS placed,
             round(100.0 * count(*) FILTER (WHERE policy_effective_date IS NOT NULL AND policy_effective_date <= CURRENT_DATE
                                              AND paid_to_date IS NOT NULL AND paid_to_date > policy_effective_date)
               / nullif(count(*) FILTER (WHERE policy_effective_date IS NOT NULL AND policy_effective_date <= CURRENT_DATE), 0), 1) AS placement_pct
      FROM form_submissions
      WHERE source = 'Data Source'
        AND app_submit_date >= date_trunc('month', CURRENT_DATE) - interval '3 months'
        AND app_submit_date < date_trunc('month', CURRENT_DATE)
        AND (
          CASE
            WHEN p_agency_ids IS NOT NULL THEN agency_id = ANY(p_agency_ids)
            WHEN p_agency_id IS NOT NULL THEN agency_id = p_agency_id
            ELSE TRUE
          END
        )
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
        AND (
          CASE
            WHEN p_agency_ids IS NOT NULL THEN fs.agency_id = ANY(p_agency_ids)
            WHEN p_agency_id IS NOT NULL THEN fs.agency_id = p_agency_id
            ELSE TRUE
          END
        )
        AND fs.policy_effective_date >= date_trunc('month', CURRENT_DATE) - make_interval(months => m.months_ago)
        AND fs.policy_effective_date < date_trunc('month', CURRENT_DATE) - make_interval(months => m.months_ago - 1)
      GROUP BY m.months_ago
    ) q
  )
) INTO result;
RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_quality_metrics(uuid, uuid[]) FROM anon, authenticated;
