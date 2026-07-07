# FDW production cutover — reading the book from Max's DB

Goal: retire the local import (`form_submissions` + `sql-import-cron` + data-source
ingestion) and read the current-state policy book directly from Max's production
`analytics` database via `postgres_fdw`. Single source of truth, one carrier file
per day, no bespoke import parser.

This doc covers the **proof phase**: prove `get_quality_metrics` produces the same
numbers off the FDW as off `form_submissions`, before touching anything live.

## What migration `20260707170000` creates (additive, non-destructive)
- `postgres_fdw` extension (already enabled).
- Foreign server `prod_analytics` → `...akamaidb.net:27319 / analytics`.
- Foreign table `prod.unl_fym_policy_latest_load` → Max's `typed.unl_fym_policy_latest_load`.
- Compatibility view `public.form_submissions_fdw` — remaps Max's columns to the
  names the RPCs expect (see the migration header for the full map).
- Parallel RPC `get_quality_metrics_fdw(uuid, uuid[])` — a 1:1 copy of the live
  `get_quality_metrics` that reads the compat view instead of `form_submissions`.

Nothing here modifies `form_submissions` or the live RPC.

## ONE manual secret step (never committed to git)
The FDW **user mapping** carries the read-only reader password, so it is created
by a human once, in the Supabase SQL editor (project `lryxxnpafaxjgehqirdp`):

```sql
CREATE USER MAPPING FOR postgres
  SERVER prod_analytics
  OPTIONS (user 'unl_fym_policy_reader', password '<READER_PASSWORD>');
```

Notes:
- `get_quality_metrics_fdw` is `SECURITY DEFINER`; the FDW connection runs as the
  function **owner**. On Supabase that is typically `postgres` — hence the mapping
  above. If `\df+ get_quality_metrics_fdw` shows a different owner, add a mapping
  for that role too.
- The password is the same reader credential already in our container env
  (`PROD_DB_PASSWORD`). Do **not** paste it into the repo, PRs, or chat.
- Prefer Supabase Vault if you'd rather not inline it; the mapping can read from
  Vault instead of a literal.

## Apply + validate (proof)
1. Apply migration `20260707170000` (branch `feat/fdw-production-compat-quality-metrics`).
2. Run the manual user-mapping step above.
3. Smoke test the connection:
   ```sql
   SELECT count(*) FROM prod.unl_fym_policy_latest_load;      -- expect ~37k
   SELECT count(*) FROM public.form_submissions_fdw;          -- same
   ```
4. Diff the RPCs whole-book and per-agency (Guardian is the strongest check —
   we already reconciled 21,836 on Max vs 21,833 on the tracker):
   ```sql
   SELECT get_quality_metrics();                              -- live (form_submissions)
   SELECT get_quality_metrics_fdw();                          -- FDW compat
   -- Guardian:
   SELECT get_quality_metrics('<guardian_agency_uuid>');
   SELECT get_quality_metrics_fdw('<guardian_agency_uuid>');
   ```
   Expect placement/persistency within rounding. Investigate any material gap
   (candidate causes below).

## Known semantic items to validate (do not assume parity)
- **`status`**: compat derives `active` = `term_date IS NULL`, else `terminated`.
  The tracker may carry richer statuses (lapsed/pending). Persistency only tests
  `= 'active'`, so this should be equivalent, but confirm the still-active counts
  line up per cohort.
- **`agency_id`**: resolved by joining the roster depth-02 node name to
  `public.agencies` on normalized name. Watch for agencies whose Max name doesn't
  string-match the tracker name (spacing/casing/legal-suffix drift). Any unmatched
  rows get `agency_id = NULL` and drop out of agency-scoped calls — check the
  whole-book vs summed-per-agency totals to catch this.
- **`app_submit_date` <- `app_recvd_date`**: confirm these mean the same date the
  tracker's placement window keys on.
- **Snapshot completeness**: `typed.unl_fym_policy_latest_load` must retain
  terminated policies (it does — `term_date` populated) so persistency denominators
  are correct.

## Performance
FDW pushes filters/aggregates to Max's DB where it can, but whole-book scans cross
the network. Because it's one file/day, if any dashboard feels slow, materialize
the compat view into a table refreshed once daily — the repo already has the
pattern (`mv_monte_carlo_daily` + `refresh_monte_carlo_view`). Do this only if the
live FDW read proves too slow; don't pre-optimize.

## After the proof passes
- Repoint remaining read RPCs (`dashboard_*`, `get_at_risk_*`, `monte_carlo_*`,
  `get_agent_*`) at the compat view, one at a time, validating each.
- Decommission the import subsystem (`sql-import-cron`, `poll-data-sources`,
  `data_sources`/`source_uploads`/`source_records`, CSV uploader + column mapper).
- Decide at-risk ownership: Max's `at_risk_policy` vs the tracker's
  `lifecycle-evaluator` (they use the same rule). Keep action-state tables
  (`at_risk_activities`, `policy_attention_actions`) tracker-side.
- Keep tracker-only domains local: intake/lead submissions, leaderboard/gamification,
  agent/manager auth, dispositions, notifications, commissions.
