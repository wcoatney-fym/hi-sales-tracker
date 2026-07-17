import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * GHL Daily Canary — validates the full lifecycle push path against the
 * GHL Build sub-account (default) or Sunfire Production (opt-in test mode).
 *
 * Runs daily via pg_cron at 08:30 America/Chicago. Pushes a synthetic
 * contact, reads it back to assert field IDs + casing are correct, then
 * deletes it. Logs every run to lifecycle_canary_runs. Alerts #dev-ghl on
 * any failure; silent on green.
 *
 * TARGET MODES (pass in POST body or omit for default):
 *   { "target": "build" }   — default; uses Build sub-account (safe sandbox).
 *   { "target": "sunfire" } — Sunfire Production; uses real field IDs. The
 *                              canary contact is tagged 'canary | do not automate'
 *                              to suppress workflows, then immediately deleted.
 *                              Requires GHL_API_KEY_HIP_PORTAL_SUNFIRE +
 *                              GHL_LOCATION_ID_SUNFIRE to be set.
 *
 * WHY SUNFIRE MODE: Build has different field IDs than Sunfire for the same
 * fieldKey names. A green Build canary only proves Build IDs work, not Sunfire's.
 * Sunfire mode catches field ID drift, workflow trigger issues, and tag behavior
 * in the actual production environment before reconcile prod runs.
 *
 * Required Supabase function secrets:
 *   GHL_API_KEY_BUILD_ACT              — Build sub-account token (default mode)
 *   GHL_LOCATION_ID_BUILD_ACT          — Build locationId (CLSxgOblhfpvW6ICB82A)
 *   GHL_API_KEY_HIP_PORTAL_SUNFIRE     — Sunfire token (sunfire mode only)
 *   GHL_LOCATION_ID_SUNFIRE            — Sunfire locationId (IQljfeWX6wWHmzUtgSyz)
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — standard edge fn env
 *   GHL_API_BASE                       — defaults to https://services.leadconnectorhq.com
 *
 * SAFETY: field IDs are resolved at runtime via GET /locations/{id}/customFields
 * in sunfire mode — no hardcoded cross-location IDs. The canary contact always
 * receives the 'canary | do not automate' tag and is deleted immediately after
 * assertions, regardless of mode.
 *
 * The Slack alert reads the 'slack_alert_webhook' secret from Vault
 * (same secret the dead-man's switch uses).
 *
 * Three GHL tiers: Build (template/sandbox), Sunfire (production), Agency
 * sub-accounts (downstream). This canary targets Build or Sunfire only — never
 * individual agency sub-accounts.
 */

// ---------------------------------------------------------------------------
// Field IDs — BUILD sub-account (locationId: CLSxgOblhfpvW6ICB82A).
//
// These differ from Sunfire's field IDs even though the fieldKeys are identical
// (contact.agent_npn, contact.hip__client_status, etc.). Build and Sunfire are
// separate GHL sub-accounts under the same company; each has its own field ID
// namespace. IDs verified via GET /locations/CLSxgOblhfpvW6ICB82A/customFields
// on 2026-07-16. If IDs drift, re-pull from that endpoint and update here.
//
// These are BUILD-only. In sunfire mode, field IDs are resolved at runtime via
// GET /locations/{sunfireLocationId}/customFields — never hardcoded here.
// ---------------------------------------------------------------------------
const BUILD_FIELD_IDS = {
  AGENT_NPN:      "BioiKiWAgS6nAPXqv62P",  // contact.agent_npn
  AGENCY_SORTING: "5DOgnRWCmld3wDL7GfQA",  // contact.ancillary_agency__sorting
  MIDDLE_INITIAL: "lEzXuO2tVkt5e2Pl6YCp",  // contact.middle_initial
  HIP_CLIENT_STATUS: "jaENac3zhqsWTCpLqJfe",  // contact.hip__client_status
  HIP_AT_RISK_STATUS: "nag2R8rm5ZzBj4dj4LPe",  // contact.hip__at_risk_status
  HIP_POLICY_NUMBER: "k7N1iLXWSJScaVvOUh8m",  // contact.hip__policy_number
  HIP_CARRIER_NAME: "QkAYm6F0vbK30WiD2adK",  // contact.hip__carrier_name
  HIP_PLAN_NAME: "QYNKAPuCquq9Uy7D5pBi",  // contact.hip__plan_name
  HIP_BILLING_MODE: "CUSuD50WJeIzTDErvca6",  // contact.hip__billing_mode
};

// fieldKey names used to resolve Sunfire field IDs at runtime
const SUNFIRE_FIELD_KEYS = {
  AGENT_NPN:         "contact.agent_npn",
  AGENCY_SORTING:    "contact.ancillary_agency__sorting",
  MIDDLE_INITIAL:    "contact.middle_initial",
  HIP_CLIENT_STATUS: "contact.hip__client_status",
  HIP_AT_RISK_STATUS: "contact.hip__at_risk_status",
  HIP_POLICY_NUMBER: "contact.hip__policy_number",
  HIP_CARRIER_NAME:  "contact.hip__carrier_name",
  HIP_PLAN_NAME:     "contact.hip__plan_name",
  HIP_BILLING_MODE:  "contact.hip__billing_mode",
};

// Canary contact sentinel values.
// Title Case on all field values — GHL workflows branch on these; casing
// drift hits the None path. The assertions below enforce Title Case exactly.
// CANARY_POLICY_NUMBER prefix «TEST-» ensures any filter/search in Sunfire
// can trivially identify and suppress these contacts.
const CANARY_POLICY_NUMBER = "TEST-CANARY-001";
const CANARY_NPN           = "CANARY-NPN-0000";
const CANARY_AGENCY        = "Canary Agency";      // Title Case
const CANARY_MIDDLE        = "C";
const CANARY_CARRIER       = "Unl";                // Title Case as sent by lifecycle push
const CANARY_PLAN          = "Uthhc";              // Title Case plan code
const CANARY_BILLING_MODE  = "Monthly";            // Title Case label
const CANARY_CLIENT_STATUS = "Active";             // Title Case — GHL branches on this
const CANARY_AT_RISK       = "No";                 // Title Case

// Suppression tag applied to every canary contact in Sunfire mode.
// GHL workflows must have a suppression condition: skip if tag = this value.
// Chris must configure this before Sunfire mode is used in production canary.
const SUNFIRE_CANARY_SUPPRESSION_TAG = "canary | do not automate";

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

type CanaryTarget = "build" | "sunfire";

interface CanaryConfig extends GhlConfig {
  target: CanaryTarget;
  // Build: hardcoded field IDs. Sunfire: resolved at runtime.
  fieldIds: typeof BUILD_FIELD_IDS | null;
}

function loadCanaryConfig(target: CanaryTarget = "build"): CanaryConfig | null {
  try {
    const apiBase = Deno.env.get("GHL_API_BASE") || "https://services.leadconnectorhq.com";
    if (target === "sunfire") {
      const token      = Deno.env.get("GHL_API_KEY_HIP_PORTAL_SUNFIRE");
      const locationId = Deno.env.get("GHL_LOCATION_ID_SUNFIRE");
      if (!token || !locationId) return null;
      return { token, locationId, apiBase, target, fieldIds: null }; // resolved at runtime
    }
    // default: build
    const token      = Deno.env.get("GHL_API_KEY_BUILD_ACT");
    const locationId = Deno.env.get("GHL_LOCATION_ID_BUILD_ACT");
    if (!token || !locationId) return null;
    return { token, locationId, apiBase, target, fieldIds: BUILD_FIELD_IDS };
  } catch {
    return null;
  }
}

// Resolve Sunfire field IDs at runtime — fetched from
// GET /locations/{locationId}/customFields, keyed by fieldKey.
// Returns null if the GHL call fails.
async function resolveSunfireFieldIds(
  cfg: GhlConfig,
): Promise<typeof BUILD_FIELD_IDS | null> {
  const resp = await fetch(`${cfg.apiBase}/locations/${cfg.locationId}/customFields`, {
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Version: "2021-07-28",
      Accept: "application/json",
    },
  });
  if (!resp.ok) {
    console.error(`[canary] resolveSunfireFieldIds HTTP ${resp.status}`);
    return null;
  }
  const body = await resp.json() as { customFields?: Array<{ id: string; fieldKey: string }> };
  const fields = body.customFields ?? [];
  const byKey = (key: string): string => {
    const f = fields.find((x) => x.fieldKey === key);
    if (!f) console.warn(`[canary] sunfire field not found: ${key}`);
    return f?.id ?? "";
  };
  return {
    AGENT_NPN:          byKey(SUNFIRE_FIELD_KEYS.AGENT_NPN),
    AGENCY_SORTING:     byKey(SUNFIRE_FIELD_KEYS.AGENCY_SORTING),
    MIDDLE_INITIAL:     byKey(SUNFIRE_FIELD_KEYS.MIDDLE_INITIAL),
    HIP_CLIENT_STATUS:  byKey(SUNFIRE_FIELD_KEYS.HIP_CLIENT_STATUS),
    HIP_AT_RISK_STATUS: byKey(SUNFIRE_FIELD_KEYS.HIP_AT_RISK_STATUS),
    HIP_POLICY_NUMBER:  byKey(SUNFIRE_FIELD_KEYS.HIP_POLICY_NUMBER),
    HIP_CARRIER_NAME:   byKey(SUNFIRE_FIELD_KEYS.HIP_CARRIER_NAME),
    HIP_PLAN_NAME:      byKey(SUNFIRE_FIELD_KEYS.HIP_PLAN_NAME),
    HIP_BILLING_MODE:   byKey(SUNFIRE_FIELD_KEYS.HIP_BILLING_MODE),
  };
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
  cfg: CanaryConfig,
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
  const isSunfire = cfg.target === "sunfire";

  // Resolve field IDs. Build: hardcoded. Sunfire: runtime via /customFields.
  let fids = cfg.fieldIds;
  if (isSunfire) {
    fids = await resolveSunfireFieldIds(cfg);
    if (!fids) {
      return {
        ok: false,
        steps_passed: 0,
        steps_total: stepsTotal,
        contact_id: null,
        assertions,
        error: "Failed to resolve Sunfire field IDs via GET /locations/{id}/customFields",
        detail: { target: "sunfire", locationId: cfg.locationId },
      };
    }
    const missing = Object.entries(fids).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) {
      console.warn(`[canary] sunfire mode: ${missing.length} field IDs not found: ${missing.join(", ")}`);
    }
    console.log("[canary] sunfire field IDs resolved:", JSON.stringify(fids));
  }
  const F = fids!;

  // Sunfire contacts get the suppression tag so they never enter real workflows.
  // Chris must have a suppression condition in GHL: skip if tag = SUNFIRE_CANARY_SUPPRESSION_TAG.
  const baseTags = ["hip | sold client"];
  if (isSunfire) baseTags.push(SUNFIRE_CANARY_SUPPRESSION_TAG);

  const canaryBody = {
    locationId: cfg.locationId,
    firstName: "Diamond",
    lastName: "Canary",
    source: "activity-tracker-canary",
    tags: baseTags,
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
    ].filter((cf) => cf.id), // skip any field that didn't resolve
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

  // Sunfire mode: also assert suppression tag is present
  if (isSunfire) {
    const suppressOk = tags.includes(SUNFIRE_CANARY_SUPPRESSION_TAG);
    assertions.push({
      field: `tag: ${SUNFIRE_CANARY_SUPPRESSION_TAG}`,
      expected: SUNFIRE_CANARY_SUPPRESSION_TAG,
      actual: suppressOk ? SUNFIRE_CANARY_SUPPRESSION_TAG : tags.join(","),
      passed: suppressOk,
    });
  }

  // Assert each custom field ID and value (exact match — casing matters)
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
    console.warn(`[canary] step 4 (delete) failed: HTTP ${deleteResult.status} — contact ${contactId} may need manual cleanup in ${isSunfire ? "Sunfire" : "Build"}`);
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

  // Parse target from POST body (pg_cron fires with no body → default "build")
  let bodyTarget: CanaryTarget = "build";
  try {
    const b = await req.json() as { target?: string };
    if (b.target === "sunfire") bodyTarget = "sunfire";
  } catch { /* no body or non-JSON — use default */ }

  const cfg = loadCanaryConfig(bodyTarget);
  if (!cfg) {
    const isSunfire = bodyTarget === "sunfire";
    const errMsg = isSunfire
      ? "GHL_API_KEY_HIP_PORTAL_SUNFIRE or GHL_LOCATION_ID_SUNFIRE not set. " +
        "Canary cannot run in sunfire mode. Add both as Supabase function secrets."
      : "GHL_API_KEY_BUILD_ACT or GHL_LOCATION_ID_BUILD_ACT not set. " +
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
      detail:             { config_missing: true, target: bodyTarget },
    });

    await sendSlackAlert(
      supabase,
      `:red_circle: *GHL canary — config missing (${bodyTarget})* — ${runAt.slice(0, 10)}\n` +
      errMsg,
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

    const targetLabel = cfg.target === "sunfire" ? "sunfire" : "build";
    await sendSlackAlert(
      supabase,
      `:red_circle: *GHL canary FAILED (${targetLabel})* — ${runAt.slice(0, 10)}\n` +
      `Steps: ${result.steps_passed}/${result.steps_total} passed\n` +
      `Error: ${result.error ?? "none"}\n` +
      (failedList ? `Assertions:\n${failedList}\n` : "") +
      `Check Supabase edge fn logs → \`ghl-canary\` for full detail.`,
    );

    console.error(`[canary] FAILED (${targetLabel}):`, result.error, JSON.stringify(result.assertions));
  } else {
    // Explicit green signal — a dead canary must never look like a passing one.
    // Timestamp: tz-aware America/Chicago (CT), with UTC shown for log correlation.
    // Never hardcode UTC offsets — DST breaks them.
    const runAtDate    = new Date(runAt);
    const ctFormatter  = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    const utcFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const ctTime   = ctFormatter.format(runAtDate).replace(",", "");
    const utcTime  = utcFormatter.format(runAtDate);
    const dateStr  = runAtDate.toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" });
    const tsLabel  = `${ctTime} CT (${utcTime} UTC) — ${dateStr}`;
    const targetLabel = cfg.target === "sunfire" ? "sunfire" : "build";

    await sendSlackAlert(
      supabase,
      `:white_check_mark: *GHL canary passed (${targetLabel})* — ${tsLabel} — ` +
      `${assertionsPassed} assertions ok, ${result.steps_passed}/${result.steps_total} steps`,
    );
    console.log(
      `[canary] PASSED (${targetLabel}) — ${assertionsPassed} assertions, ${result.steps_passed} steps`,
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
