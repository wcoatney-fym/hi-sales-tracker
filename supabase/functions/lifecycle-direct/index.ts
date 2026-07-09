import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
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

function usDate(d: string | null | undefined): string {
  if (!d) return "";
  const [y, m, day] = String(d).split("-");
  return y ? `${m}/${day}/${y}` : "";
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

function monthlyPremium(annual: number | null, billingMode: number | null): number {
  if (!annual) return 0;
  return Math.round((annual / 12) * 100) / 100;
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
  const parts = (node.name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  return {
    fullName: parts.join(" "),
    firstName: parts[0] ?? "",
    writingNumber: (node.writing_number ?? "").trim().toUpperCase(),
  };
}

// Depth-02 non-person node = sub-agency (maps to ancillary_agency__sorting).
function agencyFromHierarchy(hierarchy: HierarchyNode[] | null): string {
  if (!hierarchy) return "";
  const depth2 = hierarchy.filter((n) => n.depth === "02" && !n.is_person);
  if (depth2.length === 0) return "";
  return (depth2[0].name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function isDryRun(): boolean {
  try { return (Deno.env.get("LIFECYCLE_DRY_RUN") ?? "").toLowerCase() === "true"; } catch { return false; }
}

// ── Row shape from Max's DB ───────────────────────────────────────────────────
interface ProdRow {
  policy_nbr: string;
  first_name: string;
  last_name: string;
  cntrct_code: string | null;
  cntrct_reason: string | null;
  issue_date: string | null;
  paid_to_date: string | null;
  term_date: string | null;
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
  const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase     = createClient(supabaseUrl, serviceKey);

  // Verify cron secret (skip on OPTIONS).
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200 });
  }

  const cronSecret = req.headers.get("X-Cron-Secret") ?? "";
  if (cronSecret) {
    const { data: vault } = await supabase.rpc("get_cron_import_secret");
    if (!vault || vault !== cronSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
  }

  const dry = isDryRun();
  const ghlConfig = loadGhlConfig();
  const nowMs = Date.now();

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

  // ── 2. Build NPN lookup (agents table primary, agency_rosters fallback) ──
  const npnByWritingNumber = new Map<string, string>();

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
    .select("writing_number, npn")
    .eq("status", "active")
    .not("npn", "is", null)
    .neq("npn", "");
  for (const r of rosterList ?? []) {
    const wn = (r.writing_number as string ?? "").trim().toUpperCase();
    if (wn && r.npn && !npnByWritingNumber.has(wn)) {
      npnByWritingNumber.set(wn, r.npn as string);
    }
  }

  // ── 3. Load prior state from lifecycle_policy_state ──────────────────────
  const { data: priorRows } = await supabase
    .from("lifecycle_policy_state")
    .select("policy_number, cntrct_code, at_risk_policy, paid_to_date, agency_id");

  const priorState = new Map<string, PriorState & { agency_id: string | null }>();
  for (const r of priorRows ?? []) {
    priorState.set(r.policy_number as string, {
      contract_code: r.cntrct_code as string | null,
      at_risk_fired_at: null, // not needed: we use the at_risk_policy boolean directly
      agency_id: r.agency_id as string | null,
    });
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
    prodRows = await sql.unsafe(`
      SELECT
        TRIM(policy_nbr)            AS policy_nbr,
        TRIM(first_name)            AS first_name,
        TRIM(last_name)             AS last_name,
        TRIM(cntrct_code)           AS cntrct_code,
        TRIM(cntrct_reason)         AS cntrct_reason,
        issue_date,
        paid_to_date,
        term_date,
        billing_mode,
        annual_premium,
        TRIM(plan_code)             AS plan_code,
        TRIM(billing_form)          AS billing_form,
        at_risk_policy,
        roster_hierarchy_json,
        _dlt_load_id
      FROM typed.unl_fym_policy_latest_load
      WHERE plan_code ILIKE '%HI%'
         OR plan_code ILIKE '%HHC%'
         OR plan_code ILIKE '%GHI%'
         OR plan_code ILIKE '%HIP%'
    `) as ProdRow[];
  } finally {
    try { await sql.end(); } catch { /* ignore */ }
  }

  // ── 5. Evaluate + fire ────────────────────────────────────────────────────
  const stateUpserts: Record<string, unknown>[] = [];
  const auditRows:    Record<string, unknown>[] = [];
  let   fired = 0;
  let   skipped = 0;

  for (const row of prodRows) {
    const pn = (row.policy_nbr ?? "").trim();
    if (!pn) continue;

    // Resolve agency from hierarchy.
    const hierarchy = row.roster_hierarchy_json ?? [];
    const agencyName = agencyFromHierarchy(hierarchy);
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
      policy_effective_date: row.issue_date   ?? null,
      paid_to_date:          row.paid_to_date ?? null,
      contract_reason:       row.cntrct_reason ?? null,
    };

    const events: LifecycleEvent[] = computeLifecycleEvents(
      state,
      prior ? { contract_code: prior.contract_code, at_risk_fired_at: null } : undefined,
      nowMs,
    );

    // at-risk evaluation: use the DB-supplied boolean (Max computes it).
    const wasAtRisk = (prior as unknown as { at_risk_policy?: boolean } | null)?.at_risk_policy ?? false;
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
    const agent = agentFromHierarchy(hierarchy);
    const npn   = npnByWritingNumber.get(agent.writingNumber) ?? "";
    const planName = resolvePlanName(row.plan_code);
    const planType = derivePlanType(planName || row.plan_code);
    const monthly  = monthlyPremium(row.annual_premium, row.billing_mode);
    const atRiskStatus = row.at_risk_policy;

    for (const ev of events) {
      const payload: LifecyclePayload = {
        client_first_name:    (row.first_name ?? "").trim().replace(/\b\w/g, (c: string) => c.toUpperCase()),
        client_last_name:     (row.last_name  ?? "").trim().replace(/\b\w/g, (c: string) => c.toUpperCase()),
        phone:                "",
        email:                "",
        address:              "",
        city:                 "",
        state:                "",
        zip:                  "",
        plan_name:            planName,
        plan_type:            planType,
        plan_premium:         String(monthly),
        submission_date:      usDate(row.issue_date),
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
        carrier:              "United American",
        agent_first_name:     agent.firstName,
        agent_full_name:      agent.fullName,
        agent_writing_number: agent.writingNumber,
        trigger:              ev.trigger,
      };

      if (dry) {
        console.log(`[lifecycle-direct:dry-run] ${ev.trigger} ${pn}`, JSON.stringify(payload));
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
        fired++;
      }
    }
  }

  // ── 6. Persist state + audit in bulk (best-effort) ───────────────────────
  try {
    for (let i = 0; i < stateUpserts.length; i += 500) {
      await supabase
        .from("lifecycle_policy_state")
        .upsert(stateUpserts.slice(i, i + 500), { onConflict: "policy_number" });
    }
  } catch (e) {
    console.error("[lifecycle-direct] state upsert failed (non-fatal):", e);
  }

  try {
    for (let i = 0; i < auditRows.length; i += 500) {
      await supabase.from("lifecycle_event_log").insert(auditRows.slice(i, i + 500));
    }
  } catch (e) {
    console.error("[lifecycle-direct] audit log write failed (non-fatal):", e);
  }

  return new Response(
    JSON.stringify({ ok: true, fired, skipped, dry, rows: prodRows.length }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
