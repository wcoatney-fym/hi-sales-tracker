import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * ghl-reconcile — one-shot backfill for 239 policies that missed GHL contact
 * creation during the no-config era (2026-07-03–10).
 *
 * PUSH SEMANTICS (explicit, per Will 2026-07-16):
 *   - One contact per policy, current state as of push day.
 *   - Policies that recovered: if originally missed as at-risk but are no
 *     longer at-risk today (contract_code='A', paid_to_date current), they
 *     still get a contact — but with at_risk_status='No' and
 *     client_status='Active'. No stale at-risk signal. Current state only.
 *   - Policies that terminated since missed event: pushed with
 *     client_status='Terminated', termination fields populated. Correct.
 *   - Policies that were submission/approved triggers: pushed with current
 *     state (Active if still active, Terminated if lapsed). Correct.
 *   - Stale at-risk rule: a contact is NEVER pushed with at_risk_status='Yes'
 *     unless the policy is STILL at-risk today (paid_to_date < threshold).
 *     The at_risk_status field reflects current state, not the trigger that
 *     fired in the no-config era.
 *
 * WORKFLOW SUPPRESSION (condition 2 — Chris sign-off required before prod):
 *   - All reconcile contacts receive tag: `reconciled | do not automate`
 *   - This tag must be mapped to a GHL workflow suppression condition by Chris
 *     before any prod run. Build test first; Chris confirms suppression works.
 *   - Prevents 2-week-delayed client-facing SMS/email from firing on stale events.
 *
 * FIELD ID RESOLUTION (condition 3):
 *   - Build run:  uses GHL_LOCATION_ID_BUILD_ACT + Build-namespace field IDs
 *   - Prod run:   uses GHL_LOCATION_ID_SUNFIRE  + Sunfire-namespace field IDs
 *   - Field IDs are resolved at runtime via GET /locations/{id}/customFields,
 *     keyed by fieldKey. No hardcoded cross-location IDs.
 *   - Fallback: if a fieldKey is not found for the target location, that field
 *     is omitted and a warning is logged (never fails the push over a missing field).
 *
 * RATE LIMITING: 80 requests per 10 seconds (GHL ceiling ~100/10s).
 *
 * GATES (enforced in code):
 *   - DRY_RUN=true by default. Set request body { "dryRun": false } to push live.
 *   - TARGET must be explicitly set: body { "target": "build" | "prod" }.
 *     Omitting target = error, no push.
 *   - Prod requires body { "prodConfirmed": true } as an additional interlock.
 *   - Chris sign-off tag present on all contacts regardless of target.
 *
 * REQUIRED SUPABASE SECRETS:
 *   SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
 *   GHL_API_KEY_BUILD_ACT        (Build token)
 *   GHL_LOCATION_ID_BUILD_ACT    (Build location)
 *   GHL_API_KEY_HIP_PORTAL_SUNFIRE  (Sunfire/prod token)
 *   GHL_LOCATION_ID_SUNFIRE         (Sunfire/prod location)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PolicyRow {
  policy_number: string;
  product_type: string;
  contract_code: string;
  paid_to_date: string | null;
  plan_name: string | null;
  plan_premium: string | null;
  billing_mode: string | null;
  carrier_name: string | null;
  submission_date: string | null;
  effective_date: string | null;
  termination_date: string | null;
  terminated_reason: string | null;
  agent_npn: string | null;
  agent_first_name: string | null;
  agent_full_name: string | null;
  agent_writing_number: string | null;
  agency: string | null;
  middle_initial: string | null;
  phone: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
}

interface FieldIdMap {
  [fieldKey: string]: string; // fieldKey -> fieldId for this location
}

interface ReconcileResult {
  policy_number: string;
  ok: boolean;
  http_status: number | null;
  dry_run: boolean;
  error: string | null;
  skipped: boolean;
  skip_reason: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const RECONCILE_TAG     = "reconciled | do not automate";
const RATE_LIMIT_BATCH  = 80;
const RATE_LIMIT_MS     = 10_000;

// fieldKeys we write — resolved to IDs per location at runtime
const GLOBAL_FIELD_KEYS = [
  "contact.agent_npn",
  "contact.ancillary_agency__sorting",
  "contact.middle_initial",
];

const LOB_FIELD_KEY_SUFFIXES = [
  "plan_name", "plan_premium", "submission_date", "effective_date",
  "paid_to_date", "billing_mode", "at_risk_status", "client_status",
  "policy_number", "carrier_name", "agent_first_name", "agent_full_name",
  "agent_writing_number", "terminated_reason", "termination_date",
];

// Plan type → LOB prefix map (matches ghl-client.ts)
const LOB_PREFIX: Record<string, string> = {
  HIP: "hip", HHC: "hhc", LIFE: "life", DV: "dv", CANCER: "cancer",
};

// ---------------------------------------------------------------------------
// Field ID resolution — fetched fresh per target location, keyed by fieldKey
// ---------------------------------------------------------------------------
async function resolveFieldIds(
  locationId: string,
  token: string,
  apiBase: string,
): Promise<FieldIdMap> {
  const resp = await fetch(`${apiBase}/locations/${locationId}/customFields`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Version: "2021-07-28",
      Accept: "application/json",
    },
  });
  if (!resp.ok) {
    console.error(`[reconcile] field ID resolution failed: HTTP ${resp.status}`);
    return {};
  }
  const data = await resp.json() as { customFields?: Array<{ id: string; fieldKey: string }> };
  const map: FieldIdMap = {};
  for (const f of data.customFields ?? []) {
    if (f.fieldKey && f.id) map[f.fieldKey] = f.id;
  }
  console.log(`[reconcile] resolved ${Object.keys(map).length} field IDs for location ${locationId}`);
  return map;
}

// ---------------------------------------------------------------------------
// At-risk determination — current state, not historical trigger
// Mirrors the logic in lifecycle-evaluator.ts: at-risk if paid_to_date is
// more than 30 days behind today for monthly, or lapsed for non-monthly.
// Conservative: if paid_to_date is null, treat as NOT at-risk (unknown state).
// ---------------------------------------------------------------------------
function isCurrentlyAtRisk(policy: PolicyRow): boolean {
  if (!policy.paid_to_date) return false;
  if (policy.contract_code !== "A") return false; // terminated = not at-risk
  const paidTo = new Date(policy.paid_to_date);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  return paidTo < thirtyDaysAgo;
}

// ---------------------------------------------------------------------------
// Build GHL contact body from current policy state
// ---------------------------------------------------------------------------
function buildContactBody(
  policy: PolicyRow,
  locationId: string,
  fieldIds: FieldIdMap,
): Record<string, unknown> {
  const str = (v: unknown) => (v == null || v === "" || v === "0") ? "" : String(v);

  const lobKey = LOB_PREFIX[policy.product_type] ?? null;
  const atRisk = isCurrentlyAtRisk(policy);
  const isTerminated = policy.contract_code !== "A";

  const clientStatus   = isTerminated ? "Terminated" : "Active";
  const atRiskStatus   = atRisk ? "Yes" : "No";
  const productTag     = lobKey ? `${lobKey} | sold client` : null;

  const customFields: Array<{ id: string; value: string }> = [];

  const push = (fieldKey: string, value: string) => {
    const id = fieldIds[fieldKey];
    if (!id) {
      console.warn(`[reconcile] fieldKey ${fieldKey} not found in location ${locationId} — skipping`);
      return;
    }
    if (value) customFields.push({ id, value });
  };

  // Global fields
  push("contact.agent_npn",                str(policy.agent_npn));
  push("contact.ancillary_agency__sorting", str(policy.agency));
  push("contact.middle_initial",           str(policy.middle_initial));

  // LOB fields
  if (lobKey) {
    const p = `contact.${lobKey}__`;
    push(`${p}client_status`,      clientStatus);
    push(`${p}at_risk_status`,     atRiskStatus);
    push(`${p}policy_number`,      str(policy.policy_number));
    push(`${p}carrier_name`,       str(policy.carrier_name));
    push(`${p}plan_name`,          str(policy.plan_name));
    push(`${p}plan_premium`,       str(policy.plan_premium));
    push(`${p}billing_mode`,       str(policy.billing_mode));
    push(`${p}submission_date`,    str(policy.submission_date));
    push(`${p}effective_date`,     str(policy.effective_date));
    push(`${p}paid_to_date`,       str(policy.paid_to_date));
    push(`${p}agent_first_name`,   str(policy.agent_first_name));
    push(`${p}agent_full_name`,    str(policy.agent_full_name));
    push(`${p}agent_writing_number`, str(policy.agent_writing_number));
    if (isTerminated) {
      push(`${p}terminated_reason`,  str(policy.terminated_reason));
      push(`${p}termination_date`,   str(policy.termination_date));
    }
  }

  const tags = [RECONCILE_TAG];
  if (productTag) tags.push(productTag);

  const body: Record<string, unknown> = {
    locationId,
    source: "activity-tracker-reconcile",
    tags,
    customFields,
  };

  // Contact identity fields (best-effort — UNL may not have all)
  if (str(policy.first_name)) body.firstName = str(policy.first_name);
  if (str(policy.last_name))  body.lastName  = str(policy.last_name);
  const phone = str(policy.phone);
  if (phone && phone !== "0") body.phone = phone;
  if (str(policy.email)) body.email = str(policy.email);

  return body;
}

// ---------------------------------------------------------------------------
// GHL POST with retries on 429
// ---------------------------------------------------------------------------
async function ghlPost(
  url: string,
  token: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Version: "2021-07-28",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    if (resp.status === 429) {
      const retryAfter = parseInt(resp.headers.get("Retry-After") ?? "10", 10);
      console.warn(`[reconcile] 429 rate limit — waiting ${retryAfter}s`);
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      continue;
    }
    let data: unknown = null;
    try { data = await resp.json(); } catch { /* non-JSON */ }
    return { ok: resp.ok, status: resp.status, data };
  }
  return { ok: false, status: 429, data: "Max retries exceeded" };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabaseUrl    = Deno.env.get("SUPABASE_URL") ?? "";
  const authHeader     = req.headers.get("Authorization") ?? "";

  if (!serviceRoleKey || !authHeader.includes(serviceRoleKey)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const apiBase  = Deno.env.get("GHL_API_BASE") ?? "https://services.leadconnectorhq.com";

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }

  // ── Gate 1: target must be explicit ──────────────────────────────────────
  const target = (body.target as string | undefined)?.toLowerCase();
  if (target !== "build" && target !== "prod") {
    return jsonResponse({
      error: 'target must be explicitly set: { "target": "build" } or { "target": "prod" }. No default.',
    }, 400);
  }

  // ── Gate 2: prod requires additional interlock ────────────────────────────
  if (target === "prod" && body.prodConfirmed !== true) {
    return jsonResponse({
      error: 'Prod run requires { "prodConfirmed": true } in request body. Add it only after Build test passes and Chris has signed off on workflow suppression in #dev-ghl.',
    }, 400);
  }

  const dryRun = body.dryRun !== false; // default true

  // ── Resolve GHL config for target ────────────────────────────────────────
  const ghlToken      = target === "prod"
    ? Deno.env.get("GHL_API_KEY_HIP_PORTAL_SUNFIRE")
    : Deno.env.get("GHL_API_KEY_BUILD_ACT");
  const ghlLocationId = target === "prod"
    ? Deno.env.get("GHL_LOCATION_ID_SUNFIRE")
    : Deno.env.get("GHL_LOCATION_ID_BUILD_ACT");

  if (!ghlToken || !ghlLocationId) {
    return jsonResponse({
      error: `Missing GHL secrets for target="${target}". ` +
        (target === "prod"
          ? "Need: GHL_API_KEY_HIP_PORTAL_SUNFIRE, GHL_LOCATION_ID_SUNFIRE"
          : "Need: GHL_API_KEY_BUILD_ACT, GHL_LOCATION_ID_BUILD_ACT"),
    }, 500);
  }

  // ── Resolve field IDs for this location ──────────────────────────────────
  const fieldIds = await resolveFieldIds(ghlLocationId, ghlToken, apiBase);
  if (Object.keys(fieldIds).length === 0) {
    return jsonResponse({ error: "Failed to resolve field IDs — cannot proceed" }, 500);
  }

  // ── Fetch policies to reconcile ───────────────────────────────────────────
  // Get distinct policy numbers from lifecycle_event_log (no-GHL-config era)
  const { data: logRows, error: logErr } = await supabase
    .from("lifecycle_event_log")
    .select("policy_number")
    .like("error", "%no GHL config%");

  if (logErr) {
    return jsonResponse({ error: `Failed to query lifecycle_event_log: ${logErr.message}` }, 500);
  }

  const policyNumbers = [...new Set((logRows ?? []).map((r: { policy_number: string }) => r.policy_number))];
  console.log(`[reconcile] ${policyNumbers.length} distinct policies to process`);

  if (policyNumbers.length === 0) {
    return jsonResponse({ ok: true, message: "No policies to reconcile", processed: 0 });
  }

  // Fetch current state for all policies
  const { data: policies, error: polErr } = await supabase
    .from("form_submissions")
    .select([
      "policy_number", "product_type", "contract_code", "paid_to_date",
      "plan_name", "plan_premium", "billing_mode", "carrier_name",
      "submission_date", "effective_date", "termination_date", "terminated_reason",
      "agent_npn", "agent_first_name", "agent_full_name", "agent_writing_number",
      "agency", "middle_initial", "phone", "email",
      "first_name", "last_name",
    ].join(","))
    .in("policy_number", policyNumbers);

  if (polErr) {
    return jsonResponse({ error: `Failed to query form_submissions: ${polErr.message}` }, 500);
  }

  const policyMap = new Map<string, PolicyRow>(
    (policies ?? []).map((p: PolicyRow) => [p.policy_number, p]),
  );

  // ── Push loop with rate limiting ──────────────────────────────────────────
  const results: ReconcileResult[] = [];
  let batchCount = 0;

  for (const policyNumber of policyNumbers) {
    const policy = policyMap.get(policyNumber);

    if (!policy) {
      results.push({
        policy_number: policyNumber, ok: false, http_status: null,
        dry_run: dryRun, error: "Policy not found in form_submissions",
        skipped: true, skip_reason: "not_found",
      });
      continue;
    }

    const contactBody = buildContactBody(policy, ghlLocationId, fieldIds);

    if (dryRun) {
      results.push({
        policy_number: policyNumber, ok: true, http_status: null,
        dry_run: true, error: null, skipped: false, skip_reason: null,
      });
      batchCount++;
    } else {
      const result = await ghlPost(`${apiBase}/contacts/`, ghlToken, contactBody);
      results.push({
        policy_number: policyNumber,
        ok: result.ok,
        http_status: result.status,
        dry_run: false,
        error: result.ok ? null : `HTTP ${result.status}: ${JSON.stringify(result.data).slice(0, 200)}`,
        skipped: false,
        skip_reason: null,
      });
      batchCount++;

      // Rate limiting: pause after every RATE_LIMIT_BATCH requests
      if (batchCount % RATE_LIMIT_BATCH === 0) {
        console.log(`[reconcile] batch ${batchCount} — pausing ${RATE_LIMIT_MS}ms`);
        await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
      }
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const ok_count      = results.filter(r => r.ok && !r.skipped).length;
  const fail_count    = results.filter(r => !r.ok && !r.skipped).length;
  const skip_count    = results.filter(r => r.skipped).length;
  const failures      = results.filter(r => !r.ok && !r.skipped);

  console.log(`[reconcile] done — ok=${ok_count} fail=${fail_count} skip=${skip_count} dry_run=${dryRun}`);

  return jsonResponse({
    ok: fail_count === 0,
    target,
    dry_run: dryRun,
    location_id: ghlLocationId,
    total: policyNumbers.length,
    processed: results.length,
    ok_count,
    fail_count,
    skip_count,
    reconcile_tag: RECONCILE_TAG,
    failures: failures.slice(0, 20), // first 20 failures for diagnosis
  });
});
