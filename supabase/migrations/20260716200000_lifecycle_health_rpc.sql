-- lifecycle_push_health_yesterday()
--
-- SECURITY DEFINER RPC exposing yesterday's lifecycle push summary to the
-- anon/publishable role. The underlying lifecycle_event_log table has no anon
-- SELECT policy (service-role only by design); this function runs as the
-- definer, aggregates, and returns only counts + flags — no raw audit rows.
--
-- Called by the daily quality read cron (publishable key). Returns one row per
-- trigger type seen yesterday, plus rolled-up ok/fail totals.
--
-- Caller contract: if ANY row has ok_count = 0 AND fail_count > 0 (all-fail),
-- or if total_events = 0 (nothing fired), treat as a spike worth flagging.

CREATE OR REPLACE FUNCTION public.lifecycle_push_health_yesterday()
RETURNS TABLE (
  run_date        date,
  trigger_type    text,
  total_events    bigint,
  ok_count        bigint,
  fail_count      bigint,
  dry_run_count   bigint,
  top_error       text   -- most common non-null error string, or null
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    (el.fired_at AT TIME ZONE 'America/Chicago')::date              AS run_date,
    el.trigger                                                        AS trigger_type,
    COUNT(*)                                                          AS total_events,
    COUNT(*) FILTER (WHERE el.ok = true)                             AS ok_count,
    COUNT(*) FILTER (WHERE el.ok = false AND el.dry_run = false)     AS fail_count,
    COUNT(*) FILTER (WHERE el.dry_run = true)                        AS dry_run_count,
    -- top error string (excluding null and 'no GHL config' which is expected
    -- pre-go-live; post-go-live it is a misconfiguration signal)
    (
      SELECT e2.error
      FROM lifecycle_event_log e2
      WHERE (e2.fired_at AT TIME ZONE 'America/Chicago')::date
              = (el.fired_at AT TIME ZONE 'America/Chicago')::date
        AND e2.trigger = el.trigger
        AND e2.ok = false
        AND e2.dry_run = false
        AND e2.error IS NOT NULL
      GROUP BY e2.error
      ORDER BY COUNT(*) DESC
      LIMIT 1
    ) AS top_error
  FROM lifecycle_event_log el
  WHERE (el.fired_at AT TIME ZONE 'America/Chicago')::date
          = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago')::date - 1
  GROUP BY
    (el.fired_at AT TIME ZONE 'America/Chicago')::date,
    el.trigger
  ORDER BY total_events DESC;
END;
$$;

-- Grant execute to anon (publishable key role) and authenticated.
-- The function body's SECURITY DEFINER elevates to owner for the actual query.
GRANT EXECUTE ON FUNCTION public.lifecycle_push_health_yesterday() TO anon;
GRANT EXECUTE ON FUNCTION public.lifecycle_push_health_yesterday() TO authenticated;

COMMENT ON FUNCTION public.lifecycle_push_health_yesterday() IS
  'Returns yesterday lifecycle push summary (per trigger: total/ok/fail/dry counts + '
  'top error). SECURITY DEFINER — anon gets aggregates only, not raw audit rows. '
  'Used by the daily quality read cron.';
