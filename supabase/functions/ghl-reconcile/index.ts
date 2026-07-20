import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildAgencyMap, resolveAgencyName } from "../_shared/agency-map.ts";

// ---------------------------------------------------------------------------
// ghl-reconcile — MAX'S DB MIGRATION (2026-07-20)
// Source: typed.unl_fym_policy_latest_load (Akamai/Postgres, READ-ONLY)
// ZERO form_submissions reads. ZERO writes to Max's DB.
// Field mapping per docs/migration_mock_up.md.
// ---------------------------------------------------------------------------

// ── Akamai CA cert (same as lifecycle-direct) ─────────────────────────────
const AKAMAI_CA_CERT = `-----BEGIN CERTIFICATE-----
MIIERDCCAqygAwIBAgIUXb4vh6x1XAZ4Bm1oN3eqHm27NrAwDQYJKoZIhvcNAQEM
BQAwOjE4MDYGA1UEAwwvNWY1NzgxYmMtMjc4MC00NTA0LWFhMDctNzM1NTEwZGZj
NjQ3IFByb2plY3QgQ0EwHhcNMjYwMzAzMjE0OTI1WhcNMzYwMjI5MjE0OTI1WjA6
MTgwNgYDVQQDDC81ZjU3ODFiYy0yNzgwLTQ1MDQtYWEwNy03MzU1MTBkZmM2NDcg
UHJvamVjdCBDQTCCAaIwDQYJKoZIhvcNAQEBBQADggGPADCCAYoCggGBALAYtJy6
HRMQ/o7zwygRQBu/CgjH8VycBC886/LhF2LCVqGFD2eYbKMV3LF6WEWZCUgTgrCv
9xqAiFVVXn+jNpBG3DRQ49ox9VMzNXQFqfh93ckB+noqMoPmu7ifwTZYGb+bNlhH
Ng/U5uW7tLRaIs7TerrgQwFeJAUnQ93hVaJvP/Jc5UOLJFwW0bw274SMs1GDwCSP
LeQOj9vvWRBBA3m5kdoPir+uk/QdbQBJ+iHQ/T4cdfYeRNtCtZI9aRfaEKV5plz2
vyQd3ILkU6/ztzT7r9Mb3LbklL+ujmMqih4AdBtBK+gLPMsEyAF3EHATLy41TkgE
Rch3YQn8Uy4MkHqChAKERDFF/TwXPzKfaDE1bHKOuSqM0qXNwyE8Wi5jKnIs9rHP
XB7ZbwHd757eVVFEhSy3OMmmT894PYQ85chKsre4ERNlr8gzXRXM9HPIjizMBP3z
MHOmntCDUAVQOi2TDHlEgvni2GgRCZn2QCZwXdLLdC/AYpwT51Ve1YPKRwIDAQAB
o0IwQDAdBgNVHQ4EFgQUG/smxH2AvkCafCwJVnLfH34WzE8wEgYDVR0TAQH/BAgw
BgEB/wIBADALBgNVHQ8EBAMCAQYwDQYJKoZIhvcNAQEMBQADggGBABZ8ty1UFPtX
SSCFkURXa+2ov+gC4uoxPdZ6vKPkOro9zioSUEZyqkXRPGF7b66/8pCpTiw/Diq9
mBXmsMMVbMI/dlpESp2bMDF/PnrDNktPvBrUvnck7cSGYvDVZP93VXTQVHelg5vv
zrWhQJbqldtGeqxeZV1nemfv24eVr9eQGa4QNoMujjsOh+nEkP32u8gfXsvBeGX1
tHzciVwkre0hqpz8rqENn1eN8kbOTaCm8qWgNX0yltlEDA8V/uQrtqnyRSb2do0b
eTZ4DM9RvUCaQ8tZrztSyRgnVoW7/ZWJdq7qzADC6bEejKUyPtROYk6NPxwsv25M
ND5KqqtDUjosJtwVCPLUxXz0klDYzPUdYxVw8aVqagult4nTCUVsMZtInnReG9n0
jCyoYUzCAX/IcjgVlT9qBSijaF2Ej13P5dBP2TYZc75DwyCnR7oKU0A1qyCWRn6K
P0UBeWDb0uy/qk0qlpQov19T0VA/sVT567PUPF5B82v4Xxg+yqvLRg==
-----END CERTIFICATE-----`;

// ── Helpers ───────────────────────────────────────────────────────────────

function cleanHost(raw: string): string {
  return raw.replace(/^https?:\/\//, "").replace(/\/$/, "").split(":")[0];
}

function usDate(d: unknown): string {
  if (d === null || d === undefined || d === "") return "";
  const dt = d instanceof Date ? d : new Date(String(d));
  if (isNaN(dt.getTime())) return "";
  return `${String(dt.getUTCMonth() + 1).padStart(2, "0")}/${String(dt.getUTCDate()).padStart(2, "0")}/${dt.getUTCFullYear()}`;
}

function billingModeLabel(code: number | null): string {
  switch (code) {
    case 1:  return "Monthly";
    case 3:  return "Quarterly";
    case 6:  return "Semi-Annual";
    case 12: return "Annual";
    default: return String(code ?? "");
  }
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── Plan code map (mirrors lifecycle-direct exactly) ──────────────────────
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

// ── LOB prefix from plan_code ─────────────────────────────────────────────
// Derived from plan_code (Max's DB has no product_type column).
function lobFromPlanCode(planCode: string | null): string | null {
  const k = (planCode ?? "").trim().toUpperCase();
  if (k.includes("HHC")) return "hhc";
  if (k.includes("HI") || k.includes("HIP") || k.includes("GHI")) return "hip";
  if (k.includes("CAN")) return "cancer";
  if (k.includes("DN")) return "dv";
  return null;
}

// ── Contract reason label ─────────────────────────────────────────────────
function contractReasonLabel(code: string | null): string {
  if (!code) return "";
  const map: Record<string, string> = {
    NS: "Non-Sufficient Funds", CA: "Client Requested Cancellation",
    NR: "Non-Renewal", DE: "Deceased", DB: "Duplicate Billing",
    DP: "Duplicate Policy", FR: "Fraud", IC: "Invalid Coverage",
    PA: "Policy Anniversary", RP: "Replaced Policy",
  };
  return map[code.toUpperCase()] ?? code;
}

// ── Row shape from Max's DB (READ-ONLY) ───────────────────────────────────
interface ProdRow {
  policy_nbr: string;
  first_name: string | null;
  last_name: string | null;
  phone_nbr: string | null;       // bigint cast to text in SELECT
  plan_code: string | null;
  annual_premium: number | null;
  issue_date: unknown;
  app_recvd_date: unknown;
  paid_to_date: unknown;
  term_date: unknown;
  billing_mode: number | null;
  billing_form: string | null;
  cntrct_code: string | null;
  cntrct_reason: string | null;
  at_risk_policy: boolean;
  wa: string | null;              // agent writing number
  wa_name: string | null;         // agent full name
  ga_name: string | null;         // downline agency (ALL-CAPS, resolve via agency map)
  issue_state: string | null;
  zip: string | null;
  carrier: string | null;
}

// ── Field ID map ──────────────────────────────────────────────────────────
interface FieldIdMap { [fieldKey: string]: string; }

// ── Resolve GHL field IDs at runtime ─────────────────────────────────────
async function resolveFieldIds(locationId: string, token: string, apiBase: string): Promise<FieldIdMap> {
  const resp = await fetch(`${apiBase}/locations/${locationId}/customFields`, {
    headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" },
  });
  if (!resp.ok) { console.error(`[reconcile] field ID resolution failed: HTTP ${resp.status}`); return {}; }
  const data = await resp.json() as { customFields?: Array<{ id: string; fieldKey: string }> };
  const map: FieldIdMap = {};
  for (const f of data.customFields ?? []) { if (f.fieldKey && f.id) map[f.fieldKey] = f.id; }
  console.log(`[reconcile] resolved ${Object.keys(map).length} field IDs`);
  return map;
}

// ── Build GHL contact body from Max's DB row ──────────────────────────────
function buildContactBody(
  row: ProdRow,
  agentNpn: string,
  locationId: string,
  fieldIds: FieldIdMap,
  omittedFields: string[],
  agencyMap: Map<string, string>,
): Record<string, unknown> {
  const str = (v: unknown) => (v == null || v === "") ? "" : String(v);
  const lob = lobFromPlanCode(row.plan_code);
  const isTerminated = (row.cntrct_code ?? "").trim().toUpperCase() !== "A";
  const clientStatus = isTerminated ? "Terminated" : "Active";
  const atRiskStatus = row.at_risk_policy ? "Yes" : "No";

  const customFields: Array<{ id: string; value: string }> = [];
  const push = (fieldKey: string, value: string) => {
    if (!value) return;
    const id = fieldIds[fieldKey];
    if (!id) { omittedFields.push(fieldKey); return; }
    customFields.push({ id, value });
  };

  // Global fields (per migration_mock_up.md)
  push("contact.agent_npn", str(agentNpn));
  push("contact.ancillary_agency__sorting", resolveAgencyName(agencyMap, row.wa, row.ga_name));
  push("contact.state",       str(row.issue_state));
  push("contact.postal_code", str(row.zip));

  // LOB-prefixed fields
  if (lob) {
    const p = `contact.${lob}__`;
    push(`${p}policy_number`,        str(row.policy_nbr));
    push(`${p}plan_name`,            resolvePlanName(row.plan_code));
    push(`${p}plan_premium`,         str(row.annual_premium));
    push(`${p}billing_mode`,         billingModeLabel(row.billing_mode));
    push(`${p}effective_date`,       usDate(row.issue_date));
    push(`${p}submission_date`,      usDate(row.app_recvd_date));
    push(`${p}paid_to_date`,         usDate(row.paid_to_date));
    push(`${p}client_status`,        clientStatus);
    push(`${p}at_risk_status`,       atRiskStatus);
    push(`${p}agent_writing_number`, str(row.wa));
    push(`${p}agent_full_name`,      str(row.wa_name));
    push(`${p}agent_first_name`,     str((row.wa_name ?? "").split(/\s+/)[0]));
    push(`${p}carrier_name`,         str(row.carrier));
    if (isTerminated) {
      push(`${p}termination_date`,   usDate(row.term_date));
      push(`${p}terminated_reason`,  contractReasonLabel(row.cntrct_reason));
    }
  }

  const tags = ["reconciled | do not automate"];
  if (lob) tags.push(`${lob} | sold client`);

  const body: Record<string, unknown> = { locationId, source: "activity-tracker-reconcile", tags, customFields };
  if (str(row.first_name))  body.firstName = str(row.first_name);
  if (str(row.last_name))   body.lastName  = str(row.last_name);
  const ph = str(row.phone_nbr);
  if (ph && ph !== "0") body.phone = ph;
  return body;
}

// ── GHL POST with 429 retry + 80-req/10s rate limit ─────────────────────
async function ghlPost(url: string, token: string, body: unknown): Promise<{ ok: boolean; status: number; data: unknown }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", "Content-Type": "application/json", Accept: "application/json" },
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

// ── Main handler ──────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // Auth
  const supabaseUrl    = Deno.env.get("ACTIVITY_TRACKER_SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("ACTIVITY_TRACKER_SERVICE_ROLE_KEY") ?? "";
  const authHeader     = req.headers.get("Authorization") ?? "";
  if (!serviceRoleKey || !authHeader.includes(serviceRoleKey)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const apiBase  = Deno.env.get("GHL_API_BASE") ?? "https://services.leadconnectorhq.com";

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }

  // Gate 1: explicit target
  const target = (body.target as string | undefined)?.toLowerCase();
  if (target !== "test" && target !== "prod") {
    return jsonResponse({ error: 'target must be "test" or "prod".' }, 400);
  }
  // Gate 2: prod interlock
  if (target === "prod" && body.prodConfirmed !== true) {
    return jsonResponse({ error: 'Prod run requires { "prodConfirmed": true }.' }, 400);
  }

  const dryRun = body.dryRun !== false;

  // GHL creds — always Sunfire
  const ghlToken      = Deno.env.get("GHL_API_KEY_SUNFIRE");
  const ghlLocationId = Deno.env.get("GHL_LOCATION_ID_SUNFIRE");
  if (!ghlToken || !ghlLocationId) {
    return jsonResponse({ error: "GHL_API_KEY_SUNFIRE or GHL_LOCATION_ID_SUNFIRE not set." }, 500);
  }

  // Agency map (wa → canonical agency name)
  const agencyMap = await buildAgencyMap(supabase);

  // Field IDs (skip on dry run)
  let fieldIds: FieldIdMap = {};
  if (!dryRun) {
    fieldIds = await resolveFieldIds(ghlLocationId, ghlToken, apiBase);
    if (Object.keys(fieldIds).length === 0) {
      return jsonResponse({ error: "Failed to resolve Sunfire field IDs." }, 500);
    }
  }

  // ── Build policy scope from lifecycle_event_log ───────────────────────
  const testPolicyNumbers =
    target === "test" && Array.isArray(body.testPolicyNumbers)
      ? (body.testPolicyNumbers as string[]).filter((s) => typeof s === "string" && s.length > 0)
      : null;

  const allPolicies = new Set<string>();
  if (testPolicyNumbers && testPolicyNumbers.length > 0) {
    testPolicyNumbers.forEach((p) => allPolicies.add(p));
  } else {
    // Paginate — lifecycle_event_log can exceed 1K rows
    const PS = 1000; let psOff = 0;
    while (true) {
      const { data: logRows, error: logErr } = await supabase
        .from("lifecycle_event_log")
        .select("policy_number")
        .like("error", "%no GHL config%")
        .range(psOff, psOff + PS - 1);
      if (logErr) return jsonResponse({ error: `lifecycle_event_log query failed: ${logErr.message}` }, 500);
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

  // Dry run — return scope summary only
  if (dryRun) {
    return jsonResponse({
      ok: true, dry_run: true, target, location_id: ghlLocationId,
      suppression_tag: "reconciled | do not automate",
      scope: { distinct_policies: policyNumbers.length },
    });
  }

  // ── STUB: Max's DB query will be added in next increment ─────────────
  // TODO: open postgres connection via PROD_DB_* and SELECT from
  //       typed.unl_fym_policy_latest_load WHERE policy_nbr = ANY($1)
  return jsonResponse({ ok: false, error: "STUB — Max DB query not yet implemented" }, 501);
});
