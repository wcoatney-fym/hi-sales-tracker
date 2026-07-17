import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildAgencyMap, resolveAgencyName, titleCase } from "../_shared/agency-map.ts";
import {
  computeLifecycleEvents,
  contractReasonLabel,
  deriveAtRisk,
  derivePlanType,
  evaluateAtRisk,
  type LifecycleEvent,
  type PolicyState,
  type PriorState,
} from "../sql-import-cron/lifecycle-evaluator.ts";
import {
  buildGhlContactBody,
  loadGhlConfig,
  pushContactToGhl,
  type LifecyclePayload,
} from "../sql-import-cron/ghl-client.ts";

// lifecycle-direct — query Max's DB directly, diff against lifecycle_policy_state,
// fire GHL create-contact for each change. Replaces the import-coupled evaluator
// now that form_submissions is no longer written by a daily import.
//
// Triggers (locked 2026-07-09, Charlie):
//   submission  — policy_nbr seen for the first time (cntrct_code = P)
//   approved    — cntrct_code transitions P -> A
//   terminated  — cntrct_code transitions A -> T (carries mapped reason)
//   at risk     — at_risk_policy flips false -> true (flip-true only; re-arms on recovery)
//
// Agency gate: agencies.ghl_api_enabled = true (renamed from zaps_enabled).
// Best-effort: a GHL failure or DB error never crashes the cron.

// ── Akamai CA cert (pinned) ───────────────────────────────────────────────────
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function cleanHost(raw: string): string {
  return raw.replace(/^https?:\/\//, "").replace(/\/$/, "").split(":")[0];
}

/**
 * Format a date value from Postgres (may arrive as Date object, ISO string, or
 * YYYY-MM-DD string) into MM/DD/YYYY for GHL custom fields.
 */
function usDate(d: unknown): string {
  if (d === null || d === undefined || d === "") return "";
  // Postgres driver returns Date objects for date columns
  const dt = d instanceof Date ? d : new Date(String(d));
  if (isNaN(dt.getTime())) return "";
  const mm  = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd  = String(dt.getUTCDate()).padStart(2, "0");
  const yyyy = String(dt.getUTCFullYear());
  return `${mm}/${dd}/${yyyy}`;
}

function billingModeLabel(code: number | string | null): string {
  switch (String(code ?? "").trim()) {
    case "1":  return "Monthly";
    case "3":  return "Quarterly";
    case "6":  return "Semi-Annual";
    case "12": return "Annual";
    default:   return String(code ?? "");
  }
}

/**
 * Return the per-payment premium from the annual amount.
 *
 * billing_mode encodes MONTHS PER PAYMENT PERIOD (months between drafts):
 *   1  = Monthly     (draft every 1 month)  → per_payment = annual × 1/12
 *   3  = Quarterly   (draft every 3 months) → per_payment = annual × 3/12
 *   6  = Semi-Annual (draft every 6 months) → per_payment = annual × 6/12
 *   12 = Annual      (draft every 12 months)→ per_payment = annual × 12/12
 *
 * Formula: per_payment = annual × (mode / 12)
 * Validated against Max's DB paid_to_date gaps and Clarareesa Peay (mode 1,
 * annual 712 → 59.33) and Jeffrey Garrett (mode 12, annual 164 → 164.00).
 */
function perPaymentPremium(annual: number | null, billingMode: number | null, policyNbr?: string): number {
  if (!annual) return 0;
  const mode = Number(billingMode ?? 1);
  if (![1, 3, 6, 12].includes(mode)) {
    console.warn(`[lifecycle-direct] unexpected billing_mode=${billingMode} on policy ${policyNbr ?? "unknown"} — defaulting to monthly (mode 1)`);
  }
  const months = [1, 3, 6, 12].includes(mode) ? mode : 1;
  return Math.round(annual * (months / 12) * 100) / 100;
}

// Plan-code → human-readable name (mirrors planCodes.ts).
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

// Contract code -> client_status label.
const CONTRACT_STATUS: Record<string, string> = {
  A: "Active", P: "Pending", T: "Terminated", S: "Suspended",
};

// Resolve the writing agent from roster_hierarchy_json.
// Prefers the deepest is_person=true node; falls back to the deepest org node.
interface HierarchyNode {
  name: string;
  depth: string;
  is_person: boolean;
  writing_number: string;
}

// titleCase imported from ../_shared/agency-map.ts (see line 3)

/**
 * Split a middle initial embedded in Max's first_name field. Max stores names
 * like "CLARAREESA D" where a trailing single-letter token is the middle
 * initial. Peeling it off keeps client-facing GHL merge fields from rendering
 * "Hi Charles E,". Returns the title-cased first name and the upper-cased
 * initial (letter only; a trailing period is stripped). A two-word first name
 * with no single-letter tail (e.g. "MARY ANN") is preserved intact.
 */
function splitMiddleInitial(rawFirst: string): { first: string; middleInitial: string } {
  const tokens = (rawFirst ?? "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    const bare = tokens[tokens.length - 1].replace(/\.$/, "");
    if (bare.length === 1 && /[A-Za-z]/.test(bare)) {
      return {
        first: titleCase(tokens.slice(0, -1).join(" ")),
        middleInitial: bare.toUpperCase(),
      };
    }
  }
  return { first: titleCase(tokens.join(" ")), middleInitial: "" };
}

function agentFromHierarchy(hierarchy: HierarchyNode[] | null): {
  fullName: string;
  firstName: string;
  writingNumber: string;
} {
  if (!hierarchy || hierarchy.length === 0) {
    return { fullName: "", firstName: "", writingNumber: "" };
  }
  const persons = hierarchy.filter((n) => n.is_person);
  const node = persons.length > 0 ? persons[persons.length - 1] : hierarchy[hierarchy.length - 1];
  const fullName = titleCase(node.name ?? "");
  return {
    fullName,
    firstName: fullName.split(" ")[0] ?? "",
    writingNumber: (node.writing_number ?? "").trim().toUpperCase(),
  };
}

// Depth-02 non-person node = sub-agency (maps to ancillary_agency__sorting).
function agencyFromHierarchy(hierarchy: HierarchyNode[] | null): string {
  if (!hierarchy) return "";
  const depth2 = hierarchy.filter((n) => n.depth === "02" && !n.is_person);
  if (depth2.length === 0) return "";
  return titleCase(depth2[0].name ?? "");
}

function isDryRun(): boolean {
  try { return (Deno.env.get("LIFECYCLE_DRY_RUN") ?? "").toLowerCase() === "true"; } catch { return false; }
}

// ── Row shape from Max's DB ───────────────────────────────────────────────────
interface ProdRow {
  policy_nbr: string;
  first_name: string;
  last_name: string;
  phone_nbr: string | null;          // bigint cast to text in SELECT
  cntrct_code: string | null;
  cntrct_reason: string | null;
  issue_date: unknown;               // Postgres date — arrives as Date object
  app_recvd_date: unknown;           // application-received date → GHL Submit Date
  paid_to_date: unknown;
  term_date: unknown;
  billing_mode: number | null;
  annual_premium: number | null;
  plan_code: string | null;
  billing_form: string | null;
  at_risk_policy: boolean;
  roster_hierarchy_json: HierarchyNode[] | null;
  _dlt_load_id: string | null;
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // Auth: cron secret header (same mechanism as sql-import-cron).
  const supabaseUrl  = Deno.env.get("SUPABASE_URL")!;
  // Use new-format secret key (sb_secret_...) — legacy SUPABASE_SERVICE_ROLE_KEY JWT
  // was disabled on this project 2026-06-16. Fall back to legacy key if secret key absent.
  const serviceKey   = Deno.env.get("SB_SECRET_KEY") ||
                       Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
  console.log(`[lifecycle-direct] key prefix: ${serviceKey.slice(0, 12)} url: ${supabaseUrl}`);
  console.log(`[lifecycle-direct] GHL token present: ${!!Deno.env.get("GHL_API_KEY_HIP_PORTAL")} location: ${Deno.env.get("GHL_LOCATION_ID_SUNFIRE") ?? "MISSING"}`);
  const supabase     = createClient(supabaseUrl, serviceKey);

  // Verify cron secret (skip on OPTIONS).
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200 });
  }

  // Cron authentication: the pg_cron scheduled job must send X-Cron-Secret
  // (validated against vault) AND X-Cron-Key (static secret set only in cron
  // config, never in manual requests). Presence of a valid X-Cron-Key marks
  // the invocation as scheduled-cron, which exempts it from the confirmation
  // token gate below. Manual invocations (no X-Cron-Key) are never exempt.
  const cronSecret = req.headers.get("X-Cron-Secret") ?? "";
  const cronKey    = req.headers.get("X-Cron-Key")    ?? "";
  const expectedCronKey = Deno.env.get("LIFECYCLE_CRON_KEY") ?? "";
  const isScheduledCron = expectedCronKey.length > 0 && cronKey === expectedCronKey;

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200 });
  }

  if (cronSecret) {
    const { data: vault } = await supabase.rpc("get_cron_import_secret");
    if (!vault || vault !== cronSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
  }

  const dry = isDryRun();
  const ghlConfig = loadGhlConfig();
  const nowMs = Date.now();

  // Helper: write a lifecycle_cron_runs row on every exit path.
  // Called before every return so cron_auth is recorded even when the
  // confirmation gate fires or an error short-circuits the main loop.
  // Best-effort — failure must not affect the caller's response.
  async function writeCronRun(opts: { fired?: number; skipped?: number }) {
    supabase.from("lifecycle_cron_runs").insert({
      cron_auth:  isScheduledCron,
      dry,
      fired:      opts.fired   ?? 0,
      skipped:    opts.skipped ?? 0,
      deploy_sha: deployedSha,
    }).then(
      () => { /* best-effort */ },
      (e: Error) => { console.error("[lifecycle-direct] cron_runs insert failed (non-fatal):", e.message); }
    );
  }

  // Deploy identity — set at deploy time via: supabase secrets set DEPLOY_LIFECYCLE_SHA=<git-sha>
  // Included in every response so dry-run previews can be verified against the repo.
  const deployedSha = Deno.env.get("DEPLOY_LIFECYCLE_SHA") ?? "unknown";

  // Single-policy test filter: ?single_policy=20H6XXXXXX
  // Live (non-dry) single-policy fires require a confirmation token to prevent accidental invocation.
  // First call returns status="awaiting_confirmation" + a token. Second call with ?confirm=<token> fires.
  // Tokens are single-use, stored in Supabase, expire after 5 minutes.
  let singlePolicy: string | null = null;
  let confirmToken: string | null = null;
  try {
    const params = new URL(req.url).searchParams;
    singlePolicy  = params.get("single_policy");
    confirmToken  = params.get("confirm");
  } catch { /* ignore */ }

  // Confirmation gate: ALL manual live fires require a confirmation token.
  // Only the pg_cron scheduled run (authenticated via X-Cron-Key) is exempt.
  // This applies to both single_policy and full-batch manual invocations.
  const isManualLiveFire = !dry && !isScheduledCron;
  if (isManualLiveFire) {
    if (!confirmToken) {
      // Generate a 6-char token, store in Supabase with 5-min TTL, return awaiting state
      const token = Math.random().toString(36).slice(2, 8).toUpperCase();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const scopeLabel = singlePolicy ?? "__batch__";
      await supabase.from("lifecycle_confirm_tokens").insert({
        token, policy_number: scopeLabel, expires_at: expiresAt, used: false,
      }).then(() => {/* best-effort */});
      const confirmParam = singlePolicy
        ? `?single_policy=${singlePolicy}&confirm=${token}`
        : `?confirm=${token}`;
      await writeCronRun({ fired: 0, skipped: 0 });
      return new Response(
        JSON.stringify({
          status: "awaiting_confirmation",
          deploy_sha: deployedSha,
          scope: scopeLabel,
          message: `Post this token in the ops thread and wait for explicit go. Then confirm with: ${confirmParam} (expires 5 min)`,
          token,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    // Validate token
    const tokenScope = singlePolicy ?? "__batch__";
    const { data: tokenRow } = await supabase
      .from("lifecycle_confirm_tokens")
      .select("*")
      .eq("token", confirmToken)
      .eq("policy_number", tokenScope)
      .eq("used", false)
      .gte("expires_at", new Date().toISOString())
      .maybeSingle();
    if (!tokenRow) {
      await writeCronRun({ fired: 0, skipped: 0 });
      return new Response(
        JSON.stringify({ error: "Invalid or expired confirmation token", deploy_sha: deployedSha }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }
    // Mark used immediately
    await supabase.from("lifecycle_confirm_tokens").update({ used: true }).eq("token", confirmToken);
  }

  // ── BACKFILL MODE ─────────────────────────────────────────────────────────
  // Triggered by ?mode=backfill&agency_id=<uuid>&date_from=<YYYY-MM-DD>
  // Reads directly from form_submissions (Supabase), bypasses delta, fires all
  // matching contacts to GHL as "submission" events. No state upsert so the
  // next normal cron run still works cleanly.
  let backfillMode = false;
  let backfillAgencyId: string | null = null;
  let backfillDateFrom: string | null = null;
  try {
    const params = new URL(req.url).searchParams;
    if (params.get("mode") === "backfill") {
      backfillMode      = true;
      backfillAgencyId  = params.get("agency_id");
      backfillDateFrom  = params.get("date_from");
    }
  } catch { /* ignore */ }

  if (backfillMode) {
    if (!backfillAgencyId || !backfillDateFrom) {
      return new Response(
        JSON.stringify({ error: "backfill requires agency_id and date_from params" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const ghlCfg = loadGhlConfig();
    if (!ghlCfg) {
      return new Response(
        JSON.stringify({ error: "GHL config not present" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    // Resolve agency name for payload
    const { data: agencyRow } = await supabase
      .from("agencies")
      .select("name")
      .eq("id", backfillAgencyId)
      .maybeSingle();
    const agencyName = (agencyRow?.name as string) ?? "";

    // Build NPN map from agents + agency_rosters
    const npnByWn = new Map<string, string>();
    const { data: agentRows } = await supabase
      .from("agents")
      .select("unl_writing_number, npn")
      .range(0, 9999);
    for (const a of agentRows ?? []) {
      const wn = (a.unl_writing_number as string ?? "").trim().toUpperCase();
      if (wn && a.npn) npnByWn.set(wn, a.npn as string);
    }
    const { data: rosterRows } = await supabase
      .from("agency_rosters")
      .select("writing_number, npn")
      .eq("status", "active");
    for (const r of rosterRows ?? []) {
      const wn = (r.writing_number as string ?? "").trim().toUpperCase();
      if (wn && r.npn && !npnByWn.has(wn)) npnByWn.set(wn, r.npn as string);
    }

    // Fetch all form_submissions for this agency since date_from
    const allSubmissions: Record<string, unknown>[] = [];
    let offset = 0;
    while (true) {
      const { data: batch } = await supabase
        .from("form_submissions")
        .select("policy_number,client_first_name,client_last_name,phone,email,address,city,state,zip,plan_name,plan_premium,status,product_type,app_submit_date,policy_effective_date,paid_to_date,billing_mode,contract_reason,terminated_date,agent_number,agent_first_name,agent_last_name,carrier")
        .eq("agency_id", backfillAgencyId)
        .gte("app_submit_date", backfillDateFrom)
        .range(offset, offset + 499);
      if (!batch || batch.length === 0) break;
      allSubmissions.push(...batch);
      if (batch.length < 500) break;
      offset += 500;
    }

    const bfAudit: Record<string, unknown>[] = [];
    let bfFired = 0;
    let bfFailed = 0;

    for (const row of allSubmissions) {
      const pn        = String(row.policy_number ?? "").trim();
      const pt        = String(row.product_type  ?? "").trim().toUpperCase();
      const planType  = pt === "HHC" ? "HHC" : pt === "HI" || pt === "HIP" ? "HI" : pt;
      const wn        = String(row.agent_number   ?? "").trim().toUpperCase();
      const npn       = npnByWn.get(wn) ?? wn;
      const firstName = String(row.client_first_name ?? "").trim();
      const nameParts = splitMiddleInitial(firstName);
      const agentFirst = String(row.agent_first_name ?? "").trim();
      const agentLast  = String(row.agent_last_name  ?? "").trim();
      const agentFull  = `${agentFirst} ${agentLast}`.trim();
      const statusRaw  = String(row.status ?? "").trim().toLowerCase();
      const clientStatus = statusRaw === "active" ? "Active" : statusRaw === "pending" ? "Pending" : statusRaw === "terminated" ? "Terminated" : String(row.status ?? "");

      const payload: LifecyclePayload = {
        client_first_name:    nameParts.first,
        middle_initial:       nameParts.middleInitial,
        client_last_name:     titleCase(String(row.client_last_name ?? "").trim()),
        phone:                String(row.phone ?? "").trim(),
        email:                String(row.email ?? "").trim(),
        address:              String(row.address ?? "").trim(),
        city:                 String(row.city   ?? "").trim(),
        state:                String(row.state  ?? "").trim(),
        zip:                  String(row.zip    ?? "").trim(),
        plan_name:            String(row.plan_name ?? "").trim(),
        plan_type:            planType,
        plan_premium:         String(row.plan_premium ?? "").trim(),
        submission_date:      String(row.app_submit_date         ?? "").trim(),
        effective_date:       String(row.policy_effective_date   ?? "").trim(),
        paid_to_date:         String(row.paid_to_date            ?? "").trim(),
        billing_mode:         String(row.billing_mode            ?? "").trim(),
        at_risk_status:       false,
        client_status:        clientStatus,
        policy_number:        pn,
        termination_date:     String(row.terminated_date         ?? "").trim(),
        contract_reason:      String(row.contract_reason         ?? "").trim(),
        agent_npn:            npn,
        agency:               agencyName,
        carrier:              String(row.carrier ?? "UNL").trim(),
        agent_first_name:     agentFirst,
        agent_full_name:      agentFull,
        agent_writing_number: wn,
        trigger:              "submission",
      };

      if (dry) {
        console.log(`[lifecycle-direct:backfill:dry] ${pn}`, JSON.stringify(buildGhlContactBody(payload, ghlCfg.locationId)));
        bfFired++;
        continue;
      }

      const ghlBody = buildGhlContactBody(payload, ghlCfg.locationId);
      const result  = await pushContactToGhl(ghlCfg, ghlBody);
      bfAudit.push({ policy_number: pn, trigger: "submission", ok: result.ok, dry_run: false, error: result.error, http_status: result.http_status, agency_id: backfillAgencyId, risk_signal: null, previous_contract_code: null, contract_code: null, contract_reason: null, upload_id: null });
      if (result.ok) { bfFired++; } else { bfFailed++; }
      console.log(`[lifecycle-direct:backfill] ${pn} ok=${result.ok} http=${result.http_status}`);
    }

    if (bfAudit.length > 0) {
      try {
        for (let i = 0; i < bfAudit.length; i += 500) {
          await supabase.from("lifecycle_event_log").insert(bfAudit.slice(i, i + 500));
        }
      } catch (e) { console.error("[lifecycle-direct] backfill audit write failed:", e); }
    }

    return new Response(
      JSON.stringify({ ok: true, mode: "backfill", agency: agencyName, total: allSubmissions.length, fired: bfFired, failed: bfFailed, dry }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  // ── END BACKFILL MODE ─────────────────────────────────────────────────────

  // ── 1. Load agency gate ──────────────────────────────────────────────────
  const { data: agencyRows } = await supabase
    .from("agencies")
    .select("id, name, ghl_api_enabled");

  const enabledAgencyIds = new Set<string>();
  const agencyNameToId   = new Map<string, string>();
  const agencyIdToName   = new Map<string, string>();
  for (const a of agencyRows ?? []) {
    agencyNameToId.set((a.name as string).toLowerCase(), a.id as string);
    agencyIdToName.set(a.id as string, a.name as string);
    if (a.ghl_api_enabled) enabledAgencyIds.add(a.id as string);
  }

  if (enabledAgencyIds.size === 0) {
    return new Response(JSON.stringify({ ok: true, message: "No agencies enabled" }), { status: 200 });
  }

  // ── 2. Build agency map (wa → agencies.name, Title Case canonical) ─────
  // Resolves the ALL-CAPS ga_name from Max's DB to the tracker's canonical name.
  // Built once at startup alongside the NPN map; cheap (small table).
  const agencyMap = await buildAgencyMap(supabase);

  // ── 2b. Build NPN lookup (agents table primary, agency_rosters fallback) ─
  const npnByWritingNumber  = new Map<string, string>();
  const nameByWritingNumber = new Map<string, { first: string; full: string }>();

  const { data: agentsList } = await supabase
    .from("agents")
    .select("unl_writing_number, npn")
    .range(0, 9999);
  for (const a of agentsList ?? []) {
    const wn = (a.unl_writing_number as string ?? "").trim().toUpperCase();
    if (wn && a.npn) npnByWritingNumber.set(wn, a.npn as string);
  }

  const { data: rosterList } = await supabase
    .from("agency_rosters")
    .select("writing_number, npn, agent_first_name, agent_last_name")
    .eq("status", "active")
    .not("npn", "is", null)
    .neq("npn", "");
  for (const r of rosterList ?? []) {
    const wn = (r.writing_number as string ?? "").trim().toUpperCase();
    if (wn && r.npn && !npnByWritingNumber.has(wn)) {
      npnByWritingNumber.set(wn, r.npn as string);
    }
    if (wn && (r.agent_first_name || r.agent_last_name)) {
      const first = titleCase(String(r.agent_first_name ?? ""));
      const last  = titleCase(String(r.agent_last_name  ?? ""));
      nameByWritingNumber.set(wn, { first, full: `${first} ${last}`.trim() });
    }
  }

  // Phone comes directly from phone_nbr on Max's DB (bigint cast to text in SELECT).

  // ── 2b. Agent writing-number lookup (form_submissions) for agencies whose
  // hierarchy carries no person node (e.g. DH Insurance Group). Used as NPN fallback.
  // Scoped to GHL-enabled agency names to stay under PostgREST's 1000-row page cap.
  const enabledAgencyNames = agencyRows
    ?.filter((a) => a.ghl_api_enabled)
    .map((a) => (a.name as string).toLowerCase()) ?? [];
  const agentNumberByPolicy = new Map<string, string>();
  if (enabledAgencyNames.length > 0) {
    // Fetch agent_number only for GHL-enabled agencies, using exact agency name matches
    // from the agencies table. This keeps us under PostgREST's 1000-row page limit.
    const enabledAgencyNamesOriginal = agencyRows
      ?.filter((a) => a.ghl_api_enabled)
      .map((a) => a.name as string) ?? [];
    for (const agencyName of enabledAgencyNamesOriginal) {
      const { data: agentNumRows } = await supabase
        .from("form_submissions")
        .select("policy_number, agent_number")
        .ilike("agency", agencyName)
        .not("agent_number", "is", null)
        .neq("agent_number", "");
      for (const r of agentNumRows ?? []) {
        if (r.policy_number && r.agent_number)
          agentNumberByPolicy.set(r.policy_number as string, (r.agent_number as string).trim().toUpperCase());
      }
    }
  }

  // ── 3. Load prior state from lifecycle_policy_state ──────────────────────
  // MUST paginate: 1,599 rows; JS client caps at 1,000. Without pagination,
  // policies in rows 1,001-1,599 have no prior-state entry → re-fire on every tick.
  const priorState = new Map<string, PriorState & { agency_id: string | null; at_risk_policy: boolean }>();
  {
    const PS = 1000;
    let psOff = 0;
    while (true) {
      const { data: priorRows, error: priorErr } = await supabase
        .from("lifecycle_policy_state")
        .select("policy_number, cntrct_code, at_risk_policy, paid_to_date, agency_id")
        .range(psOff, psOff + PS - 1);
      if (priorErr) { console.error(`[lifecycle-direct] lifecycle_policy_state read failed: ${priorErr.message}`); break; }
      for (const r of priorRows ?? []) {
        priorState.set(r.policy_number as string, {
          contract_code:    r.cntrct_code as string | null,
          at_risk_fired_at: null,
          agency_id:        r.agency_id as string | null,
          at_risk_policy:   (r.at_risk_policy as boolean) ?? false,
        });
      }
      if (!priorRows || priorRows.length < PS) break;
      psOff += PS;
    }
  }

  // ── 4. Query Max's DB ────────────────────────────────────────────────────
  const { default: postgres } = await import("npm:postgres@3.4.5");
  const sql = postgres({
    host: cleanHost(Deno.env.get("PROD_DB_HOST")!),
    port: Number((Deno.env.get("PROD_DB_PORT") ?? "5432").replace(/\D/g, "")),
    database: Deno.env.get("PROD_DB_NAME")!,
    username: Deno.env.get("PROD_DB_USER")!,
    password: Deno.env.get("PROD_DB_PASSWORD")!,
    ssl: { ca: AKAMAI_CA_CERT },
    connect_timeout: 30,
    max: 1,
    idle_timeout: 20,
  });

  let prodRows: ProdRow[] = [];
  try {
    await sql.unsafe("SET statement_timeout = '120s'");
    const PLAN_FILTER = `plan_code ILIKE '%HI%' OR plan_code ILIKE '%HHC%' OR plan_code ILIKE '%GHI%' OR plan_code ILIKE '%HIP%'`;
    const SELECT_LATEST = `
      TRIM(policy_nbr)            AS policy_nbr,
      TRIM(first_name)            AS first_name,
      TRIM(last_name)             AS last_name,
      TRIM(phone_nbr::text)        AS phone_nbr,
      TRIM(cntrct_code)           AS cntrct_code,
      TRIM(cntrct_reason)         AS cntrct_reason,
      issue_date, app_recvd_date, paid_to_date, term_date, billing_mode, annual_premium,
      TRIM(plan_code)             AS plan_code,
      TRIM(billing_form)          AS billing_form,
      at_risk_policy, roster_hierarchy_json, _dlt_load_id
    `;
    const SELECT_FALLBACK = `
      TRIM(policy_nbr)            AS policy_nbr,
      TRIM(first_name)            AS first_name,
      TRIM(last_name)             AS last_name,
      TRIM(phone_nbr::text)        AS phone_nbr,
      TRIM(cntrct_code)           AS cntrct_code,
      TRIM(cntrct_reason)         AS cntrct_reason,
      issue_date, app_recvd_date, paid_to_date, term_date, billing_mode, annual_premium,
      TRIM(plan_code)             AS plan_code,
      TRIM(billing_form)          AS billing_form,
      at_risk_policy, _dlt_load_id,
      jsonb_build_array(
        jsonb_build_object('depth','01','name',TRIM(mga_name),'writing_number',TRIM(mga),'is_person',false),
        jsonb_build_object('depth','02','name',TRIM(ga_name),'writing_number',TRIM(ga),'is_person',false)
      ) AS roster_hierarchy_json
    `;
    prodRows = await sql.unsafe(
      `SELECT ${SELECT_LATEST} FROM typed.unl_fym_policy_latest_load WHERE ${PLAN_FILTER}`
    ) as ProdRow[];
    // Fallback: if latest_load is empty (new file landed but DLT ingest not yet run),
    // query the previous fully-ingested file directly so daily crons aren't skipped.
    if (prodRows.length === 0) {
      console.log("[lifecycle-direct] latest_load empty — falling back to prev file");
      prodRows = await sql.unsafe(`
        WITH prev_file AS (
          SELECT _source_file FROM typed.unl_fym_policy
          GROUP BY _source_file ORDER BY MAX(_dlt_load_id) DESC LIMIT 1
        )
        SELECT ${SELECT_FALLBACK}
        FROM typed.unl_fym_policy p
        JOIN prev_file pf ON pf._source_file = p._source_file
        WHERE ${PLAN_FILTER}
      `) as ProdRow[];
      console.log("[lifecycle-direct] fallback returned " + prodRows.length + " rows");
    }
  } finally {
    try { await sql.end(); } catch { /* ignore */ }
  }

  // ── 5. Evaluate + fire ────────────────────────────────────────────────────
  const stateUpserts: Record<string, unknown>[] = [];
  const auditRows:    Record<string, unknown>[] = [];
  let   fired = 0;
  let   skipped = 0;
  let   dryRunPayload: unknown = undefined; // populated in single-policy dry-run

  for (const row of prodRows) {
    const pn = (row.policy_nbr ?? "").trim();
    if (!pn) continue;

    // Resolve agency from hierarchy → then confirm against agency map.
    // agencyFromHierarchy extracts the depth-02 node name from the JSON hierarchy
    // (title-cased). resolveAgencyName cross-checks via wa → agency_writing_numbers
    // → agencies.name for canonical lookup; falls back to titleCase(ga_name) if not found.
    const hierarchy  = row.roster_hierarchy_json ?? [];
    const agent      = agentFromHierarchy(hierarchy);
    const agencyName = resolveAgencyName(agencyMap, agent.writingNumber, agencyFromHierarchy(hierarchy));
    const agencyId   = agencyNameToId.get(agencyName.toLowerCase()) ?? null;

    // Agency gate.
    if (!agencyId || !enabledAgencyIds.has(agencyId)) {
      skipped++;
      continue;
    }

    const prior = priorState.get(pn) ?? null;
    const state: PolicyState = {
      policy_number:         pn,
      contract_code:         row.cntrct_code ?? null,
      billing_mode:          row.billing_mode != null ? String(row.billing_mode) : null,
      billing_form:          row.billing_form ?? null,
      policy_effective_date: row.issue_date   ? usDate(row.issue_date)   : null,
      paid_to_date:          row.paid_to_date ? usDate(row.paid_to_date) : null,
      contract_reason:       row.cntrct_reason ?? null,
    };

    const events: LifecycleEvent[] = computeLifecycleEvents(
      state,
      prior ? { contract_code: prior.contract_code, at_risk_fired_at: null } : undefined,
      nowMs,
    );

    // at-risk evaluation: use the DB-supplied boolean (Max computes it).
    const wasAtRisk = prior?.at_risk_policy ?? false;
    const isAtRisk  = row.at_risk_policy;
    if (isAtRisk && !wasAtRisk && (row.cntrct_code ?? "").trim() === "A") {
      events.push({
        policy_number:          pn,
        trigger:                "at risk",
        previous_contract_code: prior?.contract_code ?? null,
        contract_reason:        contractReasonLabel(row.cntrct_reason ?? null),
        risk_signal:            "at_risk_policy=true",
      });
    }

    // Build state upsert row (always; captures recovery too).
    stateUpserts.push({
      policy_number:   pn,
      cntrct_code:     row.cntrct_code ?? null,
      at_risk_policy:  row.at_risk_policy,
      paid_to_date:    row.paid_to_date ?? null,
      agency_id:       agencyId,
      last_load_id:    row._dlt_load_id ?? null,
    });

    if (events.length === 0) continue;

    // Resolve agent.
    if (singlePolicy && pn !== singlePolicy) { skipped++; continue; }

    // agent already resolved above (before agency gate)
    const fallbackWn = agentNumberByPolicy.get(pn) ?? "";
    const npn = npnByWritingNumber.get(agent.writingNumber)
             ?? (fallbackWn ? npnByWritingNumber.get(fallbackWn) ?? "" : "");
    // When hierarchy has no person node (e.g. DH — all org nodes), resolve agent
    // name from the roster using the fallback writing number.
    const resolvedWn   = npn && fallbackWn ? fallbackWn : agent.writingNumber;
    const rosterName   = nameByWritingNumber.get(resolvedWn);
    const agentFirst   = rosterName?.first ?? agent.firstName;
    const agentFull    = rosterName?.full  ?? agent.fullName;
    if (singlePolicy) console.log(`[npn-trace] pn=${pn} agentWn=${agent.writingNumber} fallbackWn=${fallbackWn} npn=${npn} rosterMapSize=${npnByWritingNumber.size} agentNumMapSize=${agentNumberByPolicy.size} agentNumEntry=${agentNumberByPolicy.get(pn)}`);
    const planName = resolvePlanName(row.plan_code);
    const planType = derivePlanType(planName || row.plan_code);
    const monthly  = perPaymentPremium(row.annual_premium, row.billing_mode, pn);
    const atRiskStatus = row.at_risk_policy;
    // Max embeds a middle initial in first_name ("CLARAREESA D"); peel it off so
    // GHL greeting merge fields don't render "Hi Charles E,". The initial is
    // written to the global contact.middle_initial field (see buildGhlContactBody).
    const nameParts = splitMiddleInitial(row.first_name ?? "");

    for (const ev of events) {
      const payload: LifecyclePayload = {
        client_first_name:    nameParts.first,
        middle_initial:       nameParts.middleInitial,
        client_last_name:     titleCase((row.last_name  ?? "").trim()),
        phone:                (row.phone_nbr ?? "").trim(),
        email:                "",
        address:              "",
        city:                 "",
        state:                "",
        zip:                  "",
        plan_name:            planName,
        plan_type:            planType,
        plan_premium:         String(monthly),
        // Submit Date = application-received date (app_recvd_date); Effective Date = issue_date.
        // No longer double-sourced from issue_date. Null app_recvd_date → "" (date canon).
        submission_date:      usDate(row.app_recvd_date),
        effective_date:       usDate(row.issue_date),
        paid_to_date:         usDate(row.paid_to_date),
        billing_mode:         billingModeLabel(row.billing_mode),
        at_risk_status:       atRiskStatus,
        client_status:        CONTRACT_STATUS[row.cntrct_code?.trim() ?? ""] ?? (row.cntrct_code ?? ""),
        policy_number:        pn,
        termination_date:     usDate(row.term_date),
        contract_reason:      contractReasonLabel(row.cntrct_reason ?? null),
        agent_npn:            npn,
        agency:               agencyName,
        // TEMPORARY: carrier is not yet a column in Max's DB (raw.unl_fym_policy_latest_load).
        // This feed is UNL (United National Life). Wire to carrier_name column when Max adds it.
        // TODO: replace constant when carrier_name column is available.
        carrier:              "UNL",
        agent_first_name:     agentFirst,
        agent_full_name:      agentFull,
        agent_writing_number: resolvedWn,
        trigger:              ev.trigger,
      };

      if (dry) {
        // In single-policy dry-run, build the full GHL request body and return it
        // in the response so the payload can be reviewed field-by-field before any live fire.
        const dryBody = ghlConfig ? buildGhlContactBody(payload, ghlConfig.locationId) : null;
        console.log(`[lifecycle-direct:dry-run] ${ev.trigger} ${pn}`, JSON.stringify(dryBody ?? payload));
        if (singlePolicy) dryRunPayload = dryBody;
        auditRows.push({ policy_number: pn, trigger: ev.trigger, ok: true, dry_run: true, error: null, http_status: null, agency_id: agencyId, risk_signal: ev.risk_signal ?? null, previous_contract_code: ev.previous_contract_code, contract_code: row.cntrct_code, contract_reason: ev.contract_reason, upload_id: null });
        fired++;
        continue;
      }

      if (ghlConfig) {
        const body = buildGhlContactBody(payload, ghlConfig.locationId);
        const r    = await pushContactToGhl(ghlConfig, body);
        auditRows.push({ policy_number: pn, trigger: ev.trigger, ok: r.ok, dry_run: false, error: r.error, http_status: r.http_status, agency_id: agencyId, risk_signal: ev.risk_signal ?? null, previous_contract_code: ev.previous_contract_code, contract_code: row.cntrct_code, contract_reason: ev.contract_reason, upload_id: null });
        fired++;
      } else {
        console.warn(`[lifecycle-direct] no GHL config; skipped ${ev.trigger} ${pn}`);
        auditRows.push({ policy_number: pn, trigger: ev.trigger, ok: false, dry_run: false, error: "no GHL config", http_status: null, agency_id: agencyId, risk_signal: ev.risk_signal ?? null, previous_contract_code: ev.previous_contract_code, contract_code: row.cntrct_code, contract_reason: ev.contract_reason, upload_id: null });
        // do NOT increment fired — no GHL config means nothing was pushed
      }
    }
  }

  // ── 6. Persist state + audit in bulk (best-effort) ───────────────────────
  // State upserts are SKIPPED on dry runs. Dry runs must not mark events as seen —
  // doing so silently consumes real lifecycle events, causing them to never fire
  // when dry-run is disabled. Only live fires advance state.
  if (!dry) {
    try {
      for (let i = 0; i < stateUpserts.length; i += 500) {
        await supabase
          .from("lifecycle_policy_state")
          .upsert(stateUpserts.slice(i, i + 500), { onConflict: "policy_number" });
      }
    } catch (e) {
      console.error("[lifecycle-direct] state upsert failed (non-fatal):", e);
    }
  } else {
    console.log(`[lifecycle-direct] dry-run: skipping state upserts for ${stateUpserts.length} rows`);
  }

  try {
    for (let i = 0; i < auditRows.length; i += 500) {
      await supabase.from("lifecycle_event_log").insert(auditRows.slice(i, i + 500));
    }
  } catch (e) {
    console.error("[lifecycle-direct] audit log write failed (non-fatal):", e);
  }

  await writeCronRun({ fired, skipped });
  return new Response(
    JSON.stringify({ ok: true, fired, skipped, dry, cron_auth: isScheduledCron, deploy_sha: deployedSha, rows: prodRows.length, ghl_config_present: !!ghlConfig, ...(singlePolicy ? { single_policy: singlePolicy } : {}), ...(dryRunPayload ? { dry_run_payload: dryRunPayload } : {}) }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
