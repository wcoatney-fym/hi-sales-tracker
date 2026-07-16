import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * GHL Daily Canary — validates the full lifecycle push path against the
 * GHL Sunfire BUILD location (never Production).
 *
 * Runs daily via pg_cron at 08:30 America/Chicago. Pushes a synthetic
 * contact, reads it back to assert field IDs + casing are correct, then
 * deletes it. Logs every run to lifecycle_canary_runs. Alerts #dev-ghl on
 * any failure; silent on green.
 *
 * Required Supabase function secrets:
 *   GHL_API_KEY_BUILD_ACT         — Private Integration token for the Build
 *                                    template sub-account (NOT the Sunfire token)
 *   GHL_LOCATION_ID_BUILD_ACT     — Build template sub-account location ID
 *                                    (CLSxgOblhfpvW6ICB82A). NOT production.
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — standard edge fn env
 *   GHL_API_BASE                  — defaults to https://services.leadconnectorhq.com
 *
 * The Slack alert reads the 'slack_alert_webhook' secret from Vault
 * (same secret the dead-man's switch uses).
 *
 * NEVER point this at Sunfire Production. The Build sub-account is the safety
 * boundary — all canary contacts are created and immediately deleted there.
 * Three GHL tiers: Build (template/sandbox), Sunfire (production), Agency
 * sub-accounts (downstream). This canary targets Build only.
 */

// ---------------------------------------------------------------------------
// Field IDs — copied from ghl-client.ts. Keep in sync if IDs are refreshed.
// These are exactly what the canary asserts on readback so any drift surfaces
// immediately. If a field ID changes in ghl-client.ts, update here too.
// ---------------------------------------------------------------------------
const AGENT_NPN_FIELD_ID      = "uEFOApsD4JKXsXH3T9E4";
const AGENCY_SORTING_FIELD_ID = "qSHUIp3GfPWHRGbPh1CM";
const MIDDLE_INITIAL_FIELD_ID = "9a1uz6fFK8x1kaZcNbFd";

// HIP LOB field IDs — the 6 exercised by the canary (covers global path +
// the most assertion-rich LOB fields: status, risk, policy number, carrier).
const HIP_CLIENT_STATUS_ID    = "GnUA91j0Yj1PXH7CPtT4";
const HIP_AT_RISK_STATUS_ID   = "AHDJArHPmAzZ6IMaIcxw";
const HIP_POLICY_NUMBER_ID    = "O7MjvGP1J6PRGhjdwjhj";
const HIP_CARRIER_NAME_ID     = "ujIt1GLYAbrspZ2XgXQy";
const HIP_PLAN_NAME_ID        = "0wkHYd9Jfr1mtttt56kf";
const HIP_BILLING_MODE_ID     = "cB6DQmu1gbSY7piS5Wb1";

// Canary contact sentinel values.
// Title Case on all field values — GHL workflows branch on these; casing
// drift hits the None path. The assertions below enforce Title Case exactly.
const CANARY_POLICY_NUMBER = "CANARY-TEST-001";
const CANARY_NPN           = "CANARY-NPN-0000";
const CANARY_AGENCY        = "Canary Agency";      // Title Case
const CANARY_MIDDLE        = "C";
const CANARY_CARRIER       = "Unl";                // Title Case as sent by lifecycle push
const CANARY_PLAN          = "Uthhc";              // Title Case plan code
const CANARY_BILLING_MODE  = "Monthly";            // Title Case label
const CANARY_CLIENT_STATUS = "Active";             // Title Case — GHL branches on this
const CANARY_AT_RISK       = "No";                 // Title Case

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------
interface Assertion {
  field: string;
  expected: string;
  actual: string | undefined;
  passed: boolean;
}

function assertField(
  assertions: Assertion[],
  contactCustomFields: Array<{ id: string; value: string }>,
  fieldId: string,
  fieldName: string,
  expected: string,
): boolean {
  const cf = contactCustomFields.find((f) => f.id === fieldId);
  const actual = cf?.value;
  const passed = actual === expected;
  assertions.push({ field: fieldName, expected, actual, passed });
  return passed;
}

// ---------------------------------------------------------------------------
// GHL API helpers
// ---------------------------------------------------------------------------
interface GhlConfig {
  token: string;
  locationId: string;
  apiBase: string;
}

function loadCanaryConfig(): GhlConfig | null {
  try {
    const token      = Deno.env.get("GHL_API_KEY_BUILD_ACT");
    const locationId = Deno.env.get("GHL_LOCATION_ID_BUILD_ACT");
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
// Slack alert (best-effort, never throws)
// ---------------------------------------------------------------------------
async function sendSlackAlert(supabase: ReturnType<typeof createClient>, text: string) {
  try {
    const { data: webhook } = await supabase.rpc("get_vault_secret", {
      secret_name: "slack_alert_webhook",
    }).maybeSingle() as { data: string | null };

    // Fallback: try the vault directly if RPC isn't available
    let url = webhook;
    if (!url) {
      const { data: vaultRow } = await supabase
        .from("vault.decrypted_secrets")
        .select("decrypted_secret")
        .eq("name", "slack_alert_webhook")
        .maybeSingle();
      url = vaultRow?.decrypted_secret ?? null;
    }

    if (!url) {
      console.warn("[canary] slack_alert_webhook not found in vault; alert not sent");
      return;
    }

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
  const stepsTotal = 4; // create, read+location-guard, assert, delete

  const canaryBody = {
    locationId: cfg.locationId,
    firstName: "Diamond",
    lastName: "Canary",
    source: "activity-tracker-canary",
    tags: ["hip | sold client"],
    customFields: [
      { id: AGENT_NPN_FIELD_ID,      value: CANARY_NPN },
      { id: AGENCY_SORTING_FIELD_ID, value: CANARY_AGENCY },
      { id: MIDDLE_INITIAL_FIELD_ID, value: CANARY_MIDDLE },
      { id: HIP_CLIENT_STATUS_ID,    value: CANARY_CLIENT_STATUS },
      { id: HIP_AT_RISK_STATUS_ID,   value: CANARY_AT_RISK },
      { id: HIP_POLICY_NUMBER_ID,    value: CANARY_POLICY_NUMBER },
      { id: HIP_CARRIER_NAME_ID,     value: CANARY_CARRIER },
      { id: HIP_PLAN_NAME_ID,        value: CANARY_PLAN },
      { id: HIP_BILLING_MODE_ID,     value: CANARY_BILLING_MODE },
    ],
  };

  // ── Step 1: Create contact ────────────────────────────────────────────────
  const createResult = await ghlRequest(cfg, "POST", "/contacts/", canaryBody);
  if (!createResult.ok) {
    return {
      ok: false,
      steps_passed: stepsPassed,
      steps_total: stepsTotal,
      contact_id: null,
      assertions,
      error: `Step 1 (create) failed: HTTP ${createResult.status}`,
      detail: { create_status: createResult.status, create_body: createResult.data },
    };
  }
  const createData = createResult.data as Record<string, unknown>;
  contactId = (
    (createData.contact as Record<string, unknown> | undefined)?.id ??
    createData.id
  ) as string | null;

  if (!contactId) {
    return {
      ok: false,
      steps_passed: stepsPassed,
      steps_total: stepsTotal,
      contact_id: null,
      assertions,
      error: "Step 1 (create) succeeded but no contact id in response",
      detail: { create_body: createData },
    };
  }
  stepsPassed++;
  console.log(`[canary] step 1 passed — contact created: ${contactId}`);

  // ── Step 2: Read contact back + HARD location guard ─────────────────────
  // Structural safety: even if the POST somehow landed in the wrong location
  // (token scoped to multiple locations, GHL routing bug, etc.), we verify the
  // returned contact.locationId === GHL_LOCATION_ID_SUNFIRE_BUILD before doing
  // anything else. If it doesn't match: DELETE immediately, alert loud, abort.
  // This makes the canary structurally incapable of leaving debris in Production.
  const readResult = await ghlRequest(cfg, "GET", `/contacts/${contactId}`);
  if (!readResult.ok) {
    // Best-effort delete even if read fails
    await ghlRequest(cfg, "DELETE", `/contacts/${contactId}`).catch(() => {});
    return {
      ok: false,
      steps_passed: stepsPassed,
      steps_total: stepsTotal,
      contact_id: contactId,
      assertions,
      error: `Step 2 (read) failed: HTTP ${readResult.status}`,
      detail: { read_status: readResult.status, read_body: readResult.data },
    };
  }

  // Location guard — must pass before any other work on this contact
  const readData2   = readResult.data as Record<string, unknown>;
  const contact2    = (readData2.contact ?? readData2) as Record<string, unknown>;
  const actualLoc   = contact2.locationId as string | undefined;
  if (actualLoc !== cfg.locationId) {
    // Wrong location — delete immediately and alert; never leave canary debris in Production
    const deleteAttempt = await ghlRequest(cfg, "DELETE", `/contacts/${contactId}`).catch(() => ({}));
    const alertMsg =
      `:rotating_light: *GHL canary LOCATION MISMATCH — possible Production contact created* ` +
      `— ${runAt.slice(0, 10)}\n` +
      `Expected locationId: \`${cfg.locationId}\` (Build)\n` +
      `Actual locationId:   \`${actualLoc ?? "unknown"}\`\n` +
      `Contact id: \`${contactId}\`\n` +
      `Delete attempted: ${JSON.stringify(deleteAttempt)}\n` +
      `:warning: *Manually verify this contact was removed from Production GHL.*`;
    await sendSlackAlert(supabase, alertMsg);
    console.error("[canary] LOCATION MISMATCH", alertMsg);
    return {
      ok: false,
      steps_passed: stepsPassed,
      steps_total: stepsTotal,
      contact_id: contactId,
      assertions,
      error: `Location mismatch: expected ${cfg.locationId}, got ${actualLoc}`,
      detail: { expected_location: cfg.locationId, actual_location: actualLoc, delete_result: deleteAttempt },
    };
  }

  stepsPassed++;
  console.log(`[canary] step 2 passed — contact read back, locationId verified: ${actualLoc}`);

  // ── Step 3: Assert field IDs + values ─────────────────────────────────────
  const readData    = readResult.data as Record<string, unknown>;
  const contact     = (readData.contact ?? readData) as Record<string, unknown>;
  const rawCfs      = (contact.customFields ?? []) as Array<{ id: string; value: string }>;

  // Assert tag is present
  const tags = (contact.tags ?? []) as string[];
  const tagOk = tags.includes("hip | sold client");
  assertions.push({
    field: "tag: hip | sold client",
    expected: "hip | sold client",
    actual: tagOk ? "hip | sold client" : tags.join(","),
    passed: tagOk,
  });

  // Assert each custom field ID and value (exact match — casing matters)
  assertField(assertions, rawCfs, AGENT_NPN_FIELD_ID,      "agent_npn",             CANARY_NPN);
  assertField(assertions, rawCfs, AGENCY_SORTING_FIELD_ID, "agency_sorting",         CANARY_AGENCY);
  assertField(assertions, rawCfs, MIDDLE_INITIAL_FIELD_ID, "middle_initial",         CANARY_MIDDLE);
  assertField(assertions, rawCfs, HIP_CLIENT_STATUS_ID,    "hip__client_status",     CANARY_CLIENT_STATUS);
  assertField(assertions, rawCfs, HIP_AT_RISK_STATUS_ID,   "hip__at_risk_status",    CANARY_AT_RISK);
  assertField(assertions, rawCfs, HIP_POLICY_NUMBER_ID,    "hip__policy_number",     CANARY_POLICY_NUMBER);
  assertField(assertions, rawCfs, HIP_CARRIER_NAME_ID,     "hip__carrier_name",      CANARY_CARRIER);
  assertField(assertions, rawCfs, HIP_PLAN_NAME_ID,        "hip__plan_name",         CANARY_PLAN);
  assertField(assertions, rawCfs, HIP_BILLING_MODE_ID,     "hip__billing_mode",      CANARY_BILLING_MODE);

  const failedAssertions = assertions.filter((a) => !a.passed);
  if (failedAssertions.length === 0) {
    stepsPassed++;
    console.log(`[canary] step 3 passed — all ${assertions.length} assertions ok`);
  } else {
    console.warn(`[canary] step 3 FAILED — ${failedAssertions.length}/${assertions.length} assertions failed:`,
      JSON.stringify(failedAssertions));
  }

  // ── Step 4: Delete canary contact ─────────────────────────────────────────
  const deleteResult = await ghlRequest(cfg, "DELETE", `/contacts/${contactId}`);
  if (deleteResult.ok) {
    stepsPassed++;
    console.log(`[canary] step 4 passed — contact deleted`);
  } else {
    // Non-fatal: log but don't fail the canary over a cleanup issue
    console.warn(`[canary] step 4 (delete) failed: HTTP ${deleteResult.status} — contact ${contactId} may need manual cleanup in Build`);
  }

  const allPassed = failedAssertions.length === 0 && stepsPassed === stepsTotal;
  return {
    ok: allPassed,
    steps_passed: stepsPassed,
    steps_total: stepsTotal,
    contact_id: contactId,
    assertions,
    error: allPassed ? null : `${failedAssertions.length} assertion(s) failed`,
    detail: {
      failed_assertions: failedAssertions,
      delete_status: deleteResult.status,
    },
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

  const cfg = loadCanaryConfig();
  if (!cfg) {
    const errMsg =
      "GHL_API_KEY_BUILD_ACT or GHL_LOCATION_ID_BUILD_ACT not set. " +
      "Canary cannot run. Add both as Supabase function secrets (Build sub-account credentials).";
    console.error(`[canary] ${errMsg}`);

    await supabase.from("lifecycle_canary_runs").insert({
      run_at:             runAt,
      ok:                 false,
      steps_passed:       0,
      steps_total:        4,
      contact_id:         null,
      assertions_passed:  0,
      assertions_failed:  0,
      error:              errMsg,
      detail:             { config_missing: true },
    });

    await sendSlackAlert(
      supabase,
      `:red_circle: *GHL canary — config missing* — ${runAt.slice(0, 10)}\n` +
      `\`GHL_API_KEY_BUILD_ACT\` or \`GHL_LOCATION_ID_BUILD_ACT\` not set. ` +
      `Canary cannot run. Add both as Supabase function secrets (Build sub-account credentials).`,
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
      ok: false,
      steps_passed: 0,
      steps_total: 4,
      contact_id: null,
      assertions: [],
      error: errMsg,
      detail: {},
    };
  }

  const assertionsPassed = result.assertions.filter((a) => a.passed).length;
  const assertionsFailed = result.assertions.filter((a) => !a.passed).length;

  // Persist run record
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

    await sendSlackAlert(
      supabase,
      `:red_circle: *GHL canary FAILED* — ${runAt.slice(0, 10)}\n` +
      `Steps: ${result.steps_passed}/${result.steps_total} passed\n` +
      `Error: ${result.error ?? "none"}\n` +
      (failedList ? `Assertions:\n${failedList}\n` : "") +
      `Check Supabase edge fn logs → \`ghl-canary\` for full detail.`,
    );

    console.error("[canary] FAILED:", result.error, JSON.stringify(result.assertions));
  } else {
    // Explicit green signal — a dead canary must never look like a passing one.
    await sendSlackAlert(
      supabase,
      `:white_check_mark: *GHL canary passed* — ${runAt.slice(0, 10)} — ` +
      `${assertionsPassed} assertions ok, ${result.steps_passed}/${result.steps_total} steps`,
    );
    console.log(
      `[canary] PASSED — ${assertionsPassed} assertions, ${result.steps_passed} steps`,
    );
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
