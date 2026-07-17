# Migration Mock-Up — Max's DB → GHL Field Mapping
**Session:** 2026-07-17, starting ~1:49 PM CDT
**Participants:** Charlie, Diamond
**Purpose:** Lock the field mapping for rewriting `ghl-reconcile` (and `lifecycle-direct`) to query Max's production DB (`typed.unl_fym_policy_latest_load`) directly, replacing all `form_submissions` reads.

---

## Source Table

`typed.unl_fym_policy_latest_load` — Akamai/Postgres, `analytics` DB
Current-state snapshot, one row per active policy. Read-only via `unl_fym_policy_reader` role.

---

## Confirmed Field Map — Max's DB → GHL

### Standard Fields (every payload, regardless of LOB)

| Max's DB Column | Mapped Name | GHL Field Key | Notes |
|---|---|---|---|
| `first_name` | First Name | `contact.first_name` | Direct |
| `last_name` | Last Name | `contact.last_name` | Direct |
| `phone_nbr` | Phone | `contact.phone` | Cast `bigint` → string |
| `ga_name` | Downline Agency | `contact.ancillary_agency__sorting` | Sub-agency sorting field |
| `issue_state` | State | `contact.state` | Single line, Applicant Address Information |
| `zip` | Postal Code | `contact.postal_code` | Single line, Applicant Address Information |
| `wa` | UNL Writing Number | `contact.agent_npn` *(see NPN note below)* | `wa` = agent writing number; NPN lookup logic TBD — **HOLD** |

> **Middle Initial** and **Email** are not present in Max's DB — omit from payload.

---

### LOB Fields — HIP (Hospital Indemnity)
Prefix: `hip__`

| Max's DB Column | Mapped Name | GHL Field Key | Transform |
|---|---|---|---|
| `policy_nbr` | Policy Number | `contact.hip__policy_number` | Direct |
| `plan_code` | Plan Name | `contact.hip__plan_name` | Direct |
| `annual_premium` | Plan Premium | `contact.hip__plan_premium` | `float` → string |
| `issue_date` | Effective Date | `contact.hip__effective_date` | Date → MM/DD/YYYY |
| `app_recvd_date` | Submission Date | `contact.hip__submission_date` | Date → MM/DD/YYYY |
| `paid_to_date` | Paid To Date | `contact.hip__paid_to_date` | Date → MM/DD/YYYY |
| `term_date` | Termination Date | `contact.hip__termination_date` | Date → MM/DD/YYYY — only if terminated |
| `billing_mode` | Billing Mode | `contact.hip__billing_mode` | `int` → label (see Billing Mode table) |
| `cntrct_code` | Client Status | `contact.hip__client_status` | `A` → `Active`; anything else → `Terminated` |
| `cntrct_reason` | Terminated Reason | `contact.hip__terminated_reason` | Code → label (see Contract Reason table) |
| `at_risk_policy` | At Risk Status | `contact.hip__at_risk_status` | `bool` → `Yes` / `No` (Title Case) |
| `wa` | Agent Writing Number | `contact.hip__agent_writing_number` | Direct |
| `wa_name` | Agent Full Name | `contact.hip__agent_full_name` | Direct |
| `wa_name` | Agent First Name | `contact.hip__agent_first_name` | Split on space, take first token |
| `carrier` | Carrier Name | `contact.hip__carrier_name` | Direct |

---

### LOB Fields — HHC (Home Health Care)
Prefix: `hhc__`

Same columns and transforms as HIP above — only the GHL field key prefix changes (`hip__` → `hhc__`).

| Max's DB Column | GHL Field Key |
|---|---|
| `policy_nbr` | `contact.hhc__policy_number` |
| `plan_code` | `contact.hhc__plan_name` |
| `annual_premium` | `contact.hhc__plan_premium` |
| `issue_date` | `contact.hhc__effective_date` |
| `app_recvd_date` | `contact.hhc__submission_date` |
| `paid_to_date` | `contact.hhc__paid_to_date` |
| `term_date` | `contact.hhc__termination_date` |
| `billing_mode` | `contact.hhc__billing_mode` |
| `cntrct_code` | `contact.hhc__client_status` |
| `cntrct_reason` | `contact.hhc__terminated_reason` |
| `at_risk_policy` | `contact.hhc__at_risk_status` |
| `wa` | `contact.hhc__agent_writing_number` |
| `wa_name` | `contact.hhc__agent_full_name` |
| `wa_name` | `contact.hhc__agent_first_name` |
| `carrier` | `contact.hhc__carrier_name` |

---

### Columns: Fetch But Don't Push

| Column | Reason |
|---|---|
| `billing_form` | Internal at-risk logic only — `DIR` = direct bill (required for at-risk derivation). Fetch, don't push. |

---

### Columns: Drop Entirely

| Column | Reason |
|---|---|
| `ga` | Downline Code (writing number) — `wa` is the agent writing number; `ga` is not needed |
| `mga` | FYM Agency Code — no GHL field mapped |
| `mga_name` | Parent Agency — no GHL field mapped |
| `_dlt_id` | Pipeline internal — not pushed |
| `_dlt_load_id` | Pipeline internal — not pushed |
| `_source_file` | Pipeline internal — not pushed |
| `agent_ga_level_01` | Hierarchy Level 1 (FYM root writing number) — not the agent WN (`wa` is) |
| `agent_level_02`–`10` | Upline hierarchy chain — no GHL mapping |

---

## Transform Reference

### Billing Mode (`billing_mode` integer → string)
| DB Value | GHL Label |
|---|---|
| 1 | Monthly |
| 3 | Quarterly |
| 6 | Semi-Annual |
| 12 | Annual |

### Contract Reason (`cntrct_reason` code → label)
| Code | Label |
|---|---|
| NS | Non-Sufficient Funds |
| CA | Client Requested Cancellation |
| NR | Non-Renewal |
| DE | Deceased |
| DB | Duplicate Billing |
| DP | Duplicate Policy |
| FR | Fraud |
| IC | Invalid Coverage |
| PA | Policy Anniversary |
| RP | Replaced Policy |

### Client Status (derived from `cntrct_code`)
- `cntrct_code = 'A'` → `Active`
- Anything else → `Terminated`

### At Risk Status (derived from `at_risk_policy` boolean)
- `true` → `Yes`
- `false` → `No`

> **Note:** Current `form_submissions`-based code derives at-risk from `cntrct_code`, `billing_form`, and `paid_to_date` at push time. Max's DB pre-computes `at_risk_policy` as a boolean. Use the DB value directly — no re-derivation needed. `billing_form` is still fetched to preserve compatibility with any edge logic, but the boolean is the source of truth going forward.

---

## Open Items (as of 2026-07-17 ~2:00 PM CDT)

| # | Item | Owner | Status |
|---|---|---|---|
| 1 | **Agent NPN logic** | Charlie | **HOLD** — NPN is required for every payload. Charlie adding lookup logic. `wa` = writing number; NPN is a separate field. |
| 2 | Confirm LOB determination from `plan_code` | Diamond | `plan_code` drives `hip__` vs `hhc__` prefix. Need the plan_code → LOB mapping (UNL plan codes). Existing `form_submissions` logic uses `product_type` column which doesn't exist in Max's DB. |
| 3 | `wa_name` → agent first name split logic | Diamond | Split on first space; edge-case names (e.g. "Mary Jo Smith") need a confirmed rule. |
| 4 | Suppression tag | Diamond | All reconcile contacts keep `reconciled \| do not automate`. All lifecycle-direct contacts keep existing tag logic. |
| 5 | 264-policy prod reconcile run | Will | **Blocked — waiting on Will's go-ahead.** Spot-check (2 real policies) passed clean 2026-07-17. |

---

## Supabase SELECT for the New Query

```sql
SELECT
  first_name,
  last_name,
  phone_nbr,
  plan_code,
  annual_premium,
  issue_date,
  app_recvd_date,
  paid_to_date,
  term_date,
  billing_mode,
  billing_form,
  cntrct_code,
  cntrct_reason,
  policy_nbr,
  ga_name,
  wa,
  wa_name,
  issue_state,
  zip,
  at_risk_policy,
  carrier
FROM typed.unl_fym_policy_latest_load
WHERE policy_nbr = ANY($1::text[])
```

*(Columns dropped: `ga`, `mga`, `mga_name`, `_dlt_id`, `_dlt_load_id`, `_source_file`, `agent_ga_level_01`–`10`)*

---

---

## Trigger Logic — Confirmed 2026-07-17

All trigger queries run against `typed.unl_fym_policy_latest_load` (Max's DB, read-only).
Idempotency is enforced by the `fired_triggers` ledger in the Supabase tracker DB.
Full query SQL lives in `docs/migration-mockup/trigger-queries.sql`.
Ledger DDL lives in `docs/migration-mockup/migrations/001_fired_triggers.sql`.

### fired_triggers ledger

```sql
CREATE TABLE public.fired_triggers (
    id            BIGSERIAL PRIMARY KEY,
    policy_nbr    TEXT        NOT NULL,
    trigger_type  TEXT        NOT NULL,  -- 'approved' | 'terminated' | 'submission' | 'at_risk'
    changed_on    DATE        NOT NULL,  -- business date of the transition (see per-trigger note)
    fired_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (policy_nbr, trigger_type, changed_on),
    CHECK (trigger_type IN ('approved','terminated','submission','at_risk'))
);
```

Every trigger query gates on `NOT EXISTS (SELECT 1 FROM fired_triggers WHERE ...)` before firing.
After a successful GHL push, insert with `ON CONFLICT DO NOTHING` as a second idempotency layer.

**Why the ledger is essential:** `typed.unl_fym_policy_latest_load` is a daily snapshot that
carries ALL historical `contract_code_last_change_date` values for every policy (13,339+ rows
with old business dates confirmed in prod). Without `fired_triggers`, any date-window query
would re-fire historical events on every run regardless of window size.

### contract_code_last_change_date — confirmed BUSINESS DATE, not load date

Verified 2026-07-17 by querying the delta distribution (`changed_on - file_date`):
- `delta=0`: 187 rows — transition happened the same day as the ETL load
- `delta=-1`: confirmed rows — business event on day N appeared in day N+1 load
- `delta<0` bulk (13,339 rows): historical transitions, months/years old, re-presented every load

The 3-day window catches same-day and 1-2 day lagged events with a 1-day safety margin.

### app_recvd_date — confirmed 100% populated on all P rows

`contract_code_last_change_date` is NULL on 4,154 of 4,162 P rows — not usable as a submission
anchor. `app_recvd_date` is 100% populated on all P rows and is the correct anchor for
submission triggers.

---

### Trigger A — P→A (Approved)

| Field | Value |
|---|---|
| **Condition** | `previous_contract_code = 'P' AND cntrct_code = 'A'` |
| **Window anchor** | `contract_code_last_change_date >= CURRENT_DATE - INTERVAL '3 days'` |
| **trigger_type** | `'approved'` |
| **fired_triggers.changed_on** | `contract_code_last_change_date` |
| **Volume (current snapshot)** | 67–112 per business date in the 3-day window |

### Trigger B — A→T (Terminated)

| Field | Value |
|---|---|
| **Condition** | `previous_contract_code = 'A' AND cntrct_code = 'T'` |
| **Window anchor** | `contract_code_last_change_date >= CURRENT_DATE - INTERVAL '3 days'` |
| **trigger_type** | `'terminated'` |
| **fired_triggers.changed_on** | `contract_code_last_change_date` |
| **Volume (current snapshot)** | 58–133 per business date in the 3-day window |

### Trigger D — At-Risk Flag Newly Set

| Field | Value |
|---|---|
| **Condition** | `at_risk_policy = true AND (previous_at_risk_status = false OR IS NULL)` |
| **Window anchor** | `at_risk_status_last_change_date >= CURRENT_DATE - INTERVAL '3 days'` |
| **trigger_type** | `'at_risk'` (underscore — matches CHECK constraint in fired_triggers) |
| **fired_triggers.changed_on** | `at_risk_status_last_change_date` |
| **Volume (current snapshot)** | 908 policies in 3-day window (266 on 7/17, 181 on 7/16, 288 on 7/15, 173 on 7/14) |

**Schema verified 2026-07-17 — all three columns confirmed present:**
- `at_risk_policy` — boolean ✅
- `previous_at_risk_status` — boolean ✅
- `at_risk_status_last_change_date` — date ✅

**`at_risk_status_last_change_date` = BUSINESS DATE (confirmed):**
Delta distribution vs `file_date` shows lag runs deeper than contract code dates:
- `delta=0`: 289 rows (same-day)
- `delta=-1`: 233 rows
- `delta=-2`: 367 rows
- `delta=-3`: 284 rows

3-day window covers the observed lag range. `fired_triggers NOT EXISTS` remains the
essential idempotency gate — same reason as Triggers A/B.

NULL rate: 4 of 4,506 trigger candidates have `NULL at_risk_status_last_change_date` —
negligible; those rows are excluded by the `>=` window filter.

---

### Trigger C — Submission (New P or Business Rewrite)

Two cases unified into one trigger type (`'submission'`), using different date anchors:

#### Case 1 — New submission (`previous_contract_code IS NULL`)

| Field | Value |
|---|---|
| **Condition** | `cntrct_code = 'P' AND previous_contract_code IS NULL` |
| **Window anchor** | `app_recvd_date >= CURRENT_DATE - INTERVAL '3 days'` |
| **Why app_recvd_date** | `contract_code_last_change_date` is NULL on 99.8% of first-time P rows |
| **fired_triggers.changed_on** | `app_recvd_date` |
| **Volume (current snapshot)** | 106 policies with `app_recvd_date >= 2026-07-15` (all `prev IS NULL`) |

> **Key finding (2026-07-17):** Of 581 policies with `app_recvd_date` Jul 15–17, 469 have
> already moved to `cntrct_code = 'A'` by the time the daily snapshot lands. A query
> filtered to `cntrct_code = 'P'` only sees the 106 still pending. The 469 that moved
> to A will be captured by Trigger A (P→A approved) — not by the submission trigger.
> This is correct: submission fires for clients still in pending; approval fires when the
> carrier approves. GHL workflows should be designed around both triggers firing in sequence.

#### Case 2 — Business rewrite (`previous_contract_code IN ('T', 'A')`)

| Field | Value |
|---|---|
| **Condition** | `cntrct_code = 'P' AND previous_contract_code IN ('T', 'A')` |
| **Window anchor** | `contract_code_last_change_date >= CURRENT_DATE - INTERVAL '3 days'` |
| **Why contract_code_last_change_date** | This IS populated for rewrites (actual transition date) |
| **fired_triggers.changed_on** | `contract_code_last_change_date` |
| **Volume (current snapshot)** | 0 in current window (query correct when they appear) |

---

## Key Clarifications Established This Session

- **`wa`** = UNL writing number (the agent). NOT `agent_ga_level_01` (that's the FYM hierarchy root).
- **`ga_name`** = Downline Agency = the sub-agency sorting value for `contact.ancillary_agency__sorting`.
- **`at_risk_policy`** is a pre-computed boolean in Max's DB — use directly, no re-derivation.
- **`billing_mode`** is an integer (1/3/6/12), not a string — must be mapped to a label before pushing to GHL.
- **`phone_nbr`** is a `bigint` — must be cast to string before GHL push.
- **`issue_state`** → `contact.state` (Single line, Applicant Address Information group).
- **`zip`** → `contact.postal_code` (Single line, Applicant Address Information group).
- Agent NPN is required but `wa` is writing number only — NPN logic coming from Charlie.
