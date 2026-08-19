/*
  Add RPC function to detect agents who wrote policies in a given import
  but aren't in any roster for that carrier. Used by sql-import-cron to
  flag unmatched agents for roster update requests.

  Returns: agent_number, agent_name, policy_count
  Only returns agents not found in agency_rosters for the given carrier
  with match_status = 'confirmed' and status = 'active'.
*/

CREATE OR REPLACE FUNCTION public.get_unmatched_roster_agents(
  p_upload_id uuid,
  p_carrier text
)
RETURNS TABLE (
  agent_number text,
  agent_name text,
  policy_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    fs.agent_number,
    (fs.agent_first_name || ' ' || fs.agent_last_name) AS agent_name,
    COUNT(*)::bigint AS policy_count
  FROM form_submissions fs
  WHERE fs.source_upload_id = p_upload_id
    AND fs.source = 'Data Source'
    AND fs.agent_number IS NOT NULL
    AND fs.agent_number != ''
    AND NOT EXISTS (
      SELECT 1
      FROM agency_rosters ar
      WHERE ar.writing_number = fs.agent_number
        AND ar.carrier = p_carrier
        AND ar.match_status = 'confirmed'
        AND ar.status = 'active'
    )
  GROUP BY fs.agent_number, fs.agent_first_name, fs.agent_last_name
  ORDER BY COUNT(*) DESC;
END;
$function$;
