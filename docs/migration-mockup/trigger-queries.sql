-- trigger-queries.sql — Lifecycle trigger queries against Max's DB
-- Part of the Max DB → GHL migration mockup.
-- NOT executed against prod — mockup spec only.
--
-- SCHEMA VERIFICATION (2026-07-17, read-only query against prod):
--   All referenced columns confirmed present with exact names:
--     policy_nbr, cntrct_code, previous_contract_code,
--     contract_code_last_change_date, previous_at_risk_status,
--     at_risk_status_last_change_date, at_risk_policy, app_recvd_date
--   Table: typed.unl_fym_policy_latest_load ✅
--
-- app_recvd_date — submission date anchor (confirmed 2026-07-17):
--   100% populated on all 4,162 P rows (zero NULLs).
--   contract_code_last_change_date is NULL on 4,154/4,162 P rows — NOT
--   a reliable anchor for submission triggers. app_recvd_date is correct.
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
-- Transition volume (counts from today's single daily snapshot, 2026-07-17):
--   All rows live in one file_date; these are per-business-date counts
--   within the snapshot, not per-day arrival rates.
--   approved (P→A):   67–112 per changed_on date in last 3 days
--   terminated (A→T): 58–133 per changed_on date in last 3 days
--   submission (new P): 22–90 per app_recvd_date in last 3 days (196 total)
--   business rewrite (T/A→P): 0 in current 3-day window
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
-- QUERY C: Submissions and business rewrites into P
-- ---------------------------------------------------------------------------
--
-- Two cases, unified into one query via CASE:
--
-- Case 1 — New submission (prev IS NULL):
--   Policy is brand-new, no prior contract code. Anchor: app_recvd_date.
--   WHY app_recvd_date: contract_code_last_change_date is NULL on 4,154 of
--   4,162 P rows (confirmed 2026-07-17). app_recvd_date is 100% populated
--   on all P rows and is the correct submission date anchor.
--   fired_triggers.changed_on = app_recvd_date for this case.
--
-- Case 2 — Business rewrite (prev = 'T' or prev = 'A'):
--   Policy previously terminated or active, now re-entered pending.
--   This is a rewrite/reinstatement — a distinct business event.
--   Anchor: contract_code_last_change_date (the actual transition date).
--   fired_triggers.changed_on = contract_code_last_change_date for this case.
--
-- trigger_type = 'submission' for both cases in fired_triggers.
-- The two cases use different date anchors — the CASE in NOT EXISTS must
-- match accordingly.
--
-- Volume (from today's snapshot, 2026-07-17):
--   New submissions (prev IS NULL, app_recvd >= today-3): 196 policies
--   Business rewrites (T/A→P, changed_on >= today-3):      0 (none currently)

SELECT
    t.policy_nbr,
    t.cntrct_code                                              AS current_code,
    t.previous_contract_code                                   AS prev_code,
    CASE
        WHEN t.previous_contract_code IS NULL THEN t.app_recvd_date
        ELSE t.contract_code_last_change_date
    END                                                        AS changed_on,
    'submission'                                               AS trigger_type
FROM typed.unl_fym_policy_latest_load t
WHERE
    t.cntrct_code = 'P'
    AND (
        -- Case 1: brand-new submission — no prior code, app received in last 3 days
        (
            t.previous_contract_code IS NULL
            AND t.app_recvd_date >= CURRENT_DATE - INTERVAL '3 days'
        )
        OR
        -- Case 2: business rewrite — was T or A, now back to P, transition in last 3 days
        (
            t.previous_contract_code IN ('T', 'A')
            AND t.contract_code_last_change_date >= CURRENT_DATE - INTERVAL '3 days'
        )
    )
    -- Idempotency gate: date anchor matches the case used above
    AND NOT EXISTS (
        SELECT 1
        FROM fired_triggers f
        WHERE f.policy_nbr   = t.policy_nbr
          AND f.trigger_type = 'submission'
          AND f.changed_on   = CASE
                                   WHEN t.previous_contract_code IS NULL
                                       THEN t.app_recvd_date
                                   ELSE t.contract_code_last_change_date
                               END
    )
ORDER BY changed_on DESC;

-- After successful GHL push, insert using the same date anchor:
--
-- INSERT INTO public.fired_triggers (policy_nbr, trigger_type, changed_on)
-- VALUES (
--     $policy_nbr,
--     'submission',
--     CASE WHEN prev IS NULL THEN app_recvd_date ELSE contract_code_last_change_date END
-- )
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

-- Case 1: new submissions
SELECT
    t.policy_nbr,
    t.cntrct_code,
    t.previous_contract_code,
    t.app_recvd_date                 AS changed_on,
    'submission'                     AS trigger_type
FROM typed.unl_fym_policy_latest_load t
WHERE
    t.cntrct_code = 'P'
    AND t.previous_contract_code IS NULL
    AND t.app_recvd_date >= CURRENT_DATE - INTERVAL '3 days'
    AND NOT EXISTS (
        SELECT 1 FROM fired_triggers f
        WHERE f.policy_nbr   = t.policy_nbr
          AND f.trigger_type = 'submission'
          AND f.changed_on   = t.app_recvd_date
    )

UNION ALL

-- Case 2: business rewrites (T→P or A→P)
SELECT
    t.policy_nbr,
    t.cntrct_code,
    t.previous_contract_code,
    t.contract_code_last_change_date AS changed_on,
    'submission'                     AS trigger_type
FROM typed.unl_fym_policy_latest_load t
WHERE
    t.cntrct_code = 'P'
    AND t.previous_contract_code IN ('T', 'A')
    AND t.contract_code_last_change_date >= CURRENT_DATE - INTERVAL '3 days'
    AND NOT EXISTS (
        SELECT 1 FROM fired_triggers f
        WHERE f.policy_nbr   = t.policy_nbr
          AND f.trigger_type = 'submission'
          AND f.changed_on   = t.contract_code_last_change_date
    )

ORDER BY changed_on DESC, trigger_type;
