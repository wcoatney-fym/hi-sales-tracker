import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildAgencyMap, resolveAgencyName } from "../_shared/agency-map.ts";

// Plan code → human-readable name. Mirrors lifecycle-direct PLAN_CODE_MAP.
const PLAN_CODE_MAP: Record<string, string> = {
  UHIP2: "Hospital Indemnity Shield 2.0",
  UNHIP: "Original Hospital Indemnity Shield",
  UGHIP: "Guaranteed Issue Hospital Indemnity Shield",
  UFGHI: "Guaranteed Issue Hospital Indemnity Shield - FL with Assoc.",
  UFHIP: "Hospital Indemnity Shield 2.0 - FL with Assoc.",
  UTHHC: "Home Health Care Shield with TCARE benefit",
  UNHHC: "Original Home Health Care Shield",
  UAHHC: "Original Home Health Care Shield",
  UIHHC: "Caregiver Shield",
  UAGHI: "Guaranteed Issue Hospital Indemnity Shield",
  UNCAN: "Cancer Shield 2.0",
  UDN21: "Dental Shield 2.0",
  UDN24: "Dental Shield 2.0 with waiving of waiting periods option",
};

function resolvePlanName(code: string | null): string {
  const k = (code ?? "").trim().toUpperCase();
  return PLAN_CODE_MAP[k] ?? k;
}

/**
 * ghl-reconcile — one-shot backfill for policies that missed GHL contact
 * creation during the no-config era (2026-07-03–10).
 *
 * Always targets Sunfire Production (IQljfeWX6wWHmzUtgSyz). Field IDs
 * resolved at runtime via GET /locations/{id}/customFields — no hardcoded IDs.
 *
 * PUSH SEMANTICS (explicit, per Will 2026-07-16):
 *   - One contact per policy, current state as of push day.
 *   - at_risk_status = TODAY's state (shared deriveAtRisk logic).
 *     Recovered policy → at_risk_status='No'. No stale-risk signal, ever.
 *   - Terminated policies: client_status='Terminated' + termination fields.
 *
 * WORKFLOW SUPPRESSION:
 *   - All contacts receive tag: 'reconciled | do not automate'
 *   - Prevents stale client-facing sends on historical events.
 *   - Chris has configured suppression in Sunfire (confirmed 2026-07-17).
 *
 * RATE LIMITING: 80 requests per 10 seconds with 429 backoff.
 *
 * TARGETS:
 *   "test" — Sunfire, no prodConfirmed gate. Use testPolicyNumbers:[...] for
 *             a spot-check before running full prod. Recommended first step.
 *   "prod" — Sunfire, full backfill. Requires { "prodConfirmed": true }.
 *
 * GATES:
 *   - dryRun=true by default. Pass { "dryRun": false } to push live.
 *   - target required: "test" or "prod" — no default.
 *   - "prod" also requires { "prodConfirmed": true }.
 */

// ---------------------------------------------------------------------------
// Types — using actual form_submissions column names
// ---------------------------------------------------------------------------
interface PolicyRow {
  policy_number: string;
  product_type: string;
  contract_code: string;
  billing_form: string | null;
  paid_to_date: string | null;
  plan_name: string | null;
  plan_premium: number | string | null;
  billing_mode: string | null;
  carrier: string | null;
  app_submit_date: string | null;
  policy_effective_date: string | null;
  terminated_date: string | null;
  contract_reason: string | null;
  agent_number: string | null;
  agent_first_name: string | null;
  agent_last_name: string | null;
  agency: string | null;
  phone: string | null;
  email: string | null;
  client_first_name: string | null;
  client_last_name: string | null;
  status: string | null;
}

interface AgentNpnRow {
  writing_number: string;
  npn: string | null;
}

interface FieldIdMap {
  [fieldKey: string]: string;
}

interface ReconcileResult {
  policy_number: string;
  ok: boolean;
  http_status: number | null;
  error: string | null;
  skipped: boolean;
  skip_reason: string | null;
}

// ---------------------------------------------------------------------------
// At-risk logic — mirrors deriveAtRisk() in lifecycle-evaluator.ts exactly
// ---------------------------------------------------------------------------
function deriveAtRisk(policy: PolicyRow, now: number = Date.now()): boolean {
  if ((policy.contract_code || "").trim().toUpperCase() !== "A") return false;
  if ((policy.billing_form  || "").trim().toUpperCase() !== "DIR") return false;
  if (!policy.paid_to_date) return false;
  const ptd = new Date(policy.paid_to_date + "T00:00:00Z").getTime();
  if (isNaN(ptd)) return false;
  const d = new Date(now);
  const todayUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return ptd < todayUtc;
}

// ---------------------------------------------------------------------------
// Contract reason label — mirrors contractReasonLabel() in lifecycle index.ts
// ---------------------------------------------------------------------------
function contractReasonLabel(code: string | null): string {
  if (!code) return "";
  const map: Record<string, string> = {
    NS: "Non-Sufficient Funds",
    CA: "Client Requested Cancellation",
    NR: "Non-Renewal",
    DE: "Deceased",
    DB: "Duplicate Billing",
    DP: "Duplicate Policy",
    FR: "Fraud",
    IC: "Invalid Coverage",
    PA: "Policy Anniversary",
    RP: "Replaced Policy",
  };
  return map[code.toUpperCase()] ?? code;
}

// ---------------------------------------------------------------------------
// Date formatter MM/DD/YYYY — mirrors usDate() in lifecycle index.ts
// ---------------------------------------------------------------------------
function usDate(iso: string | null): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

// ---------------------------------------------------------------------------
// LOB prefix map — mirrors lobKeyForPlanType() in ghl-client.ts
// ---------------------------------------------------------------------------
function lobKey(productType: string): string | null {
  switch ((productType || "").toUpperCase()) {
    case "HI":
    case "HIP":    return "hip";
    case "HHC":    return "hhc";
    case "LIFE":   return "life";
    case "DV":     return "dv";
    case "CANCER": return "cancer";
    default:       return null;
  }
}

// ---------------------------------------------------------------------------
// Resolve field IDs at runtime from /locations/{id}/customFields
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
  console.log(`[reconcile] resolved ${Object.keys(map).length} field IDs for ${locationId}`);
  return map;
}

// ---------------------------------------------------------------------------
// Build GHL contact body from current policy state
// ---------------------------------------------------------------------------
function buildContactBody(
  policy: PolicyRow,
  agentNpn: string,
  locationId: string,
  fieldIds: FieldIdMap,
  omittedFields: string[],
  agencyMap: Map<string, string>,
): Record<string, unknown> {
  const str = (v: unknown) => (v == null || v === "" || v === "0") ? "" : String(v);

  const lob          = lobKey(policy.product_type);
  const atRisk       = deriveAtRisk(policy);
  const isTerminated = (policy.contract_code || "").trim().toUpperCase() !== "A";
  const clientStatus = isTerminated ? "Terminated" : "Active";
  const atRiskStatus = atRisk ? "Yes" : "No";
  const lobTag       = lob ? `${lob} | sold client` : null;

  const customFields: Array<{ id: string; value: string }> = [];

  const push = (fieldKey: string, value: string) => {
    if (!value) return;
    const id = fieldIds[fieldKey];
    if (!id) { omittedFields.push(fieldKey); return; }
    customFields.push({ id, value });
  };

  // Resolve agency name.
  // Current path (form_submissions): policy.agency is already Title Case.
  // Future path (Max's DB): policy.agent_number = wa, policy.agency = ga_name (ALL-CAPS).
  // resolveAgencyName handles both: primary join via wa → agency_writing_numbers → agencies.name,
  // fallback to titleCase(ga_name) when no writing-number match exists.
  const resolvedAgency = resolveAgencyName(agencyMap, policy.agent_number, policy.agency);

  // Global fields
  push("contact.agent_npn",                str(agentNpn));
  push("contact.ancillary_agency__sorting", resolvedAgency);
  push("contact.middle_initial",           ""); // not yet mapped in UNL

  // LOB fields
  if (lob) {
    const p = `contact.${lob}__`;
    push(`${p}client_status`,        clientStatus);
    push(`${p}at_risk_status`,       atRiskStatus);
    push(`${p}policy_number`,        str(policy.policy_number));
    push(`${p}carrier_name`,         str(policy.carrier));
    push(`${p}plan_name`,            str(resolvePlanName(policy.plan_name)));
    push(`${p}plan_premium`,         str(policy.plan_premium));
    push(`${p}billing_mode`,         str(policy.billing_mode));
    push(`${p}submission_date`,      usDate(policy.app_submit_date));
    push(`${p}effective_date`,       usDate(policy.policy_effective_date));
    push(`${p}paid_to_date`,         usDate(policy.paid_to_date));
    push(`${p}agent_first_name`,     str(policy.agent_first_name));
    push(`${p}agent_full_name`,      [policy.agent_first_name, policy.agent_last_name].filter(Boolean).join(" "));
    push(`${p}agent_writing_number`, str(policy.agent_number));
    if (isTerminated) {
      push(`${p}terminated_reason`,  contractReasonLabel(policy.contract_reason));
      push(`${p}termination_date`,   usDate(policy.terminated_date));
    }
  }

  const tags = ["reconciled | do not automate"];
  if (lobTag) tags.push(lobTag);

  const body: Record<string, unknown> = {
    locationId,
    source: "activity-tracker-reconcile",
    tags,
    customFields,
  };

  if (str(policy.client_first_name)) body.firstName = str(policy.client_first_name);
  if (str(policy.client_last_name))  body.lastName  = str(policy.client_last_name);
  const ph = str(policy.phone);
  if (ph && ph !== "0") body.phone = ph;
  if (str(policy.email)) body.email = str(policy.email);

  return body;
}

// ---------------------------------------------------------------------------
// GHL POST with 429 retry
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
      const after = parseInt(resp.headers.get("Retry-After") ?? "10", 10);
      await new Promise(r => setTimeout(r, after * 1000));
      continue;
    }
    let data: unknown = null;
    try { data = await resp.json(); } catch { /* non-JSON */ }
    return { ok: resp.ok, status: resp.status, data };
  }
  return { ok: false, status: 429, data: "Max retries exceeded" };
}

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
  try { body = await req.json(); } catch { /* empty body */ }

  // ── Gate 1: explicit target ───────────────────────────────────────────────
  // "test" — Sunfire, spot-check or full scope, no prodConfirmed required.
  //           Use testPolicyNumbers:[...] to push a handful of policies first.
  // "prod" — Sunfire, full backfill, requires prodConfirmed:true.
  const target = (body.target as string | undefined)?.toLowerCase();
  if (target !== "test" && target !== "prod") {
    return jsonResponse({
      error: 'target must be "test" or "prod" — no default. Both target Sunfire Production.',
    }, 400);
  }

  // ── Gate 2: prod interlock ────────────────────────────────────────────────
  if (target === "prod" && body.prodConfirmed !== true) {
    return jsonResponse({
      error: 'Prod run requires { "prodConfirmed": true }. Run target="test" first to spot-check contacts and field values in Sunfire.',
    }, 400);
  }

  const dryRun = body.dryRun !== false;

  // ── Build agency map (wa → agencies.name, Title Case canonical) ──────────
  // Resolves ALL-CAPS ga_name from Max's DB to canonical title-case agency names
  // via the agency_writing_numbers join table. Built once per run.
  const agencyMap = await buildAgencyMap(supabase);

  // ── Resolve GHL creds — always Sunfire ───────────────────────────────────
  const ghlToken      = Deno.env.get("GHL_API_KEY_SUNFIRE");
  const ghlLocationId = Deno.env.get("GHL_LOCATION_ID_SUNFIRE");

  if (!ghlToken || !ghlLocationId) {
    return jsonResponse({
      error: "GHL_API_KEY_SUNFIRE or GHL_LOCATION_ID_SUNFIRE not set.",
    }, 500);
  }

  // ── Resolve field IDs (skip on dry run) ──────────────────────────────────
  let fieldIds: FieldIdMap = {};
  if (!dryRun) {
    fieldIds = await resolveFieldIds(ghlLocationId, ghlToken, apiBase);
    if (Object.keys(fieldIds).length === 0) {
      return jsonResponse({ error: "Failed to resolve Sunfire field IDs — cannot proceed" }, 500);
    }
  }

  // ── Build policy scope ────────────────────────────────────────────────────
  // test target accepts testPolicyNumbers:[...] for a spot-check without
  // pulling the full backlog. Recommended first step before prod.
  const testPolicyNumbers =
    target === "test" && Array.isArray(body.testPolicyNumbers)
      ? (body.testPolicyNumbers as string[]).filter((s) => typeof s === "string" && s.length > 0)
      : null;

  const allPolicies = new Set<string>();

  if (testPolicyNumbers && testPolicyNumbers.length > 0) {
    testPolicyNumbers.forEach((p) => allPolicies.add(p));
    console.log(`[reconcile] test spot-check: ${testPolicyNumbers.length} explicit policies`);
  } else {
    // Full scope from lifecycle_event_log — MUST paginate (40K+ rows, JS cap 1K).
    const PS = 1000;
    let psOff = 0;
    while (true) {
      const { data: logRows, error: logErr } = await supabase
        .from("lifecycle_event_log")
        .select("policy_number")
        .like("error", "%no GHL config%")
        .range(psOff, psOff + PS - 1);
      if (logErr) {
        return jsonResponse({ error: `lifecycle_event_log query failed: ${logErr.message}` }, 500);
      }
      for (const r of (logRows ?? [])) allPolicies.add((r as { policy_number: string }).policy_number);
      if (!logRows || logRows.length < PS) break;
      psOff += PS;
    }
  }

  const policyNumbers = [...allPolicies];
  console.log(`[reconcile] scope: ${policyNumbers.length} distinct policies`);

  if (policyNumbers.length === 0) {
    return jsonResponse({ ok: true, message: "No policies in scope", processed: 0 });
  }

  // ── Dry run ───────────────────────────────────────────────────────────────
  if (dryRun) {
    const note = testPolicyNumbers
      ? `Spot-check: ${testPolicyNumbers.length} explicit policies. Pass dryRun:false to push.`
      : `Full backlog: ${policyNumbers.length} policies. Consider testPolicyNumbers:[...] for a spot-check first.`;
    return jsonResponse({
      ok: true, dry_run: true, target,
      location_id: ghlLocationId,
      suppression_tag: "reconciled | do not automate",
      scope: { distinct_policies: policyNumbers.length, note },
    });
  }

  // ── Fetch current policy state from form_submissions ─────────────────────
  const COLS = [
    "policy_number", "product_type", "contract_code", "billing_form",
    "paid_to_date", "plan_name", "plan_premium", "billing_mode",
    "carrier", "app_submit_date", "policy_effective_date",
    "terminated_date", "contract_reason", "agent_number",
    "agent_first_name", "agent_last_name", "agency",
    "phone", "email", "client_first_name", "client_last_name", "status",
  ].join(",");

  const { data: policies, error: polErr } = await supabase
    .from("form_submissions")
    .select(COLS)
    .in("policy_number", policyNumbers);

  if (polErr) {
    return jsonResponse({ error: `form_submissions query failed: ${polErr.message}` }, 500);
  }

  // ── Fetch agent NPNs ──────────────────────────────────────────────────────
  const agentNumbers = [...new Set(
    (policies ?? [])
      .map((p: PolicyRow) => (p.agent_number || "").toUpperCase())
      .filter(Boolean),
  )];
  const { data: agentRows } = await supabase
    .from("agents")
    .select("writing_number, npn")
    .in("writing_number", agentNumbers);

  const npnMap = new Map<string, string>(
    (agentRows ?? []).map((a: AgentNpnRow) => [
      (a.writing_number || "").toUpperCase(),
      a.npn || "",
    ]),
  );

  const policyMap = new Map<string, PolicyRow>(
    (policies ?? []).map((p: PolicyRow) => [p.policy_number, p]),
  );

  // ── Push loop ─────────────────────────────────────────────────────────────
  const results: ReconcileResult[] = [];
  const allOmittedFields = new Set<string>();
  let batchCount = 0;
  let sampleContact: Record<string, unknown> | null = null;
  let samplePolicyNumber: string | null = null;

  for (const policyNumber of policyNumbers) {
    const policy = policyMap.get(policyNumber);

    if (!policy) {
      results.push({
        policy_number: policyNumber, ok: false, http_status: null,
        error: "Not found in form_submissions", skipped: true, skip_reason: "not_found",
      });
      continue;
    }

    const agentNpn = npnMap.get((policy.agent_number || "").toUpperCase()) ?? "";
    const omittedFields: string[] = [];
    const contactBody = buildContactBody(policy, agentNpn, ghlLocationId, fieldIds, omittedFields, agencyMap);
    omittedFields.forEach(f => allOmittedFields.add(f));

    const result = await ghlPost(`${apiBase}/contacts/`, ghlToken, contactBody);
    results.push({
      policy_number: policyNumber,
      ok: result.ok,
      http_status: result.status,
      error: result.ok ? null : `HTTP ${result.status}: ${JSON.stringify(result.data).slice(0, 200)}`,
      skipped: false,
      skip_reason: null,
    });

    if (result.ok && sampleContact === null) {
      sampleContact = contactBody;
      samplePolicyNumber = policyNumber;
    }

    batchCount++;
    if (batchCount % 80 === 0) {
      console.log(`[reconcile] batch ${batchCount} — pausing 10s`);
      await new Promise(r => setTimeout(r, 10_000));
    }
  }

  const ok_count   = results.filter(r => r.ok && !r.skipped).length;
  const fail_count = results.filter(r => !r.ok && !r.skipped).length;
  const skip_count = results.filter(r => r.skipped).length;
  const failures   = results.filter(r => !r.ok && !r.skipped).slice(0, 20);

  return jsonResponse({
    ok: fail_count === 0,
    target,
    dry_run: false,
    location_id: ghlLocationId,
    total: policyNumbers.length,
    processed: results.length,
    ok_count,
    fail_count,
    skip_count,
    omitted_field_keys: [...allOmittedFields],
    sample_policy_number: samplePolicyNumber,
    sample_contact: sampleContact,
    failures,
  });
});
