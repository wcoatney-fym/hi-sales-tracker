import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * GHL Daily Canary — validates the full lifecycle push path against
 * Sunfire Production (IQljfeWX6wWHmzUtgSyz).
 *
 * Runs daily via pg_cron at 08:30 America/Chicago. Pushes a synthetic
 * contact, reads it back to assert field IDs + casing are correct, then
 * deletes it. Logs every run to lifecycle_canary_runs. Alerts #dev-ghl on
 * any failure; silent on green.
 *
 * Field IDs are resolved at runtime via GET /locations/{id}/customFields —
 * no hardcoded IDs. If a field is renamed or added in GHL, the canary
 * automatically picks up the new ID on the next run.
 *
 * The canary contact receives the 'canary | do not automate' suppression tag
 * and is immediately deleted after assertions — zero workflow pollution.
 *
 * Required Supabase function secrets:
 *   GHL_API_KEY_HIP_PORTAL_SUNFIRE  — Private Integration token for Sunfire
 *   GHL_LOCATION_ID_SUNFIRE         — Sunfire locationId (IQljfeWX6wWHmzUtgSyz)
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — standard edge fn env
 *   GHL_API_BASE                    — defaults to https://services.leadconnectorhq.com
 *
 * The Slack alert reads the 'slack_alert_webhook' secret from Vault.
 */

// ---------------------------------------------------------------------------
// fieldKey names for runtime field ID resolution
// ---------------------------------------------------------------------------
const FIELD_KEYS = {
  AGENT_NPN:          "contact.agent_npn",
  AGENCY_SORTING:     "contact.ancillary_agency__sorting",
  MIDDLE_INITIAL:     "contact.middle_initial",
  HIP_CLIENT_STATUS:  "contact.hip__client_status",
  HIP_AT_RISK_STATUS: "contact.hip__at_risk_status",
  HIP_POLICY_NUMBER:  "contact.hip__policy_number",
  HIP_CARRIER_NAME:   "contact.hip__carrier_name",
  HIP_PLAN_NAME:      "contact.hip__plan_name",
  HIP_BILLING_MODE:   "contact.hip__billing_mode",
};

// ---------------------------------------------------------------------------
// Canary sentinel values — Title Case required; GHL workflows branch on these
// ---------------------------------------------------------------------------
const CANARY_POLICY_NUMBER = "TEST-CANARY-001";  // TEST- prefix for easy Sunfire filtering
const CANARY_NPN           = "CANARY-NPN-0000";
const CANARY_AGENCY        = "Canary Agency";    // Title Case
const CANARY_MIDDLE        = "C";
const CANARY_CARRIER       = "Unl";             // Title Case
const CANARY_PLAN          = "Uthhc";           // Title Case plan code
const CANARY_BILLING_MODE  = "Monthly";         // Title Case
const CANARY_CLIENT_STATUS = "Active";          // Title Case — GHL branches on this
const CANARY_AT_RISK       = "No";              // Title Case

// Suppression tag — GHL workflows skip contacts with this tag.
// Chris has configured the suppression condition in Sunfire (confirmed 2026-07-17).
const SUPPRESSION_TAG = "canary | do not automate";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface FieldIdMap {
  AGENT_NPN: string;
  AGENCY_SORTING: string;
  MIDDLE_INITIAL: string;
  HIP_CLIENT_STATUS: string;
  HIP_AT_RISK_STATUS: string;
  HIP_POLICY_NUMBER: string;
  HIP_CARRIER_NAME: string;
  HIP_PLAN_NAME: string;
  HIP_BILLING_MODE: string;
}

interface Assertion {
  field: string;
  expected: string;
  actual: string | undefined;
  passed: boolean;
}

interface GhlConfig {
  token: string;
  locationId: string;
  apiBase: string;
}

// ---------------------------------------------------------------------------
// Config loader
// ---------------------------------------------------------------------------
function loadConfig(): GhlConfig | null {
  try {
    const token      = Deno.env.get("GHL_API_KEY_HIP_PORTAL_SUNFIRE");
    const locationId = Deno.env.get("GHL_LOCATION_ID_SUNFIRE");
    if (!token || !locationId) return null;
    return {
      token,
      locationId,
      apiBase: Deno.env.get("GHL_API_BASE") || "https://services.leadconnectorhq.com",
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Resolve field IDs at runtime — fetched from /locations/{id}/customFields
// ---------------------------------------------------------------------------
async function resolveFieldIds(cfg: GhlConfig): Promise<FieldIdMap | null> {
  const resp = await fetch(`${cfg.apiBase}/locations/${cfg.locationId}/customFields`, {
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Version: "2021-07-28",
      Accept: "application/json",
    },
  });
  if (!resp.ok) {
    console.error(`[canary] resolveFieldIds HTTP ${resp.status}`);
    return null;
  }
  const body = await resp.json() as { customFields?: Array<{ id: string; fieldKey: string }> };
  const fields = body.customFields ?? [];
  const byKey = (key: string): string => {
    const f = fields.find((x) => x.fieldKey === key);
    if (!f) console.warn(`[canary] field not found in Sunfire: ${key}`);
    return f?.id ?? "";
  };
  const ids: FieldIdMap = {
    AGENT_NPN:          byKey(FIELD_KEYS.AGENT_NPN),
    AGENCY_SORTING:     byKey(FIELD_KEYS.AGENCY_SORTING),
    MIDDLE_INITIAL:     byKey(FIELD_KEYS.MIDDLE_INITIAL),
    HIP_CLIENT_STATUS:  byKey(FIELD_KEYS.HIP_CLIENT_STATUS),
    HIP_AT_RISK_STATUS: byKey(FIELD_KEYS.HIP_AT_RISK_STATUS),
    HIP_POLICY_NUMBER:  byKey(FIELD_KEYS.HIP_POLICY_NUMBER),
    HIP_CARRIER_NAME:   byKey(FIELD_KEYS.HIP_CARRIER_NAME),
    HIP_PLAN_NAME:      byKey(FIELD_KEYS.HIP_PLAN_NAME),
    HIP_BILLING_MODE:   byKey(FIELD_KEYS.HIP_BILLING_MODE),
  };
  const missing = Object.entries(ids).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) console.warn(`[canary] ${missing.length} field(s) not resolved: ${missing.join(", ")}`);
  return ids;
}

// ---------------------------------------------------------------------------
// GHL API helper
// ---------------------------------------------------------------------------
async function ghlRequest(
  cfg: GhlConfig,
  method: "POST" | "GET" | "DELETE",
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const resp = await fetch(`${cfg.apiBase}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Version: "2021-07-28",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: unknown = null;
  try { data = await resp.json(); } catch { /* non-JSON body */ }
  return { ok: resp.ok, status: resp.status, data };
}

// ---------------------------------------------------------------------------
// Assertion helper
// ---------------------------------------------------------------------------
function assertField(
  assertions: Assertion[],
  customFields: Array<{ id: string; value: string }>,
  fieldId: string,
  fieldName: string,
  expected: string,
): void {
  const cf = customFields.find((f) => f.id === fieldId);
  const actual = cf?.value;
  assertions.push({ field: fieldName, expected, actual, passed: actual === expected });
}

// ---------------------------------------------------------------------------
// Slack alert (best-effort, never throws)
// ---------------------------------------------------------------------------
async function sendSlackAlert(supabase: ReturnType<typeof createClient>, text: string) {
  try {
    const { data: webhook } = await supabase.rpc("get_vault_secret", {
      secret_name: "slack_alert_webhook",
    }).maybeSingle() as { data: string | null };

    let url = webhook;
    if (!url) {
      const { data: vaultRow } = await supabase
        .from("vault.decrypted_secrets")
        .select("decrypted_secret")
        .eq("name", "slack_alert_webhook")
        .maybeSingle();
      url = vaultRow?.decrypted_secret ?? null;
    }
    if (!url) { console.warn("[canary] slack_alert_webhook not in vault"); return; }

    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    console.warn("[canary] slack alert failed (non-fatal):", err);
  }
}

// ---------------------------------------------------------------------------
// Main canary run
// ---------------------------------------------------------------------------
async function runCanary(
  cfg: GhlConfig,
  supabase: ReturnType<typeof createClient>,
): Promise<{
  ok: boolean;
  steps_passed: number;
  steps_total: number;
  contact_id: string | null;
  assertions: Assertion[];
  error: string | null;
  detail: Record<string, unknown>;
}> {
  let contactId: string | null = null;
  const assertions: Assertion[] = [];
  let stepsPassed = 0;
  const stepsTotal = 4; // resolve-fields, create, read+assert, delete

  // ── Step 1: Resolve field IDs ─────────────────────────────────────────────
  const F = await resolveFieldIds(cfg);
  if (!F) {
    return {
      ok: false, steps_passed: 0, steps_total: stepsTotal,
      contact_id: null, assertions,
      error: `Field ID resolution failed — GET /locations/${cfg.locationId}/customFields returned an error`,
      detail: { locationId: cfg.locationId },
    };
  }
  stepsPassed++;
  console.log("[canary] step 1 passed — field IDs resolved:", JSON.stringify(F));

  // ── Step 2: Create canary contact ─────────────────────────────────────────
  const canaryBody = {
    locationId: cfg.locationId,
    firstName: "Diamond",
    lastName: "Canary",
    source: "activity-tracker-canary",
    tags: ["hip | sold client", SUPPRESSION_TAG],
    customFields: [
      { id: F.AGENT_NPN,         value: CANARY_NPN },
      { id: F.AGENCY_SORTING,    value: CANARY_AGENCY },
      { id: F.MIDDLE_INITIAL,    value: CANARY_MIDDLE },
      { id: F.HIP_CLIENT_STATUS, value: CANARY_CLIENT_STATUS },
      { id: F.HIP_AT_RISK_STATUS,value: CANARY_AT_RISK },
      { id: F.HIP_POLICY_NUMBER, value: CANARY_POLICY_NUMBER },
      { id: F.HIP_CARRIER_NAME,  value: CANARY_CARRIER },
      { id: F.HIP_PLAN_NAME,     value: CANARY_PLAN },
      { id: F.HIP_BILLING_MODE,  value: CANARY_BILLING_MODE },
    ].filter((cf) => cf.id),
  };

  const createResult = await ghlRequest(cfg, "POST", "/contacts/", canaryBody);
  if (!createResult.ok) {
    return {
      ok: false, steps_passed: stepsPassed, steps_total: stepsTotal,
      contact_id: null, assertions,
      error: `Step 2 (create) failed: HTTP ${createResult.status}`,
      detail: { create_status: createResult.status, create_body: createResult.data },
    };
  }
  const createData = createResult.data as Record<string, unknown>;
  contactId = (
    (createData.contact as Record<string, unknown> | undefined)?.id ?? createData.id
  ) as string | null;

  if (!contactId) {
    return {
      ok: false, steps_passed: stepsPassed, steps_total: stepsTotal,
      contact_id: null, assertions,
      error: "Step 2 (create) succeeded but no contact id in response",
      detail: { create_body: createData },
    };
  }
  stepsPassed++;
  console.log(`[canary] step 2 passed — contact created: ${contactId}`);

  // ── Step 3: Read back + location guard + assert ───────────────────────────
  // Location guard: verify the created contact is in the expected location.
  // If it landed elsewhere (routing bug, token scope issue), delete immediately
  // and alert — structurally cannot leave test debris in a wrong account.
  const readResult = await ghlRequest(cfg, "GET", `/contacts/${contactId}`);
  if (!readResult.ok) {
    await ghlRequest(cfg, "DELETE", `/contacts/${contactId}`).catch(() => {});
    return {
      ok: false, steps_passed: stepsPassed, steps_total: stepsTotal,
      contact_id: contactId, assertions,
      error: `Step 3 (read) failed: HTTP ${readResult.status}`,
      detail: { read_status: readResult.status },
    };
  }

  const readData = readResult.data as Record<string, unknown>;
  const contact  = (readData.contact ?? readData) as Record<string, unknown>;
  const actualLoc = contact.locationId as string | undefined;

  if (actualLoc !== cfg.locationId) {
    const deleteAttempt = await ghlRequest(cfg, "DELETE", `/contacts/${contactId}`).catch(() => ({}));
    const alertMsg =
      `:rotating_light: *GHL canary LOCATION MISMATCH* — ${new Date().toISOString().slice(0, 10)}\n` +
      `Expected: \`${cfg.locationId}\` (Sunfire)\n` +
      `Got:      \`${actualLoc ?? "unknown"}\`\n` +
      `Contact id: \`${contactId}\` — delete attempted: ${JSON.stringify(deleteAttempt)}\n` +
      `:warning: *Manually verify this contact was removed from GHL.*`;
    await sendSlackAlert(supabase, alertMsg);
    console.error("[canary] LOCATION MISMATCH", alertMsg);
    return {
      ok: false, steps_passed: stepsPassed, steps_total: stepsTotal,
      contact_id: contactId, assertions,
      error: `Location mismatch: expected ${cfg.locationId}, got ${actualLoc}`,
      detail: { expected: cfg.locationId, actual: actualLoc, delete_result: deleteAttempt },
    };
  }

  // Assert tags
  const tags = (contact.tags ?? []) as string[];
  assertions.push({
    field: "tag: hip | sold client", expected: "hip | sold client",
    actual: tags.includes("hip | sold client") ? "hip | sold client" : tags.join(","),
    passed: tags.includes("hip | sold client"),
  });
  assertions.push({
    field: `tag: ${SUPPRESSION_TAG}`, expected: SUPPRESSION_TAG,
    actual: tags.includes(SUPPRESSION_TAG) ? SUPPRESSION_TAG : tags.join(","),
    passed: tags.includes(SUPPRESSION_TAG),
  });

  // Assert custom fields
  const rawCfs = (contact.customFields ?? []) as Array<{ id: string; value: string }>;
  assertField(assertions, rawCfs, F.AGENT_NPN,         "agent_npn",          CANARY_NPN);
  assertField(assertions, rawCfs, F.AGENCY_SORTING,    "agency_sorting",     CANARY_AGENCY);
  assertField(assertions, rawCfs, F.MIDDLE_INITIAL,    "middle_initial",     CANARY_MIDDLE);
  assertField(assertions, rawCfs, F.HIP_CLIENT_STATUS, "hip__client_status", CANARY_CLIENT_STATUS);
  assertField(assertions, rawCfs, F.HIP_AT_RISK_STATUS,"hip__at_risk_status",CANARY_AT_RISK);
  assertField(assertions, rawCfs, F.HIP_POLICY_NUMBER, "hip__policy_number", CANARY_POLICY_NUMBER);
  assertField(assertions, rawCfs, F.HIP_CARRIER_NAME,  "hip__carrier_name",  CANARY_CARRIER);
  assertField(assertions, rawCfs, F.HIP_PLAN_NAME,     "hip__plan_name",     CANARY_PLAN);
  assertField(assertions, rawCfs, F.HIP_BILLING_MODE,  "hip__billing_mode",  CANARY_BILLING_MODE);

  const failedAssertions = assertions.filter((a) => !a.passed);
  if (failedAssertions.length === 0) {
    stepsPassed++;
    console.log(`[canary] step 3 passed — all ${assertions.length} assertions ok`);
  } else {
    console.warn(`[canary] step 3 FAILED — ${failedAssertions.length}/${assertions.length} assertions failed`);
  }

  // ── Step 4: Delete canary contact ─────────────────────────────────────────
  const deleteResult = await ghlRequest(cfg, "DELETE", `/contacts/${contactId}`);
  if (deleteResult.ok) {
    stepsPassed++;
    console.log(`[canary] step 4 passed — contact deleted`);
  } else {
    console.warn(`[canary] step 4 (delete) failed: HTTP ${deleteResult.status} — contact ${contactId} may need manual cleanup in Sunfire`);
  }

  const allPassed = failedAssertions.length === 0 && stepsPassed === stepsTotal;
  return {
    ok: allPassed,
    steps_passed: stepsPassed,
    steps_total: stepsTotal,
    contact_id: contactId,
    assertions,
    error: allPassed ? null : `${failedAssertions.length} assertion(s) failed`,
    detail: { failed_assertions: failedAssertions, delete_status: deleteResult.status },
  };
}

// ---------------------------------------------------------------------------
// Edge function handler
// ---------------------------------------------------------------------------
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const supabaseUrl    = Deno.env.get("SUPABASE_URL")!;
  const authHeader     = req.headers.get("Authorization") || "";

  if (!serviceRoleKey || !authHeader.includes(serviceRoleKey)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const runAt    = new Date().toISOString();

  const cfg = loadConfig();
  if (!cfg) {
    const errMsg =
      "GHL_API_KEY_HIP_PORTAL_SUNFIRE or GHL_LOCATION_ID_SUNFIRE not set. " +
      "Canary cannot run. Add both as Supabase function secrets.";
    console.error(`[canary] ${errMsg}`);

    await supabase.from("lifecycle_canary_runs").insert({
      run_at: runAt, ok: false, steps_passed: 0, steps_total: 4,
      contact_id: null, assertions_passed: 0, assertions_failed: 0,
      error: errMsg, detail: { config_missing: true },
    });
    await sendSlackAlert(supabase,
      `:red_circle: *GHL canary — config missing* — ${runAt.slice(0, 10)}\n` + errMsg,
    );
    return jsonResponse({ ok: false, error: errMsg }, 500);
  }

  let result;
  try {
    result = await runCanary(cfg, supabase);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    console.error("[canary] unhandled error:", errMsg);
    result = {
      ok: false, steps_passed: 0, steps_total: 4,
      contact_id: null, assertions: [], error: errMsg, detail: {},
    };
  }

  const assertionsPassed = result.assertions.filter((a) => a.passed).length;
  const assertionsFailed = result.assertions.filter((a) => !a.passed).length;

  await supabase.from("lifecycle_canary_runs").insert({
    run_at:            runAt,
    ok:                result.ok,
    steps_passed:      result.steps_passed,
    steps_total:       result.steps_total,
    contact_id:        result.contact_id,
    assertions_passed: assertionsPassed,
    assertions_failed: assertionsFailed,
    error:             result.error,
    detail:            { ...result.detail, assertions: result.assertions },
  });

  if (!result.ok) {
    const failedList = result.assertions
      .filter((a) => !a.passed)
      .map((a) => `  • \`${a.field}\`: expected \`${a.expected}\` got \`${a.actual ?? "missing"}\``)
      .join("\n");

    await sendSlackAlert(supabase,
      `:red_circle: *GHL canary FAILED* — ${runAt.slice(0, 10)}\n` +
      `Steps: ${result.steps_passed}/${result.steps_total} passed\n` +
      `Error: ${result.error ?? "none"}\n` +
      (failedList ? `Assertions:\n${failedList}\n` : "") +
      `Check Supabase edge fn logs → \`ghl-canary\` for full detail.`,
    );
    console.error("[canary] FAILED:", result.error, JSON.stringify(result.assertions));
  } else {
    // Timestamp: tz-aware America/Chicago (CT), with UTC for log correlation.
    // Never hardcode UTC offsets — DST breaks them.
    const runAtDate    = new Date(runAt);
    const ctFormatter  = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hour12: true,
    });
    const utcFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC", hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const ctTime  = ctFormatter.format(runAtDate).replace(",", "");
    const utcTime = utcFormatter.format(runAtDate);
    const dateStr = runAtDate.toLocaleDateString("en-US", {
      timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric",
    });
    const tsLabel = `${ctTime} CT (${utcTime} UTC) — ${dateStr}`;

    await sendSlackAlert(supabase,
      `:white_check_mark: *GHL canary passed* — ${tsLabel} — ` +
      `${assertionsPassed} assertions ok, ${result.steps_passed}/${result.steps_total} steps`,
    );
    console.log(`[canary] PASSED — ${assertionsPassed} assertions, ${result.steps_passed} steps`);
  }

  return jsonResponse({
    ok:                result.ok,
    run_at:            runAt,
    steps_passed:      result.steps_passed,
    steps_total:       result.steps_total,
    assertions_passed: assertionsPassed,
    assertions_failed: assertionsFailed,
    error:             result.error,
  });
});
