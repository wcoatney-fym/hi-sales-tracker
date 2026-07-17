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

## Key Clarifications Established This Session

- **`wa`** = UNL writing number (the agent). NOT `agent_ga_level_01` (that's the FYM hierarchy root).
- **`ga_name`** = Downline Agency = the sub-agency sorting value for `contact.ancillary_agency__sorting`.
- **`at_risk_policy`** is a pre-computed boolean in Max's DB — use directly, no re-derivation.
- **`billing_mode`** is an integer (1/3/6/12), not a string — must be mapped to a label before pushing to GHL.
- **`phone_nbr`** is a `bigint` — must be cast to string before GHL push.
- **`issue_state`** → `contact.state` (Single line, Applicant Address Information group).
- **`zip`** → `contact.postal_code` (Single line, Applicant Address Information group).
- Agent NPN is required but `wa` is writing number only — NPN logic coming from Charlie.
