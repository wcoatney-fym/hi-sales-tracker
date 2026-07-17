-- trigger-queries.sql — Lifecycle trigger queries against Max's DB
-- Part of the Max DB → GHL migration mockup.
-- NOT executed against prod — mockup spec only.
--
-- SCHEMA VERIFICATION (2026-07-17, read-only query against prod):
--   All referenced columns confirmed present with exact names:
--     policy_nbr, cntrct_code, previous_contract_code,
--     contract_code_last_change_date, previous_at_risk_status,
--     at_risk_status_last_change_date, at_risk_policy
--   Table: typed.unl_fym_policy_latest_load ✅
--
-- contract_code_last_change_date — BUSINESS DATE (not load date):
--   Confirmed by querying delta distribution (changed_on - file_date):
--     delta=0:  187 rows — transition happened on the same day as the load
--     delta=-1: confirmed rows — business event on day N, appeared in day N+1 load
--     delta<0 (bulk, 13,339 rows): historical transitions, old records re-loaded
--       with their original business-date preserved (NOT a lag signal — these are
--       months/years old and would re-fire without the fired_triggers gate)
--   Conclusion: 3-day window on contract_code_last_change_date is correct.
--   The window catches same-day and 1-2 day lagged events.
--   fired_triggers NOT EXISTS is ESSENTIAL — without it the 13K historical
--   rows would re-fire on every daily run regardless of window size.
--
-- Daily transition volume (last 7 days, for sizing):
--   approved:   67–112 / day
--   terminated: 58–219 / day
--   submission: rare (1 in last 7 days — mostly handled upstream)
--
-- All queries are read-only against Max's DB (typed schema).
-- fired_triggers writes happen in the Supabase tracker DB after GHL push.
-- The NOT EXISTS subquery references fired_triggers as if it were a
-- foreign table or available in the same query context (edge function
-- fetches both and performs the exclusion in application code, OR
-- fired_triggers is mirrored via FDW — TBD at implementation time).

-- ---------------------------------------------------------------------------
-- QUERY B: P→A (approved) and A→T (terminated) transitions
-- ---------------------------------------------------------------------------
--
-- Fires when:
--   P→A: policy was pending, is now active (approved by carrier)
--   A→T: policy was active, is now terminated
--
-- Window: contract_code_last_change_date within last 3 days
--   Covers same-day transitions (delta=0) and 1-2 day lag (delta=-1/-2).
--   3 days provides a 1-day safety margin beyond the observed max lag.
--
-- Idempotency: NOT EXISTS against fired_triggers on
--   (policy_nbr, trigger_type, changed_on)
--   A P→A transition on 2026-07-15 fires once. If the same policy is
--   re-presented in the 2026-07-16 and 2026-07-17 loads (as historical
--   data), the fired_triggers row blocks it from re-firing.
--
-- Note on other contract codes:
--   S (suspended), T→S, P→T, etc. are NOT included — only the two
--   transitions with defined GHL automation paths (approved, terminated).

SELECT
    t.policy_nbr,
    t.cntrct_code                    AS current_code,
    t.previous_contract_code         AS prev_code,
    t.contract_code_last_change_date AS changed_on,
    CASE
        WHEN t.previous_contract_code = 'P' AND t.cntrct_code = 'A' THEN 'approved'
        WHEN t.previous_contract_code = 'A' AND t.cntrct_code = 'T' THEN 'terminated'
    END AS trigger_type
FROM typed.unl_fym_policy_latest_load t
WHERE
    -- Only the two supported transitions
    (
        (t.previous_contract_code = 'P' AND t.cntrct_code = 'A')
        OR
        (t.previous_contract_code = 'A' AND t.cntrct_code = 'T')
    )
    -- 3-day window on the BUSINESS DATE of the transition
    AND t.contract_code_last_change_date >= CURRENT_DATE - INTERVAL '3 days'
    -- Idempotency gate: only fire if this (policy, trigger, date) hasn't fired yet
    AND NOT EXISTS (
        SELECT 1
        FROM fired_triggers f
        WHERE f.policy_nbr    = t.policy_nbr
          AND f.trigger_type  = CASE
                                    WHEN t.previous_contract_code = 'P' THEN 'approved'
                                    ELSE 'terminated'
                                END
          AND f.changed_on    = t.contract_code_last_change_date
    )
ORDER BY t.contract_code_last_change_date DESC, trigger_type;

-- After a successful GHL push for each row, insert into fired_triggers:
--
-- INSERT INTO public.fired_triggers (policy_nbr, trigger_type, changed_on)
-- VALUES ($1, $2, $3)
-- ON CONFLICT (policy_nbr, trigger_type, changed_on) DO NOTHING;
--
-- ON CONFLICT DO NOTHING is the second idempotency layer — handles
-- concurrent runs or retries without erroring.


-- ---------------------------------------------------------------------------
-- QUERY C: New submission (cntrct_code = 'P', first appearance)
-- ---------------------------------------------------------------------------
--
-- Fires when:
--   cntrct_code = 'P' AND (previous_contract_code IS NULL OR != 'P')
--   i.e. policy is now pending and was NOT pending before — first submission.
--
-- previous_contract_code IS NULL catches brand-new policies with no prior state.
-- previous_contract_code != 'P' catches a policy that previously had a
--   different code and has re-entered pending (e.g. reinstated to pending).
--
-- Same 3-day window + NOT EXISTS pattern as Query B.
-- trigger_type = 'submission' in fired_triggers.
--
-- Volume note: submission is rare in the data (1 event in last 7 days).
-- This is expected — UNL submissions are largely handled upstream by the
-- intake form. This query catches anything that slips through or arrives
-- via a different path.

SELECT
    t.policy_nbr,
    t.cntrct_code                    AS current_code,
    t.previous_contract_code         AS prev_code,
    t.contract_code_last_change_date AS changed_on,
    'submission'                     AS trigger_type
FROM typed.unl_fym_policy_latest_load t
WHERE
    -- Policy is now pending
    t.cntrct_code = 'P'
    -- And was not already pending (new transition into P)
    AND (t.previous_contract_code IS NULL OR t.previous_contract_code != 'P')
    -- 3-day window on business date
    AND t.contract_code_last_change_date >= CURRENT_DATE - INTERVAL '3 days'
    -- Idempotency gate
    AND NOT EXISTS (
        SELECT 1
        FROM fired_triggers f
        WHERE f.policy_nbr   = t.policy_nbr
          AND f.trigger_type = 'submission'
          AND f.changed_on   = t.contract_code_last_change_date
    )
ORDER BY t.contract_code_last_change_date DESC;

-- After successful GHL push:
--
-- INSERT INTO public.fired_triggers (policy_nbr, trigger_type, changed_on)
-- VALUES ($1, 'submission', $3)
-- ON CONFLICT (policy_nbr, trigger_type, changed_on) DO NOTHING;


-- ---------------------------------------------------------------------------
-- COMBINED VIEW (optional convenience — all pending triggers in one pass)
-- ---------------------------------------------------------------------------
-- If the edge function prefers a single query rather than three separate ones,
-- use UNION ALL. Each row carries its trigger_type for routing.

SELECT
    t.policy_nbr,
    t.cntrct_code                    AS current_code,
    t.previous_contract_code         AS prev_code,
    t.contract_code_last_change_date AS changed_on,
    CASE
        WHEN t.previous_contract_code = 'P' AND t.cntrct_code = 'A' THEN 'approved'
        WHEN t.previous_contract_code = 'A' AND t.cntrct_code = 'T' THEN 'terminated'
    END AS trigger_type
FROM typed.unl_fym_policy_latest_load t
WHERE
    ((t.previous_contract_code = 'P' AND t.cntrct_code = 'A')
     OR (t.previous_contract_code = 'A' AND t.cntrct_code = 'T'))
    AND t.contract_code_last_change_date >= CURRENT_DATE - INTERVAL '3 days'
    AND NOT EXISTS (
        SELECT 1 FROM fired_triggers f
        WHERE f.policy_nbr   = t.policy_nbr
          AND f.trigger_type = CASE
                                   WHEN t.previous_contract_code = 'P' THEN 'approved'
                                   ELSE 'terminated'
                               END
          AND f.changed_on   = t.contract_code_last_change_date
    )

UNION ALL

SELECT
    t.policy_nbr,
    t.cntrct_code,
    t.previous_contract_code,
    t.contract_code_last_change_date,
    'submission' AS trigger_type
FROM typed.unl_fym_policy_latest_load t
WHERE
    t.cntrct_code = 'P'
    AND (t.previous_contract_code IS NULL OR t.previous_contract_code != 'P')
    AND t.contract_code_last_change_date >= CURRENT_DATE - INTERVAL '3 days'
    AND NOT EXISTS (
        SELECT 1 FROM fired_triggers f
        WHERE f.policy_nbr   = t.policy_nbr
          AND f.trigger_type = 'submission'
          AND f.changed_on   = t.contract_code_last_change_date
    )

ORDER BY changed_on DESC, trigger_type;
