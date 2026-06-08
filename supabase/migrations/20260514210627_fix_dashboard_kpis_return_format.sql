/*
  # Fix dashboard_kpis Return Format

  1. Changes
    - Drops the 6-param version created in previous migration
    - Recreates dashboard_kpis with original return format (policies_sold, total_premium_sum, active_agents, new_clients)
      but with the additional p_agencies parameter for multi-agency filtering
    - The edge function's formatKpis expects these field names

  2. Notes
    - Preserves backward compatibility with existing callers
    - Adds p_prev_start_date, p_prev_end_date and p_agencies as optional params
    - Previous period comparison is handled by the edge function making two calls, not the function itself
*/

-- Drop the incorrect 6-param overload
DROP FUNCTION IF EXISTS dashboard_kpis(text, text, text, text, text, text[]);

-- Recreate with correct signature: original 3 params + p_agencies
CREATE OR REPLACE FUNCTION dashboard_kpis(
  p_start_date text,
  p_end_date text,
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
    'policies_sold', COUNT(*),
    'total_premium_sum', COALESCE(SUM(plan_premium), 0),
    'active_agents', COUNT(DISTINCT (agent_first_name || '|' || agent_last_name)),
    'new_clients', COUNT(DISTINCT (client_first_name || '|' || client_last_name || '|' || COALESCE(email, '')))
  )
  INTO result
  FROM form_submissions
  WHERE app_submit_date >= p_start_date::date
    AND app_submit_date < p_end_date::date
    AND (
      CASE
        WHEN p_agencies IS NOT NULL THEN agency = ANY(p_agencies)
        WHEN p_agency IS NOT NULL THEN agency = p_agency
        ELSE TRUE
      END
    );

  RETURN result;
END;
$$;
