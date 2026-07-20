import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildAgencyMap, resolveAgencyName, titleCase } from "../_shared/agency-map.ts";

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
  // Exact match first
  if (PLAN_CODE_MAP[k]) return PLAN_CODE_MAP[k];
  // Max's DB stores CHAR(10) codes that sometimes carry a suffix (e.g. "UTHHC OH").
  // Try matching on the base code (first 5 chars = standard UNL product code).
  const base = k.slice(0, 5);
  if (PLAN_CODE_MAP[base]) return PLAN_CODE_MAP[base];
  // Also try each token in case of space-separated variants
  for (const token of k.split(/\s+/)) {
    if (PLAN_CODE_MAP[token]) return PLAN_CODE_MAP[token];
  }
  return k;
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

// Hardcoded field IDs (Sunfire location IQljfeWX6wWHmzUtgSyz).
// These were captured live and match ghl-client.ts LOB_FIELD_IDS.
// Avoids a GHL API round-trip at startup that Cloudflare can block from
// Supabase edge regions.
const STATIC_FIELD_IDS: FieldIdMap = {
  // HIP
  "contact.hip__plan_name":            "0wkHYd9Jfr1mtttt56kf",
  "contact.hip__plan_premium":         "u04RAp234layEohSc3KC",
  "contact.hip__submission_date":      "HbKscJYxMujUTWdgkjU9",
  "contact.hip__effective_date":       "qt4XBL6vrZByGLtkc0Ih",
  "contact.hip__paid_to_date":         "czhlxaX7aFdHkNOY6KPe",
  "contact.hip__billing_mode":         "cB6DQmu1gbSY7piS5Wb1",
  "contact.hip__at_risk_status":       "AHDJArHPmAzZ6IMaIcxw",
  "contact.hip__client_status":        "GnUA91j0Yj1PXH7CPtT4",
  "contact.hip__policy_number":        "O7MjvGP1J6PRGhjdwjhj",
  "contact.hip__carrier_name":         "ujIt1GLYAbrspZ2XgXQy",
  "contact.hip__agent_first_name":     "V7EV9UnKsQD47LKAqnTs",
  "contact.hip__agent_full_name":      "4SMzb0SrKt0mkkv8wN5V",
  "contact.hip__agent_writing_number": "eMkkdSs1mq3R1YETEonE",
  "contact.hip__terminated_reason":    "YkGHoEC4SdIe6nJyt5YZ",
  "contact.hip__termination_date":     "xambt0f3vxofw4kt1Pdi",
  // HHC
  "contact.hhc__plan_name":            "8hCfNIwfoOdI12Yyvtin",
  "contact.hhc__plan_premium":         "VJRuOntDk0OW95UU2quk",
  "contact.hhc__submission_date":      "i1G2mIDxNgbKl5ZPQhbh",
  "contact.hhc__effective_date":       "2bzz5hCmd7rL8xTCHnHi",
  "contact.hhc__paid_to_date":         "7rdKra2trtEElzfP0sxL",
  "contact.hhc__billing_mode":         "JGVCWYaY8IWjdw3umjwX",
  "contact.hhc__at_risk_status":       "cOhlJ1vFAPk9oyrwn4Qo",
  "contact.hhc__client_status":        "55lFi7DxNxHHRjZw786Q",
  "contact.hhc__policy_number":        "9AX6SIbt8GfjuMIHhF30",
  "contact.hhc__carrier_name":         "qFdK00s2UWyOaWspS6hA",
  "contact.hhc__agent_first_name":     "OuhQi0UEcV4XQkfVzW8L",
  "contact.hhc__agent_full_name":      "7AuXjj4UvTfo77sKSTz4",
  "contact.hhc__agent_writing_number": "aorTF2gLo6xxOiw5LGBx",
  "contact.hhc__terminated_reason":    "MqNTHQv5VtqvWQDjAtCE",
  "contact.hhc__termination_date":     "3kavwfssUhNqp1go6Bjs",
  // Life
  "contact.life__plan_name":           "u3k0zrN8JCbCXrvUMP5u",
  "contact.life__plan_premium":        "O7PBZkE2ph4Izt1s9zxt",
  "contact.life__submission_date":     "VvjKFIuX8S3qSouiLq0D",
  "contact.life__effective_date":      "kt884Dl3B470YF43rJqO",
  "contact.life__paid_to_date":        "DfxnsvpMB8JnqQShOIQp",
  "contact.life__billing_mode":        "Z3eM2nXfhbke32bmpsjw",
  "contact.life__at_risk_status":      "WC0CIPwCIy7oVzCp4unf",
  "contact.life__client_status":       "Ieu1LuasCcusfaT16hO2",
  "contact.life__policy_number":       "DDMuEjHO4rXnjlvLXtro",
  "contact.life__carrier_name":        "WjJkQRwj2CjsAasdvnHG",
  "contact.life__agent_first_name":    "tulhcfFHXkOst7ZpmoK0",
  "contact.life__agent_full_name":     "G66JPd3bh5ipSTj1tYe7",
  "contact.life__agent_writing_number":"jPPwoWZIHCikCFGl8dav",
  "contact.life__terminated_reason":   "s5IZFwc2uO7967bgl5zw",
  "contact.life__termination_date":    "mfEOueJ35gkPL6MLOnQE",
  // DV
  "contact.dv__plan_name":             "VXYaVt3ny9mjbBnnCHUt",
  "contact.dv__plan_premium":          "wjhlbqMimsuhuqSGTXI4",
  "contact.dv__submission_date":       "rtjEEVIlYET61waijrKw",
  "contact.dv__effective_date":        "Zpt4ywr1Sxa73p1X4mPQ",
  "contact.dv__paid_to_date":          "LZVZDeHIlBEGGzsrVquU",
  "contact.dv__billing_mode":          "xP3DVuX9yF3MkEGOg7XO",
  "contact.dv__at_risk_status":        "rUfUumYDwb1monhWRZ88",
  "contact.dv__client_status":         "dK1edrgLZbUQUZ5Pg5J8",
  "contact.dv__policy_number":         "kZKzqIn6Aon0HR2aQSsj",
  "contact.dv__carrier_name":          "7BaMsjNLVmlLDnFGEcdM",
  "contact.dv__agent_first_name":      "IVHUUILreWiYolYr0Ski",
  "contact.dv__agent_full_name":       "06YqTBfafv1J2h1Espko",
  "contact.dv__agent_writing_number":  "47QZtcUURgU0J8c9YAuR",
  "contact.dv__terminated_reason":     "z6PFV8144iU5wqLXUG4q",
  // Cancer
  "contact.cancer__plan_name":            "vygQpo1UzPk6HGC8rNFF",
  "contact.cancer__plan_premium":         "GH6O3TwhWK2afu2pWb95",
  "contact.cancer__submission_date":      "jljiD2cjqdVLwx2Elptd",
  "contact.cancer__effective_date":       "KXB2RjuHNm0p4XXR3NCS",
  "contact.cancer__paid_to_date":         "FU1lw06KVaQ4QpcMucSY",
  "contact.cancer__billing_mode":         "Fph5DSftKPiwC1X63eS7",
  "contact.cancer__at_risk_status":       "Silo8oGlarkgLUXYH2Lw",
  "contact.cancer__client_status":        "JhgLl7vyEYUoiAqw9emI",
  "contact.cancer__policy_number":        "WL9hnl4eleB2iHCNdJjt",
  "contact.cancer__carrier_name":         "TV2S9vZ15ZQdaRjLwytX",
  "contact.cancer__agent_first_name":     "Hcbu8GyHXpDyryp0cyZl",
  "contact.cancer__agent_full_name":      "gmTwNX6OGPKNAw65otX2",
  "contact.cancer__agent_writing_number": "qFNEnll9LiaQQCrCiFpC",
  // Agent NPN (global, all LOBs)
  "contact.agent_npn":                    "uEFOApsD4JKXsXH3T9E4",
  // Agency sorting
  "contact.ancillary_agency__sorting":    "qSHUIp3GfPWHRGbPh1CM",
};

function resolveFieldIds(): FieldIdMap {
  console.log(`[reconcile] using ${Object.keys(STATIC_FIELD_IDS).length} hardcoded field IDs`);
  return STATIC_FIELD_IDS;
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
    push(`${p}agent_full_name`,      titleCase(str(row.wa_name)));
    push(`${p}agent_first_name`,     titleCase(str((row.wa_name ?? "").split(/\s+/)[0])));
    push(`${p}carrier_name`,         str(row.carrier));
    if (isTerminated) {
      push(`${p}termination_date`,   usDate(row.term_date));
      push(`${p}terminated_reason`,  contractReasonLabel(row.cntrct_reason));
    }
  }

  const tags = ["reconciled | do not automate"];
  if (lob) tags.push(`${lob} | sold client`);

  const body: Record<string, unknown> = { locationId, source: "activity-tracker-reconcile", tags, customFields };
  if (str(row.first_name))  body.firstName = titleCase(str(row.first_name));
  if (str(row.last_name))   body.lastName  = titleCase(str(row.last_name));
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
  try {
  // Auth
  const supabaseUrl      = Deno.env.get("ACTIVITY_TRACKER_SUPABASE_URL") ?? "";
  const serviceRoleKey   = Deno.env.get("ACTIVITY_TRACKER_SERVICE_ROLE_KEY") ?? "";
  const publishableKey   = Deno.env.get("ACTIVITY_TRACKER_SUPABASE_PUBLISHABLE_KEY") ?? "";
  const authHeader       = req.headers.get("Authorization") ?? "";
  if (!serviceRoleKey || !authHeader.includes(serviceRoleKey)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  // Use publishable key for Supabase client reads (legacy anon/service keys disabled)
  const supabase = createClient(supabaseUrl, publishableKey || serviceRoleKey);
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

  const dryRun     = body.dryRun !== false;
  // Mock overrides — for test runs only. Override agency name and agent NPN
  // on every push without touching real DB values.
  const mockAgency  = typeof body.mockAgency === "string" ? body.mockAgency : null;
  const mockNpn     = typeof body.mockNpn    === "string" ? body.mockNpn    : null;

  // GHL creds — always Sunfire
  const ghlToken      = Deno.env.get("GHL_API_KEY_SUNFIRE");
  const ghlLocationId = Deno.env.get("GHL_LOCATION_ID_SUNFIRE");
  if (!ghlToken || !ghlLocationId) {
    return jsonResponse({ error: "GHL_API_KEY_SUNFIRE or GHL_LOCATION_ID_SUNFIRE not set." }, 500);
  }

  // Agency map (wa → canonical agency name)
  const agencyMap = await buildAgencyMap(supabase);

  // Field IDs (skip on dry run)
  // Field IDs are hardcoded from STATIC_FIELD_IDS — no GHL round-trip needed
  const fieldIds: FieldIdMap = dryRun ? {} : resolveFieldIds();

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

  // ── Query Max's DB (READ-ONLY) ─────────────────────────────────────────
  const { default: postgres } = await import("npm:postgres@3.4.5");
  const sql = postgres({
    host:            cleanHost(Deno.env.get("PROD_DB_HOST")!),
    port:            Number((Deno.env.get("PROD_DB_PORT") ?? "5432").replace(/\D/g, "")),
    database:        Deno.env.get("PROD_DB_NAME")!,
    username:        Deno.env.get("PROD_DB_USER")!,
    password:        Deno.env.get("PROD_DB_PASSWORD")!,
    ssl:             { ca: AKAMAI_CA_CERT },
    connect_timeout: 30,
    max:             1,
    idle_timeout:    20,
  });

  let prodRows: ProdRow[] = [];
  try {
    // Chunk into batches of 500 to stay within postgres parameter limits
    const CHUNK = 500;
    for (let i = 0; i < policyNumbers.length; i += CHUNK) {
      const chunk = policyNumbers.slice(i, i + CHUNK);
      const rows = await sql.unsafe(`
        SELECT
          TRIM(t.policy_nbr)        AS policy_nbr,
          TRIM(t.first_name)        AS first_name,
          TRIM(t.last_name)         AS last_name,
          TRIM(t.phone_nbr::text)    AS phone_nbr,
          TRIM(t.plan_code)         AS plan_code,
          t.annual_premium,
          t.issue_date,
          t.app_recvd_date,
          t.paid_to_date,
          t.term_date,
          t.billing_mode,
          TRIM(t.billing_form)      AS billing_form,
          TRIM(t.cntrct_code)       AS cntrct_code,
          TRIM(t.cntrct_reason)     AS cntrct_reason,
          t.at_risk_policy,
          TRIM(t.wa)                AS wa,
          TRIM(t.wa_name)           AS wa_name,
          TRIM(t.ga_name)           AS ga_name,
          TRIM(t.issue_state)       AS issue_state,
          TRIM(t.zip)               AS zip,
          TRIM(t.carrier)           AS carrier
        FROM typed.unl_fym_policy_latest_load t
        WHERE TRIM(t.policy_nbr) IN (${ chunk.map((_, j) => `$${j + 1}`).join(",") })
      `, chunk) as ProdRow[];
      prodRows = prodRows.concat(rows);
    }
    console.log(`[reconcile] Max DB returned ${prodRows.length} rows for ${policyNumbers.length} policy numbers`);
  } finally {
    try { await sql.end(); } catch { /* ignore */ }
  }

  // ── Build NPN map from Supabase agents table ──────────────────────────
  const allWns = [...new Set(prodRows.map(r => (r.wa ?? "").trim().toUpperCase()).filter(Boolean))];
  const npnByWn = new Map<string, string>();
  if (allWns.length > 0) {
    const WN = 500; let wnOff = 0;
    while (true) {
      const { data: agentRows } = await supabase
        .from("agents")
        .select("unl_writing_number, npn")
        .in("unl_writing_number", allWns.slice(wnOff, wnOff + WN));
      for (const a of agentRows ?? []) {
        const wn = ((a.unl_writing_number as string) ?? "").trim().toUpperCase();
        if (wn && a.npn) npnByWn.set(wn, a.npn as string);
      }
      if (!agentRows || agentRows.length < WN) break;
      wnOff += WN;
    }
  }

  // Index rows by policy_nbr for O(1) lookup
  const rowMap = new Map<string, ProdRow>(prodRows.map(r => [r.policy_nbr, r]));

  // ── Push loop (80 req / 10s rate limit) ──────────────────────────────
  interface ReconcileResult {
    policy_number: string; ok: boolean; http_status: number | null;
    error: string | null; skipped: boolean; skip_reason: string | null;
  }
  const results: ReconcileResult[] = [];
  const allOmittedFields = new Set<string>();
  let batchCount = 0;
  let sampleContact: Record<string, unknown> | null = null;
  let samplePolicyNumber: string | null = null;

  for (const policyNumber of policyNumbers) {
    const row = rowMap.get(policyNumber);
    if (!row) {
      results.push({ policy_number: policyNumber, ok: false, http_status: null,
        error: "Not found in Max's DB", skipped: true, skip_reason: "not_found" });
      continue;
    }

    const wa  = (row.wa ?? "").trim().toUpperCase();
    const npn = mockNpn ?? npnByWn.get(wa) ?? "";
    const resolvedAgencyMap = mockAgency
      ? new Map([[wa, mockAgency]]) as typeof agencyMap
      : agencyMap;
    const omittedFields: string[] = [];
    const contactBody = buildContactBody(row, npn, ghlLocationId, fieldIds, omittedFields, resolvedAgencyMap);
    omittedFields.forEach(f => allOmittedFields.add(f));

    const result = await ghlPost(`${apiBase}/contacts/`, ghlToken, contactBody);
    results.push({
      policy_number: policyNumber, ok: result.ok, http_status: result.status,
      error: result.ok ? null : `HTTP ${result.status}: ${JSON.stringify(result.data).slice(0, 200)}`,
      skipped: false, skip_reason: null,
    });

    if (result.ok && sampleContact === null) {
      sampleContact = contactBody;
      samplePolicyNumber = policyNumber;
    }

    batchCount++;
    if (batchCount % 80 === 0) {
      console.log(`[reconcile] batch ${batchCount} — pausing 10s for rate limit`);
      await new Promise(r => setTimeout(r, 10_000));
    }
  }

  const ok_count   = results.filter(r => r.ok && !r.skipped).length;
  const fail_count = results.filter(r => !r.ok && !r.skipped).length;
  const skip_count = results.filter(r => r.skipped).length;

  return jsonResponse({
    ok: fail_count === 0,
    target, dry_run: false, location_id: ghlLocationId,
    total: policyNumbers.length, processed: results.length,
    ok_count, fail_count, skip_count,
    omitted_field_keys: [...allOmittedFields],
    sample_policy_number: samplePolicyNumber,
    sample_contact: sampleContact,
    failures: results.filter(r => !r.ok && !r.skipped).slice(0, 20),
  });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[reconcile] unhandled error:", msg);
    return jsonResponse({ error: "Internal error", detail: msg }, 500);
  }
});
