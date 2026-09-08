# Sales Tracker → FYM App Migration Plan

**Author:** Diamond
**Created:** 2026-09-08
**Last Updated:** 2026-09-08
**Status:** Planning — not yet started

> This document is the canonical reference for decommissioning the FYM Sales Tracker (`hi-sales-tracker`, Supabase `lryxxnpafaxjgehqirdp`) by migrating all active infrastructure into the FYM App (`FYM-App`, Supabase `rcbzagjyhyrkuwvlrlnf`). Nothing gets sunset until the FYM App can do the same job perfectly.

---

## Context

The Sales Tracker was FYM's first internal tool — built by Charlie, it tracks sub-agency production, quality of business, and powers the GHL lifecycle trigger pipeline. The FYM App is replacing it as the single platform for the full agent lifecycle. The front-end UI is already at near-parity (production, retention, leaderboard, book of business views all live in the FYM App). What remains is the **backend infrastructure** — edge functions, tables, cron jobs, and secrets that power the GHL trigger pipeline, data import, and admin operations.

### Source DBs
| Project | Supabase Ref | Role |
|---|---|---|
| Sales Tracker (decommissioning) | `lryxxnpafaxjgehqirdp` | Current home of lifecycle pipeline |
| FYM App (target) | `rcbzagjyhyrkuwvlrlnf` | Migration destination |
| Portal (shared) | `akhojhncsswyzcnicedt` | CRM Command tasks (`cc_tasks`) |
| Max's Prod DB | Akamai/Postgres | Source of truth — read-only, no migration |

---

## Tier 1 — Lifecycle Pipeline (Core GHL Trigger Engine)

**Priority:** HIGHEST — move first
**Estimated effort:** 2–3 focused build sessions
**Dependencies:** None (self-contained)

### Edge Functions (4)

| Function | Lines | Description |
|---|---|---|
| `lifecycle-direct` | 1,398 | The trigger engine. Queries Max's DB for policy state changes (approved, direct-approved, terminated, submission, at-risk), pushes to GHL, writes `fired_triggers`. Includes Trigger E (direct approval for policies skipping Pending) and fire rate monitor (95% threshold → `cc_tasks`). |
| `proposed-fires-push` | 435 | Pushes NPN-held fires once NPN is resolved. Reads `proposed_fires` + `fired_triggers`. |
| `npn-resolution` | 161 | Daily NPN lookup for held policies. Resolves `npn_holds` entries against `agency_rosters` and `agents`. |
| `ghl-canary` | 505 | Daily health check on GHL push path. Sends a test payload and logs result to `lifecycle_canary_runs`. |

### Shared Modules (4 files)

| Module | Lines | Used By |
|---|---|---|
| `_shared/agency-map.ts` | 173 | lifecycle-direct, ghl-reconcile, proposed-fires-push |
| `_shared/rate-limiter.ts` | 85 | lifecycle-direct |
| `sql-import-cron/ghl-client.ts` | (part of sql-import-cron) | lifecycle-direct, proposed-fires-push |
| `sql-import-cron/lifecycle-evaluator.ts` | (part of sql-import-cron) | lifecycle-direct, proposed-fires-push |

**Note:** `ghl-client.ts` and `lifecycle-evaluator.ts` currently live inside `sql-import-cron/`. During migration, extract them into `_shared/` in the FYM App repo to break the dependency on the import pipeline.

### Tables (7)

| Table | Rows (approx) | Migrate Data? | Notes |
|---|---|---|---|
| `fired_triggers` | ~1,000+ | **YES — full history** | Idempotency ledger. Without this data, every historical policy would re-fire on first cron tick. Critical. |
| `lifecycle_event_log` | ~10,000+ | **YES — full history** | Audit trail of every GHL push. Needed for fire rate monitor lookback and debugging. |
| `npn_holds` | ~160 active | **YES — active rows only** | Pending NPN resolutions. Small table. |
| `proposed_fires` | varies | **YES — active rows only** | Held fires awaiting NPN. |
| `lifecycle_cron_runs` | ~1,000+ | No — start fresh | Heartbeat log. Historical data not needed. |
| `lifecycle_canary_runs` | varies | No — start fresh | Canary health log. |
| `lifecycle_confirm_tokens` | ephemeral | No | Short-lived tokens, auto-purged. |

### Cron Jobs (5)

| Job | Schedule | Description |
|---|---|---|
| `lifecycle-direct-poll` | `*/30 * * * *` | Main trigger engine — runs every 30 min |
| `lifecycle-direct-deadman` | `*/30 * * * *` | Slack alert if no tick in 35 min |
| `ghl-canary-daily` | `30 13 * * *` (8:30 AM CT) | Daily GHL health check |
| `npn-resolution-daily` | `0 12 * * *` (7:00 AM CT) | Daily NPN resolution |
| `proposed-fires-push-daily` | `15 12 * * *` (7:15 AM CT) | Daily push of resolved NPN holds |

### Secrets Required (10)

| Secret | Purpose |
|---|---|
| `PROD_DB_HOST` | Max's production DB connection |
| `PROD_DB_PORT` | " |
| `PROD_DB_NAME` | " |
| `PROD_DB_USER` | " |
| `PROD_DB_PASSWORD` | " |
| `PROD_DB_CA_CERT` | Akamai TLS certificate |
| `GHL_API_KEY_SUNFIRE` | GHL API key for Sunfire location |
| `GHL_LOCATION_ID_SUNFIRE` | GHL location ID |
| `LIFECYCLE_CRON_SECRET` | Cron authentication |
| `LIFECYCLE_CRON_KEY` | Cron authentication (secondary) |

### Migration Steps — Tier 1

1. Create tables in `rcbzag`: `fired_triggers`, `lifecycle_event_log`, `npn_holds`, `proposed_fires`, `lifecycle_cron_runs`, `lifecycle_canary_runs`, `lifecycle_confirm_tokens` — matching schemas from `lryxx`.
2. Migrate `fired_triggers` data (full history) — this is the critical idempotency gate.
3. Migrate `lifecycle_event_log` data (full history).
4. Migrate active `npn_holds` and `proposed_fires` rows.
5. Copy edge functions into FYM App repo: `lifecycle-direct`, `proposed-fires-push`, `npn-resolution`, `ghl-canary`.
6. Extract `ghl-client.ts` and `lifecycle-evaluator.ts` into `_shared/` in FYM App.
7. Copy `agency-map.ts` and `rate-limiter.ts` into FYM App `_shared/`.
8. Set all 10 secrets on `rcbzag` edge functions.
9. Update edge function URLs in cron jobs to point to `rcbzag`.
10. Deploy edge functions to `rcbzag`.
11. Create cron jobs in `rcbzag`.
12. Run parallel for 48 hours (both tracker and FYM App firing — `fired_triggers` idempotency prevents double-push).
13. Disable tracker cron jobs once FYM App is confirmed stable.
14. Update fire rate monitor's portal connection (already uses `PORTAL_SUPABASE_*` secrets — just verify they're set on `rcbzag`).

---

## Tier 2 — GHL Token Management

**Priority:** HIGH — needed by Tier 1 functions
**Estimated effort:** 1 build session
**Dependencies:** None

### Edge Functions (3)

| Function | Lines | Description |
|---|---|---|
| `ghl-token-refresh` | 245 | Refreshes GHL OAuth tokens every 6 hours |
| `ghl-oauth-callback` | 178 | OAuth callback handler for GHL app authorization |
| `ghl-webhook` | 299 | Inbound GHL webhook receiver (disposition updates, etc.) |

### Tables (1)

| Table | Migrate Data? | Notes |
|---|---|---|
| `ghl_location_tokens` | **YES** | OAuth refresh tokens per GHL location. Without these, all GHL API calls fail until re-authorized. |

### Cron Jobs (1)

| Job | Schedule | Description |
|---|---|---|
| `ghl-token-refresh` | `0 */6 * * *` | Every 6 hours |

### Additional Secrets

| Secret | Purpose |
|---|---|
| `GHL_APP_CLIENT_ID` | GHL OAuth app credentials |
| `GHL_APP_CLIENT_SECRET` | " |

### Migration Steps — Tier 2

1. Create `ghl_location_tokens` table in `rcbzag`.
2. Migrate token data.
3. Copy edge functions to FYM App repo.
4. Set secrets.
5. Deploy and create cron job.
6. Update GHL app OAuth redirect URL to point to `rcbzag` callback.
7. Verify token refresh cycle works end-to-end.

---

## Tier 3 — GHL Reconciliation

**Priority:** MEDIUM
**Estimated effort:** 0.5 build session
**Dependencies:** Tier 2 (needs GHL tokens)

### Edge Functions (1)

| Function | Lines | Description |
|---|---|---|
| `ghl-reconcile` | 557 | Reconciles fired events against GHL contacts. Identifies mismatches. |

### Migration Steps — Tier 3

1. Copy edge function to FYM App repo.
2. Update table references to `rcbzag` versions (reads `lifecycle_event_log`, `agents`).
3. Deploy. No cron — runs on-demand.

---

## Tier 4 — Data Import Pipeline

**Priority:** LOWER — depends on `form_submissions` consumer audit
**Estimated effort:** 2–3 build sessions (complex)
**Dependencies:** Audit of remaining `form_submissions` readers

### Edge Functions (1)

| Function | Lines | Description |
|---|---|---|
| `sql-import-cron` | 1,731 | Max's DB → `form_submissions` sync. Multi-carrier (UNL, GTL, AHL, Manhattan). Also runs lifecycle evaluation. |

### Tables (~15)

| Table | Migrate? | Notes |
|---|---|---|
| `form_submissions` | **COMPLEX** | 57K+ policy rows (UNL + GTL + AHL + Manhattan). FYM App has `policy_cache` which syncs from this. Question: can `policy_cache` fully replace `form_submissions`? |
| `agencies` | Already in rcbzag | ✅ Exists. May need field reconciliation. |
| `agents` | Needs migration | Agent directory with NPN, writing numbers. |
| `agency_rosters` | Already in rcbzag | ✅ Exists. May need field reconciliation. |
| `carrier_agency_mappings` | YES | Maps carrier-specific agency codes to tracker agencies. |
| `carrier_agent_mappings` | YES | Maps carrier-specific agent codes. |
| `carrier_column_mappings` | YES | Column mapping config per carrier. |
| `carrier_plan_codes` | YES | Plan code normalization. |
| `data_sources` | Maybe | Data source config. |
| `source_uploads` | No | Staging — purged after 3 days. |
| `source_records` | No | Staging — purged with uploads. |
| `upload_history_log` | No | Trimmed to 30 days. |
| `column_mappings` | YES | Column mapping config. |

### Cron Jobs (3)

| Job | Schedule | Description |
|---|---|---|
| `sql-import-daily` | `0 20 * * *` (3:00 PM CT) | Daily full import |
| `sql-import-poll` | `*/15 * * * *` | Check for new data sources every 15 min |
| `poll-data-sources-hourly` | `0 * * * *` | Hourly data source poll |

### Key Question Before Migrating

**Can `policy_cache` in `rcbzag` fully replace `form_submissions` in `lryxx`?**

Current consumers of `form_submissions`:
- Dashboard production cards → already migrated to Max's DB views in FYM App
- Book of Business → already migrated (`book-of-business` edge fn in FYM App)
- Leaderboard → partially migrated (non-UNL carriers still read `form_submissions`)
- `ghl-webhook` → reads `form_submissions` for disposition updates
- `sql-import-cron` → writes `form_submissions`

**If all consumers can read from `policy_cache` or Max's DB directly, the import pipeline simplifies dramatically.** The FYM App's `lifecycle-sync` already syncs policy data from the tracker → `policy_cache`. Once the lifecycle pipeline moves to `rcbzag`, the sync path becomes: Max's DB → `policy_cache` (direct, no tracker intermediary).

### Migration Steps — Tier 4

1. Audit every remaining `form_submissions` consumer.
2. Migrate non-UNL leaderboard reads to `policy_cache` or Max's DB.
3. Migrate `ghl-webhook` disposition logic.
4. Once all consumers are migrated, the import pipeline either moves to `rcbzag` or is retired entirely (if `policy_cache` sync covers everything).

---

## Tier 5 — UI/Dashboard Functions (Die with the Frontend)

**Priority:** LOWEST — retire when tracker frontend is shut down
**No migration needed** — FYM App already has equivalent views.

| Function | Lines | FYM App Equivalent |
|---|---|---|
| `admin-api` | 5,714 | Various FYM App edge functions + CRM Command |
| `leaderboard-api` | — | FYM App leaderboard views |
| `quality-metrics-direct` | — | FYM App `retention-data` + `prod-data` |
| `public-api` | — | Not needed |
| `agent-webhook` | — | FYM App `provision-agent` |
| `enrollhere-poll` | — | Standalone — may stay or move separately |

---

## What FYM App Already Has

These components are already built and operational in `rcbzag`:

| Component | Status |
|---|---|
| `agencies` table (103 agencies) | ✅ Live |
| `agency_rosters` table | ✅ Live |
| `policy_cache` (nightly sync) | ✅ Live |
| Production views (monthly, agency, agent, BoB) | ✅ Live |
| Retention/quality metrics | ✅ Live |
| Leaderboard | ✅ Live |
| At-risk workboard with GHL sync | ✅ Live |
| Cross-sell GHL push | ✅ Live |
| CRM Command (reads portal DB) | ✅ Live |
| GHL Live Feed toggle (Phase 1 — reads tracker DB) | ✅ Live |

---

## Remaining Tracker-Only Infrastructure

After all tiers are migrated, the following remain in the tracker with no FYM App equivalent:

| Item | Action |
|---|---|
| `monte-carlo-refresh` cron jobs (3) | Retire or migrate if still used |
| `purge-*` cron jobs (4) | Recreate in rcbzag for migrated tables |
| Tracker admin UI (hip.teamfym.com) | Retire when FYM App UI is at full parity |
| `admin_credentials`, `admin_sessions` | Tracker-only auth — retire |
| Gamification tables (`challenges`, `challenge_progress`, `badges`, etc.) | Already in FYM App — retire tracker copies |
| `at_risk_activities`, `policy_attention_actions` | Superseded by FYM App workboard — retire |

---

## Timeline

| Phase | Target | Status |
|---|---|---|
| Trigger E + fire rate monitor | ✅ Shipped (PRs #171 + #174) | Done |
| Tier 1 — lifecycle pipeline | TBD (when Charlie gives go) | Planning |
| Tier 2 — GHL tokens | TBD (with Tier 1 or immediately after) | Planning |
| Tier 3 — reconciliation | TBD (after Tier 2) | Planning |
| Tier 4 — import pipeline | TBD (needs consumer audit first) | Planning |
| Tier 5 — UI retirement | When FYM App UI at full parity | Waiting |
| Tracker decommission | After all tiers complete + parallel run | Waiting |

---

## Changelog

| Date | Change |
|---|---|
| 2026-09-08 | Initial document created. Trigger E (PR #171) and fire rate monitor (PR #174) shipped. Full 5-tier migration inventory compiled. |
