# quality-metrics-direct (Option A prototype)

Queries Max's production analytics DB **directly** for book quality (placement +
persistency) and returns the same JSON shape as the `get_quality_metrics` RPC.
This is the "query the database directly" architecture: the aggregate runs on
Max's indexed `typed` tables (~0.2–1.4s), not federated through Supabase (FDW).

## Why
FDW (Supabase reaching into Max's DB over the network) times out on whole-book
scans. Querying Max's DB directly is fast — verified against production:
- whole book: **389 ms**
- Guardian Benefits Inc: **1.4 s**

No FDW, no daily copy. Single source of truth, read live.

## Secrets (set as Supabase function secrets — NEVER commit)
```
supabase secrets set \
  PROD_DB_HOST=... PROD_DB_PORT=27319 PROD_DB_NAME=analytics \
  PROD_DB_USER=unl_fym_policy_reader PROD_DB_PASSWORD=... \
  --project-ref lryxxnpafaxjgehqirdp
```
(The reader creds already in the container env; the function reads them from
`Deno.env`. `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are injected by the
platform and used only to resolve `agency_id` -> hierarchy name.)

## Deploy + test
```
supabase functions deploy quality-metrics-direct --project-ref lryxxnpafaxjgehqirdp

# whole book:
curl -s -X POST "$SUPABASE_URL/functions/v1/quality-metrics-direct" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
  -d '{}' | jq

# one agency (Supabase agencies.id uuid):
curl -s -X POST "$SUPABASE_URL/functions/v1/quality-metrics-direct" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
  -d '{"p_agency_id":"<guardian-uuid>"}' | jq
```
Response includes `_elapsed_ms` and `_source:"prod_direct"` for the speed check.

## Notes / validation before promoting past prototype
- **Auth:** `verify_jwt=false` + service-role call, matching the other data
  functions. Add proper admin-token gating before wiring to a public surface.
- **Agency scoping** resolves `agency_id` -> depth-02 hierarchy name and filters
  Max's `roster_hierarchy_json`. Name match is exact (upper-cased); watch for
  agencies whose Max name differs from the tracker name.
- **`status`** parity: `still_active` = `term_date IS NULL`. Confirm vs tracker.
- Older Guardian cohorts (6/9/13 mo) return ~0 in the current snapshot because
  the book skews new; whole-book has data. Confirm `latest_load` retention of
  older-effective policies matches expectations.
- Connection uses `ssl:'require'`, `max:1` per invocation. If cold-start
  connection latency matters at scale, consider a pooled connection or a small
  keep-warm; not needed for the prototype.
