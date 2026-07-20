import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildAgencyMap, resolveAgencyName, titleCase } from "../_shared/agency-map.ts";
import {
  contractReasonLabel,
  derivePlanType,
} from "../sql-import-cron/lifecycle-evaluator.ts";
import {
  buildGhlContactBody,
  loadGhlConfig,
  pushContactToGhl,
  type LifecyclePayload,
} from "../sql-import-cron/ghl-client.ts";

// lifecycle-direct — queries Max's DB using the trigger-query pattern from
// docs/migration-mockup/trigger-queries.sql. No form_submissions reads.
// No lifecycle_policy_state reads or writes.
//
// Idempotency: fired_triggers table (Supabase tracker DB). Every trigger query
// gates on NOT EXISTS (policy_nbr, trigger_type, changed_on) in fired_triggers.
// After a successful GHL push, a fired_triggers row is inserted (ON CONFLICT DO NOTHING).
//
// Triggers:
//   submission  — cntrct_code = P, prev IS NULL (new) OR prev IN (T,A) (rewrite)
//   approved    — prev = P, cntrct_code = A
//   terminated  — prev = A, cntrct_code = T
//   at_risk     — at_risk_policy = true, previous_at_risk_status = false/NULL
//
// Agency gate: agencies.ghl_api_enabled = true.
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
  // Exact match first
  if (PLAN_CODE_MAP[k]) return PLAN_CODE_MAP[k];
  // Max's DB stores CHAR(10) plan_code — sometimes carries a suffix (e.g. "UTHHC OH").
  // Try base code (first 5 chars = standard UNL product code).
  const base = k.slice(0, 5);
  if (PLAN_CODE_MAP[base]) return PLAN_CODE_MAP[base];
  // Try each space-separated token
  for (const token of k.split(/\s+/)) {
    if (PLAN_CODE_MAP[token]) return PLAN_CODE_MAP[token];
  }
  return k;
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
  console.log(`[lifecycle-direct] GHL token present: ${!!Deno.env.get("GHL_API_KEY_SUNFIRE")} location: ${Deno.env.get("GHL_LOCATION_ID_SUNFIRE") ?? "MISSING"}`);
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

    // ── Resolve agency metadata from Supabase ─────────────────────────────
    const { data: agencyRow } = await supabase
      .from("agencies")
      .select("name, ghl_api_key, ghl_location_id")
      .eq("id", backfillAgencyId)
      .maybeSingle();
    if (!agencyRow) {
      return new Response(
        JSON.stringify({ error: `agency ${backfillAgencyId} not found` }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }
    const agencyName = (agencyRow.name as string) ?? "";

    // ── Build NPN map (same as main path) ────────────────────────────────
    const bfNpnByWn = new Map<string, string>();
    const bfNameByWn = new Map<string, { first: string; full: string }>();
    {
      const AN = 1000; let anOff = 0;
      while (true) {
        const { data: ar } = await supabase
          .from("agents")
          .select("unl_writing_number, npn, first_name, last_name")
          .range(anOff, anOff + AN - 1);
        for (const a of ar ?? []) {
          const wn = (a.unl_writing_number as string ?? "").trim().toUpperCase();
          if (!wn) continue;
          if (a.npn) bfNpnByWn.set(wn, a.npn as string);
          const first = (a.first_name as string ?? "").trim();
          const full  = `${first} ${(a.last_name as string ?? "").trim()}`.trim();
          bfNameByWn.set(wn, { first, full });
        }
        if (!ar || ar.length < AN) break;
        anOff += AN;
      }
      const { data: rr } = await supabase
        .from("agency_rosters")
        .select("writing_number, npn, agent_name")
        .eq("status", "active");
      for (const r of rr ?? []) {
        const wn = (r.writing_number as string ?? "").trim().toUpperCase();
        if (!wn) continue;
        if (r.npn && !bfNpnByWn.has(wn)) bfNpnByWn.set(wn, r.npn as string);
        if (!bfNameByWn.has(wn) && r.agent_name) {
          const parts = (r.agent_name as string).trim().split(/\s+/);
          bfNameByWn.set(wn, { first: parts[0] ?? "", full: (r.agent_name as string).trim() });
        }
      }
    }

    // ── Query Max's DB for agency policies since date_from ────────────────
    // Backfill uses the same trigger-query pattern as the main path, but:
    //   - scoped to one agency (wa IN agency writing numbers for this agency)
    //   - date window uses app_recvd_date >= date_from instead of CURRENT_DATE - 3 days
    //   - fires ALL current-state rows (not just pending triggers) so GHL is fully seeded
    //   - fired_triggers NOT EXISTS gate is preserved — safe to re-run
    const { default: pgBf } = await import("npm:postgres@3.4.5");
    const sqlBf = pgBf({
      host:     cleanHost(Deno.env.get("PROD_DB_HOST")!),
      port:     Number((Deno.env.get("PROD_DB_PORT") ?? "5432").replace(/\D/g, "")),
      database: Deno.env.get("PROD_DB_NAME")!,
      username: Deno.env.get("PROD_DB_USER")!,
      password: Deno.env.get("PROD_DB_PASSWORD")!,
      ssl:      { ca: AKAMAI_CA_CERT },
      connect_timeout: 30,
      max: 1,
      idle_timeout: 20,
    });

    // Fetch agency writing numbers from Supabase to scope the Max query.
    const { data: wns } = await supabase
      .from("agency_writing_numbers")
      .select("writing_number")
      .eq("agency_id", backfillAgencyId);
    const agencyWns = (wns ?? []).map((r) => (r.writing_number as string).trim().toUpperCase()).filter(Boolean);

    let bfRows: ProdRow[] = [];
    try {
      await sqlBf.unsafe("SET statement_timeout = '120s'");
      const PLAN_FILTER = `(
        t.plan_code ILIKE '%HI%' OR t.plan_code ILIKE '%HHC%'
        OR t.plan_code ILIKE '%GHI%' OR t.plan_code ILIKE '%HIP%'
      )`;
      if (agencyWns.length === 0) {
        console.warn(`[lifecycle-direct:backfill] no writing numbers for agency ${backfillAgencyId} — skipping Max query`);
      } else {
        // Use the full current-state row for each policy; trigger is always 'submission'
        // for a backfill (seeding GHL from scratch, not diff-based).
        bfRows = await sqlBf.unsafe(`
          SELECT
            TRIM(t.policy_nbr)          AS policy_nbr,
            TRIM(t.first_name)          AS first_name,
            TRIM(t.last_name)           AS last_name,
            TRIM(t.phone_nbr::text)      AS phone_nbr,
            TRIM(t.cntrct_code)         AS cntrct_code,
            TRIM(t.cntrct_reason)       AS cntrct_reason,
            t.issue_date, t.app_recvd_date, t.paid_to_date, t.term_date,
            t.billing_mode, t.annual_premium,
            TRIM(t.plan_code)           AS plan_code,
            TRIM(t.billing_form)        AS billing_form,
            t.at_risk_policy,
            t.roster_hierarchy_json,
            t._dlt_load_id,
            TRIM(t.wa)                  AS wa,
            TRIM(t.wa_name)             AS wa_name
          FROM typed.unl_fym_policy_latest_load t
          WHERE ${PLAN_FILTER}
            AND TRIM(UPPER(t.wa)) = ANY(${ agencyWns.map((_, i) => `$${i + 1}`).join(",") })
            AND t.app_recvd_date >= ${ agencyWns.length + 1 }::date
            AND NOT EXISTS (
              SELECT 1 FROM generate_series(1,1)
              -- fired_triggers gate applied in app code below (cross-DB)
            )
        `, [...agencyWns, backfillDateFrom]) as ProdRow[];
        console.log(`[lifecycle-direct:backfill] Max query returned ${bfRows.length} rows for agency ${agencyName}`);
      }
    } finally {
      try { await sqlBf.end(); } catch { /* ignore */ }
    }

    // ── Load fired_triggers for this agency (backfill scope) ──────────────
    // Only need submission entries for the policies we're about to process.
    const bfPolicyNbrs = bfRows.map((r) => (r.policy_nbr ?? "").trim()).filter(Boolean);
    const bfFiredSet = new Set<string>();
    if (bfPolicyNbrs.length > 0) {
      const FT = 1000; let ftOff = 0;
      while (true) {
        const { data: ftRows } = await supabase
          .from("fired_triggers")
          .select("policy_nbr, trigger_type, changed_on")
          .in("policy_nbr", bfPolicyNbrs.slice(0, 500)) // PostgREST IN limit safety
          .eq("trigger_type", "submission")
          .range(ftOff, ftOff + FT - 1);
        for (const r of ftRows ?? []) {
          bfFiredSet.add(`${r.policy_nbr}|${r.trigger_type}|${r.changed_on}`);
        }
        if (!ftRows || ftRows.length < FT) break;
        ftOff += FT;
      }
    }

    const bfAudit: Record<string, unknown>[] = [];
    const bfFiredInserts: { policy_nbr: string; trigger_type: string; changed_on: string }[] = [];
    let bfFired = 0;
    let bfFailed = 0;
    let bfHeld = 0;

    for (const row of bfRows) {
      const pn = (row.policy_nbr ?? "").trim();
      if (!pn) continue;

      // changed_on for backfill submission = app_recvd_date
      const changedOnIso = (row.app_recvd_date instanceof Date
        ? row.app_recvd_date.toISOString()
        : String(row.app_recvd_date ?? "")).slice(0, 10);
      if (!changedOnIso) continue;

      // fired_triggers idempotency gate
      const bfKey = `${pn}|submission|${changedOnIso}`;
      if (bfFiredSet.has(bfKey)) continue;

      // Resolve writing number and NPN from wa column (Max's DB)
      const wa  = ("wa" in row ? String((row as Record<string, unknown>).wa ?? "") : "").trim().toUpperCase();
      const npn = bfNpnByWn.get(wa) ?? "";
      if (!npn) {
        console.log(`[lifecycle-direct:backfill] NPN hold: ${pn} wa=${wa}`);
        bfHeld++;
        continue;
      }

      const rosterName  = bfNameByWn.get(wa);
      const nameParts   = splitMiddleInitial((row.first_name ?? "").trim());
      const planName    = resolvePlanName(row.plan_code);
      const planType    = derivePlanType(planName || row.plan_code);
      const monthly     = perPaymentPremium(row.annual_premium, row.billing_mode, pn);
      const clientStatus = CONTRACT_STATUS[row.cntrct_code?.trim() ?? ""] ?? (row.cntrct_code ?? "");

      // wa_name from Max's DB (confirmed field in migration_mock_up.md)
      const waName     = ("wa_name" in row ? String((row as Record<string, unknown>).wa_name ?? "") : "").trim();
      const agentFirst = rosterName?.first ?? (waName ? waName.split(/\s+/)[0] : "");
      const agentFull  = rosterName?.full  ?? waName;

      const payload: LifecyclePayload = {
        client_first_name:    nameParts.first,
        middle_initial:       nameParts.middleInitial,
        client_last_name:     titleCase((row.last_name ?? "").trim()),
        phone:                (row.phone_nbr ?? "").trim(),
        email:                "",
        address:              "",
        city:                 "",
        state:                "",
        zip:                  "",
        plan_name:            planName,
        plan_type:            planType,
        plan_premium:         String(monthly),
        submission_date:      usDate(row.app_recvd_date),
        effective_date:       usDate(row.issue_date),
        paid_to_date:         usDate(row.paid_to_date),
        billing_mode:         billingModeLabel(row.billing_mode),
        at_risk_status:       row.at_risk_policy,
        client_status:        clientStatus,
        policy_number:        pn,
        termination_date:     usDate(row.term_date),
        contract_reason:      contractReasonLabel(row.cntrct_reason ?? null),
        agent_npn:            npn,
        agency:               agencyName,
        carrier:              "UNL",
        agent_first_name:     agentFirst,
        agent_full_name:      agentFull,
        agent_writing_number: wa,
        trigger:              "submission",
      };

      if (dry) {
        console.log(`[lifecycle-direct:backfill:dry] ${pn}`, JSON.stringify(buildGhlContactBody(payload, ghlCfg.locationId)));
        bfFired++;
        bfFiredSet.add(bfKey);
        continue;
      }

      const ghlBody = buildGhlContactBody(payload, ghlCfg.locationId);
      const result  = await pushContactToGhl(ghlCfg, ghlBody);
      bfAudit.push({ policy_number: pn, trigger: "submission", ok: result.ok, dry_run: false, error: result.error, http_status: result.http_status, agency_id: backfillAgencyId, risk_signal: null, previous_contract_code: null, contract_code: row.cntrct_code, contract_reason: contractReasonLabel(row.cntrct_reason ?? null), upload_id: null });
      if (result.ok) {
        bfFired++;
        bfFiredInserts.push({ policy_nbr: pn, trigger_type: "submission", changed_on: changedOnIso });
        bfFiredSet.add(bfKey);
      } else {
        bfFailed++;
      }
      console.log(`[lifecycle-direct:backfill] ${pn} ok=${result.ok} http=${result.http_status}`);
    }

    // Persist fired_triggers + audit
    if (!dry) {
      if (bfFiredInserts.length > 0) {
        try {
          for (let i = 0; i < bfFiredInserts.length; i += 500) {
            const { error: ftErr } = await supabase
              .from("fired_triggers")
              .upsert(bfFiredInserts.slice(i, i + 500), { onConflict: "policy_nbr,trigger_type,changed_on", ignoreDuplicates: true });
            if (ftErr) console.error(`[lifecycle-direct:backfill] fired_triggers write failed: ${ftErr.message}`);
          }
        } catch (e) { console.error("[lifecycle-direct:backfill] fired_triggers write error (non-fatal):", e); }
      }
      if (bfAudit.length > 0) {
        try {
          for (let i = 0; i < bfAudit.length; i += 500) {
            await supabase.from("lifecycle_event_log").insert(bfAudit.slice(i, i + 500));
          }
        } catch (e) { console.error("[lifecycle-direct:backfill] audit write failed:", e); }
      }
    }

    return new Response(
      JSON.stringify({ ok: true, mode: "backfill", agency: agencyName, total: bfRows.length, fired: bfFired, failed: bfFailed, held: bfHeld, dry }),
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
  // ── 2b. form_submissions agent-number fallback REMOVED ───────────────────
  // wa from Max's DB is the writing number directly. No form_submissions reads.
  // ── 3. lifecycle_policy_state REMOVED ────────────────────────────────────
  // Idempotency is now handled by fired_triggers (see migration 20260720150000).
  // Trigger queries gate on NOT EXISTS (policy_nbr, trigger_type, changed_on).

  // ── 4. Query Max's DB — trigger queries (mockup spec) ───────────────────
  // Runs all four trigger queries in one pass using UNION ALL.
  // Each row already represents a trigger that has NOT yet fired (NOT EXISTS
  // gates on fired_triggers in the query itself).
  // fired_triggers is in Supabase; the NOT EXISTS gate is applied in app code
  // (fetch fired set, exclude in JS) since Max's DB can't JOIN Supabase directly.
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

  // ── 4a. Load already-fired set from fired_triggers (Supabase) ────────────
  // Build a Set of "policy_nbr|trigger_type|changed_on" strings for O(1) exclusion.
  const firedSet = new Set<string>();
  {
    const FT = 1000;
    let ftOff = 0;
    while (true) {
      const { data: ftRows, error: ftErr } = await supabase
        .from("fired_triggers")
        .select("policy_nbr, trigger_type, changed_on")
        .range(ftOff, ftOff + FT - 1);
      if (ftErr) { console.error(`[lifecycle-direct] fired_triggers read failed: ${ftErr.message}`); break; }
      for (const r of ftRows ?? []) {
        firedSet.add(`${r.policy_nbr}|${r.trigger_type}|${r.changed_on}`);
      }
      if (!ftRows || ftRows.length < FT) break;
      ftOff += FT;
    }
  }
  console.log(`[lifecycle-direct] fired_triggers loaded: ${firedSet.size}`);

  // ── 4b. Trigger row shape ─────────────────────────────────────────────────
  interface TriggerRow extends ProdRow {
    trigger_type: "approved" | "terminated" | "submission" | "at_risk";
    changed_on:   Date | string;  // date column from Max's DB
  }

  // ── 4c. Run trigger queries against Max's DB ──────────────────────────────
  const POLICY_COLS = `
    TRIM(t.policy_nbr)           AS policy_nbr,
    TRIM(t.first_name)           AS first_name,
    TRIM(t.last_name)            AS last_name,
    TRIM(t.phone_nbr::text)       AS phone_nbr,
    TRIM(t.cntrct_code)          AS cntrct_code,
    TRIM(t.cntrct_reason)        AS cntrct_reason,
    t.issue_date, t.app_recvd_date, t.paid_to_date, t.term_date,
    t.billing_mode, t.annual_premium,
    TRIM(t.plan_code)            AS plan_code,
    TRIM(t.billing_form)         AS billing_form,
    t.at_risk_policy,
    t.roster_hierarchy_json,
    t._dlt_load_id
  `;

  let triggerRows: TriggerRow[] = [];
  try {
    await sql.unsafe("SET statement_timeout = '120s'");
    const PLAN_FILTER = `(
      t.plan_code ILIKE '%HI%' OR t.plan_code ILIKE '%HHC%'
      OR t.plan_code ILIKE '%GHI%' OR t.plan_code ILIKE '%HIP%'
    )`;

    triggerRows = await sql.unsafe(`
      -- Trigger A/B: P→A (approved) and A→T (terminated)
      SELECT ${POLICY_COLS},
        CASE
          WHEN t.previous_contract_code = 'P' AND t.cntrct_code = 'A' THEN 'approved'
          WHEN t.previous_contract_code = 'A' AND t.cntrct_code = 'T' THEN 'terminated'
        END::text AS trigger_type,
        t.contract_code_last_change_date AS changed_on
      FROM typed.unl_fym_policy_latest_load t
      WHERE ${PLAN_FILTER}
        AND (
          (t.previous_contract_code = 'P' AND t.cntrct_code = 'A')
          OR (t.previous_contract_code = 'A' AND t.cntrct_code = 'T')
        )
        AND t.contract_code_last_change_date >= CURRENT_DATE - INTERVAL '3 days'

      UNION ALL

      -- Trigger C-1: new submission (prev IS NULL)
      SELECT ${POLICY_COLS},
        'submission'::text AS trigger_type,
        t.app_recvd_date   AS changed_on
      FROM typed.unl_fym_policy_latest_load t
      WHERE ${PLAN_FILTER}
        AND t.cntrct_code = 'P'
        AND t.previous_contract_code IS NULL
        AND t.app_recvd_date >= CURRENT_DATE - INTERVAL '3 days'

      UNION ALL

      -- Trigger C-2: business rewrite (T→P or A→P)
      SELECT ${POLICY_COLS},
        'submission'::text               AS trigger_type,
        t.contract_code_last_change_date AS changed_on
      FROM typed.unl_fym_policy_latest_load t
      WHERE ${PLAN_FILTER}
        AND t.cntrct_code = 'P'
        AND t.previous_contract_code IN ('T', 'A')
        AND t.contract_code_last_change_date >= CURRENT_DATE - INTERVAL '3 days'

      UNION ALL

      -- Trigger D: at-risk newly set
      SELECT ${POLICY_COLS},
        'at_risk'::text                      AS trigger_type,
        t.at_risk_status_last_change_date    AS changed_on
      FROM typed.unl_fym_policy_latest_load t
      WHERE ${PLAN_FILTER}
        AND t.at_risk_policy = true
        AND (t.previous_at_risk_status = false OR t.previous_at_risk_status IS NULL)
        AND t.at_risk_status_last_change_date >= CURRENT_DATE - INTERVAL '3 days'

      ORDER BY changed_on DESC
    `) as TriggerRow[];
    console.log(`[lifecycle-direct] trigger query returned ${triggerRows.length} candidate rows`);
  } finally {
    try { await sql.end(); } catch { /* ignore */ }
  }

  // ── 5. Evaluate + fire ────────────────────────────────────────────────────
  const auditRows:    Record<string, unknown>[] = [];
  const npnHoldRows:  Record<string, unknown>[] = [];
  const firedInserts: { policy_nbr: string; trigger_type: string; changed_on: string }[] = [];
  let   fired = 0;
  let   skipped = 0;
  let   held = 0;
  let   dryRunPayload: unknown = undefined; // populated in single-policy dry-run

  for (const row of triggerRows) {
    const pn = (row.policy_nbr ?? "").trim();
    if (!pn) continue;

    // Normalise changed_on to YYYY-MM-DD string for fired_triggers key.
    const changedOnIso = (row.changed_on instanceof Date
      ? row.changed_on.toISOString()
      : String(row.changed_on ?? "")).slice(0, 10);
    if (!changedOnIso) { skipped++; continue; }

    // fired_triggers idempotency gate (app-side, mirrors NOT EXISTS in spec SQL).
    const firedKey = `${pn}|${row.trigger_type}|${changedOnIso}`;
    if (firedSet.has(firedKey)) { skipped++; continue; }

    // Single-policy filter.
    if (singlePolicy && pn !== singlePolicy) { skipped++; continue; }

    // Resolve agency from hierarchy → confirm against agency map.
    const hierarchy  = row.roster_hierarchy_json ?? [];
    const agent      = agentFromHierarchy(hierarchy);
    const agencyName = resolveAgencyName(agencyMap, agent.writingNumber, agencyFromHierarchy(hierarchy));
    const agencyId   = agencyNameToId.get(agencyName.toLowerCase()) ?? null;

    // Agency gate.
    if (!agencyId || !enabledAgencyIds.has(agencyId)) {
      skipped++;
      continue;
    }

    // Resolve NPN.
    const npn = npnByWritingNumber.get(agent.writingNumber) ?? "";
    const resolvedWn = agent.writingNumber;
    const rosterName = nameByWritingNumber.get(resolvedWn);
    const agentFirst = rosterName?.first ?? agent.firstName;
    const agentFull  = rosterName?.full  ?? agent.fullName;
    if (singlePolicy) console.log(`[npn-trace] pn=${pn} trigger=${row.trigger_type} changed_on=${changedOnIso} agentWn=${agent.writingNumber} npn=${npn} rosterMapSize=${npnByWritingNumber.size}`);

    // Map trigger_type to GHL trigger label (at_risk → "at risk" for GHL field value).
    const triggerLabel = row.trigger_type === "at_risk" ? "at risk" : row.trigger_type;

    // ── NPN gate ──────────────────────────────────────────────────────────
    if (!npn) {
      npnHoldRows.push({
        policy_nbr:     pn,
        trigger_type:   row.trigger_type,
        changed_on:     changedOnIso,
        agency_id:      agencyId,
        agency_name:    agencyName,
        agent_name:     [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || null,
        writing_number: resolvedWn,
      });
      held++;
      console.log(`[lifecycle-direct] NPN hold: ${pn} wn=${resolvedWn} trigger=${row.trigger_type}`);
      continue;
    }

    const planName    = resolvePlanName(row.plan_code);
    const planType    = derivePlanType(planName || row.plan_code);
    const monthly     = perPaymentPremium(row.annual_premium, row.billing_mode, pn);
    const nameParts   = splitMiddleInitial(row.first_name ?? "");

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
      submission_date:      usDate(row.app_recvd_date),
      effective_date:       usDate(row.issue_date),
      paid_to_date:         usDate(row.paid_to_date),
      billing_mode:         billingModeLabel(row.billing_mode),
      at_risk_status:       row.at_risk_policy,
      client_status:        CONTRACT_STATUS[row.cntrct_code?.trim() ?? ""] ?? (row.cntrct_code ?? ""),
      policy_number:        pn,
      termination_date:     usDate(row.term_date),
      contract_reason:      contractReasonLabel(row.cntrct_reason ?? null),
      agent_npn:            npn,
      agency:               agencyName,
      carrier:              "UNL",
      agent_first_name:     agentFirst,
      agent_full_name:      agentFull,
      agent_writing_number: resolvedWn,
      trigger:              triggerLabel,
    };

    if (dry) {
      const dryBody = ghlConfig ? buildGhlContactBody(payload, ghlConfig.locationId) : null;
      console.log(`[lifecycle-direct:dry-run] ${triggerLabel} ${pn}`, JSON.stringify(dryBody ?? payload));
      if (singlePolicy) dryRunPayload = dryBody;
      auditRows.push({ policy_number: pn, trigger: triggerLabel, ok: true, dry_run: true, error: null, http_status: null, agency_id: agencyId, risk_signal: row.trigger_type === "at_risk" ? "at_risk_policy=true" : null, previous_contract_code: null, contract_code: row.cntrct_code, contract_reason: contractReasonLabel(row.cntrct_reason ?? null), upload_id: null });
      fired++;
      continue;
    }

    if (ghlConfig) {
      const body = buildGhlContactBody(payload, ghlConfig.locationId);
      const r    = await pushContactToGhl(ghlConfig, body);
      auditRows.push({ policy_number: pn, trigger: triggerLabel, ok: r.ok, dry_run: false, error: r.error, http_status: r.http_status, agency_id: agencyId, risk_signal: row.trigger_type === "at_risk" ? "at_risk_policy=true" : null, previous_contract_code: null, contract_code: row.cntrct_code, contract_reason: contractReasonLabel(row.cntrct_reason ?? null), upload_id: null });
      if (r.ok) {
        firedInserts.push({ policy_nbr: pn, trigger_type: row.trigger_type, changed_on: changedOnIso });
        firedSet.add(firedKey); // prevent duplicate within this run
      }
      fired++;
      // Rate limiter: 80 req / 10s — mirrors ghl-reconcile pattern
      if (fired % 80 === 0) {
        console.log(`[lifecycle-direct] rate-limit pause after ${fired} pushes (80/10s ceiling)`);
        await new Promise(r => setTimeout(r, 10_000));
      }
    } else {
      console.warn(`[lifecycle-direct] no GHL config; skipped ${triggerLabel} ${pn}`);
      auditRows.push({ policy_number: pn, trigger: triggerLabel, ok: false, dry_run: false, error: "no GHL config", http_status: null, agency_id: agencyId, risk_signal: null, previous_contract_code: null, contract_code: row.cntrct_code, contract_reason: null, upload_id: null });
    }
  }

  // ── 6. Persist fired_triggers + audit in bulk (best-effort) ──────────────
  if (!dry && firedInserts.length > 0) {
    try {
      for (let i = 0; i < firedInserts.length; i += 500) {
        const { error: ftErr } = await supabase
          .from("fired_triggers")
          .upsert(firedInserts.slice(i, i + 500), {
            onConflict: "policy_nbr,trigger_type,changed_on",
            ignoreDuplicates: true,
          });
        if (ftErr) console.error(`[lifecycle-direct] fired_triggers write failed: ${ftErr.message}`);
      }
      console.log(`[lifecycle-direct] fired_triggers written: ${firedInserts.length}`);
    } catch (e) {
      console.error("[lifecycle-direct] fired_triggers write error (non-fatal):", e);
    }
  } else if (dry) {
    console.log(`[lifecycle-direct] dry-run: skipping fired_triggers write (${firedInserts.length} would insert)`);
  }

  try {
    for (let i = 0; i < auditRows.length; i += 500) {
      await supabase.from("lifecycle_event_log").insert(auditRows.slice(i, i + 500));
    }
  } catch (e) {
    console.error("[lifecycle-direct] audit log write failed (non-fatal):", e);
  }

  // ── 7. Persist NPN holds (best-effort, non-fatal) ──────────────────────
  if (!dry && npnHoldRows.length > 0) {
    try {
      for (let i = 0; i < npnHoldRows.length; i += 500) {
        const { error: holdErr } = await supabase
          .from("npn_holds")
          .upsert(npnHoldRows.slice(i, i + 500), {
            onConflict: "policy_nbr,trigger_type,changed_on",
            ignoreDuplicates: true,
          });
        if (holdErr) console.error(`[lifecycle-direct] npn_holds write failed: ${holdErr.message}`);
      }
      console.log(`[lifecycle-direct] npn_holds written: ${npnHoldRows.length}`);
    } catch (e) {
      console.error("[lifecycle-direct] npn_holds write error (non-fatal):", e);
    }
  } else if (dry && npnHoldRows.length > 0) {
    console.log(`[lifecycle-direct] dry-run: would hold ${npnHoldRows.length} rows (npn_holds not written)`);
  }

  await writeCronRun({ fired, skipped });
  return new Response(
    JSON.stringify({ ok: true, fired, skipped, held, dry, cron_auth: isScheduledCron, deploy_sha: deployedSha, rows: triggerRows.length, ghl_config_present: !!ghlConfig, ...(singlePolicy ? { single_policy: singlePolicy } : {}), ...(dryRunPayload ? { dry_run_payload: dryRunPayload } : {}) }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
