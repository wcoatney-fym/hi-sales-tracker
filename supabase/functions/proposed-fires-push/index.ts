import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { titleCase } from "../_shared/agency-map.ts";
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

// proposed-fires-push — reads proposed_fires WHERE approved_at IS NOT NULL AND
// fired_at IS NULL, fetches the current-state policy row from Max's DB, builds
// the GHL payload, pushes, then marks fired_at + inserts fired_triggers.
//
// Approval flow (mockup-phase — see docs/migration-mockup/migrations/002_npn_gate.sql):
//   1. npn-resolution flips npn_holds → resolved + writes proposed_fires
//   2. Human approves in admin portal (sets proposed_fires.approved_at)
//   3. This function picks up approved rows and fires
//   4. On success: proposed_fires.fired_at = NOW(), fired_triggers INSERT
//
// Best-effort: a GHL failure on one row doesn't abort the batch.
// Auth: CONFIRMATION_TOKEN header (same as lifecycle-direct).
// Dry-run: ?dry=true → builds payload + logs, no GHL push, no DB writes.

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

const CONFIRMATION_TOKEN = Deno.env.get("ACTIVITY_TRACKER_SECRET_KEY") ?? "";

// ── Helpers (mirrors lifecycle-direct) ───────────────────────────────────────

function cleanHost(raw: string): string {
  return raw.replace(/^https?:\/\//, "").replace(/\/$/, "").split(":")[0];
}

function usDate(d: unknown): string {
  if (d === null || d === undefined || d === "") return "";
  const dt = d instanceof Date ? d : new Date(String(d));
  if (isNaN(dt.getTime())) return "";
  const mm   = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd   = String(dt.getUTCDate()).padStart(2, "0");
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

function perPaymentPremium(annual: number | null, billingMode: number | null): number {
  if (!annual) return 0;
  const mode   = Number(billingMode ?? 1);
  const months = [1, 3, 6, 12].includes(mode) ? mode : 1;
  return Math.round(annual * (months / 12) * 100) / 100;
}

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
  return PLAN_CODE_MAP[(code ?? "").trim().toUpperCase()] ?? (code ?? "");
}

const CONTRACT_STATUS: Record<string, string> = {
  A: "Active", P: "Pending", T: "Terminated", S: "Suspended",
};

function splitMiddleInitial(rawFirst: string): { first: string; middleInitial: string } {
  const tokens = (rawFirst ?? "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    const bare = tokens[tokens.length - 1].replace(/\.$/, "");
    if (bare.length === 1 && /[A-Za-z]/.test(bare)) {
      return { first: titleCase(tokens.slice(0, -1).join(" ")), middleInitial: bare.toUpperCase() };
    }
  }
  return { first: titleCase(tokens.join(" ")), middleInitial: "" };
}

// ── Max DB row shape (fields we need for payload) ─────────────────────────────
interface MaxPolicyRow {
  policy_nbr:      string;
  first_name:      string;
  last_name:       string;
  phone_nbr:       string;
  cntrct_code:     string;
  cntrct_reason:   string | null;
  issue_date:      Date | string | null;
  app_recvd_date:  Date | string | null;
  paid_to_date:    Date | string | null;
  term_date:       Date | string | null;
  billing_mode:    number | null;
  annual_premium:  number | null;
  plan_code:       string;
  at_risk_policy:  boolean;
  wa_name:         string | null;
  issue_state:     string | null;
  zip:             string | null;
}

Deno.serve(async (req: Request) => {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const token = req.headers.get("x-confirmation-token") ?? req.headers.get("authorization")?.replace("Bearer ", "") ?? "";
  const isScheduledCron = req.headers.get("x-cron-auth") === CONFIRMATION_TOKEN;
  if (!isScheduledCron && token !== CONFIRMATION_TOKEN) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "true";

  const ghlConfig = loadGhlConfig();
  if (!ghlConfig) {
    return new Response(JSON.stringify({ error: "GHL config not present" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Supabase client ───────────────────────────────────────────────────────
  const supabase = createClient(
    Deno.env.get("ACTIVITY_TRACKER_SUPABASE_URL")!,
    Deno.env.get("ACTIVITY_TRACKER_SERVICE_ROLE_KEY")!,
  );

  // ── 1. Load agency name map (id → name) ───────────────────────────────────
  const agencyNameById = new Map<string, string>();
  {
    const { data: agencies } = await supabase
      .from("agencies")
      .select("id, name");
    for (const a of agencies ?? []) {
      agencyNameById.set(a.id as string, a.name as string);
    }
  }

  // ── 2. Load NPN name map (writing_number → {first, full}) ─────────────────
  const nameByWn = new Map<string, { first: string; full: string }>();
  {
    const AN = 1000; let anOff = 0;
    while (true) {
      const { data: ar } = await supabase
        .from("agents")
        .select("unl_writing_number, first_name, last_name")
        .range(anOff, anOff + AN - 1);
      for (const a of ar ?? []) {
        const wn = ((a.unl_writing_number as string) ?? "").trim().toUpperCase();
        if (!wn) continue;
        const first = (a.first_name as string ?? "").trim();
        const full  = `${first} ${(a.last_name as string ?? "").trim()}`.trim();
        nameByWn.set(wn, { first, full });
      }
      if (!ar || ar.length < AN) break;
      anOff += AN;
    }
    const { data: rr } = await supabase
      .from("agency_rosters")
      .select("writing_number, agent_name")
      .eq("status", "active");
    for (const r of rr ?? []) {
      const wn = ((r.writing_number as string) ?? "").trim().toUpperCase();
      if (!wn || nameByWn.has(wn)) continue;
      if (r.agent_name) {
        const parts = (r.agent_name as string).trim().split(/\s+/);
        nameByWn.set(wn, { first: parts[0] ?? "", full: (r.agent_name as string).trim() });
      }
    }
  }

  // ── 3. Load approved proposed_fires ──────────────────────────────────────
  const PAGE = 500;
  let offset = 0;
  const pendingRows: Record<string, unknown>[] = [];
  while (true) {
    const { data: rows, error: fetchErr } = await supabase
      .from("proposed_fires")
      .select("id, policy_nbr, trigger_type, changed_on, agency_id, agent_npn, writing_number")
      .not("approved_at", "is", null)
      .is("fired_at", null)
      .range(offset, offset + PAGE - 1);
    if (fetchErr) { console.error(`[proposed-fires-push] fetch failed: ${fetchErr.message}`); break; }
    if (!rows || rows.length === 0) break;
    pendingRows.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  console.log(`[proposed-fires-push] approved rows to push: ${pendingRows.length}`);

  if (pendingRows.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, dry, pushed: 0, failed: 0, message: "no approved proposed_fires pending" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // ── 4. Fetch current-state rows from Max's DB ────────────────────────────
  const policyNbrs = [...new Set(pendingRows.map((r) => String(r.policy_nbr ?? "").trim()).filter(Boolean))];

  const { default: postgres } = await import("npm:postgres@3.4.5");
  const sql = postgres({
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

  const maxRowByPolicy = new Map<string, MaxPolicyRow>();
  try {
    await sql.unsafe("SET statement_timeout = '60s'");
    // Fetch in batches of 500 to stay under Postgres param limit
    const BATCH = 500;
    for (let i = 0; i < policyNbrs.length; i += BATCH) {
      const batch = policyNbrs.slice(i, i + BATCH);
      const rows = await sql.unsafe(`
        SELECT
          TRIM(policy_nbr)      AS policy_nbr,
          TRIM(first_name)      AS first_name,
          TRIM(last_name)       AS last_name,
          TRIM(phone_nbr::text)  AS phone_nbr,
          TRIM(cntrct_code)     AS cntrct_code,
          TRIM(cntrct_reason)   AS cntrct_reason,
          issue_date, app_recvd_date, paid_to_date, term_date,
          billing_mode, annual_premium,
          TRIM(plan_code)       AS plan_code,
          at_risk_policy,
          TRIM(wa_name)         AS wa_name,
          TRIM(issue_state)     AS issue_state,
          TRIM(zip)             AS zip
        FROM typed.unl_fym_policy_latest_load
        WHERE TRIM(policy_nbr) = ANY(${ batch.map((_, j) => `$${j + 1}`).join(",") })
      `, batch) as MaxPolicyRow[];
      for (const r of rows) {
        maxRowByPolicy.set((r.policy_nbr ?? "").trim(), r);
      }
    }
    console.log(`[proposed-fires-push] Max DB rows loaded: ${maxRowByPolicy.size} of ${policyNbrs.length}`);
  } finally {
    try { await sql.end(); } catch { /* ignore */ }
  }

  // ── 5. Push each approved row ─────────────────────────────────────────────
  let pushed  = 0;
  let failed  = 0;
  const firedIds:     number[] = [];
  const firedInserts: { policy_nbr: string; trigger_type: string; changed_on: string }[] = [];
  const auditRows:    Record<string, unknown>[] = [];

  for (const pf of pendingRows) {
    const pn         = String(pf.policy_nbr  ?? "").trim();
    const triggerType = String(pf.trigger_type ?? "").trim();
    const changedOn  = String(pf.changed_on  ?? "").slice(0, 10);
    const agencyId   = pf.agency_id as string ?? null;
    const npn        = String(pf.agent_npn   ?? "").trim();
    const wn         = String(pf.writing_number ?? "").trim().toUpperCase();
    const agencyName = agencyId ? (agencyNameById.get(agencyId) ?? "") : "";

    const maxRow = maxRowByPolicy.get(pn);
    if (!maxRow) {
      console.warn(`[proposed-fires-push] no Max DB row for policy ${pn} — skipping`);
      auditRows.push({ policy_number: pn, trigger: triggerType, ok: false, dry_run: dry, error: "policy not found in Max DB", http_status: null, agency_id: agencyId, risk_signal: null, previous_contract_code: null, contract_code: null, contract_reason: null, upload_id: null });
      failed++;
      continue;
    }

    const nameParts  = splitMiddleInitial(maxRow.first_name ?? "");
    const planName   = resolvePlanName(maxRow.plan_code);
    const planType   = derivePlanType(planName || maxRow.plan_code);
    const monthly    = perPaymentPremium(maxRow.annual_premium, maxRow.billing_mode);
    const rosterName = nameByWn.get(wn);
    // wa_name from Max's DB is full name; split first token for first name
    const waNameStr  = (maxRow.wa_name ?? "").trim();
    const agentFirst = rosterName?.first ?? (waNameStr ? waNameStr.split(/\s+/)[0] : "");
    const agentFull  = rosterName?.full  ?? waNameStr;

    // GHL trigger label: at_risk (stored) → "at risk" (GHL field value)
    const triggerLabel = triggerType === "at_risk" ? "at risk" : triggerType;

    const payload: LifecyclePayload = {
      client_first_name:    nameParts.first,
      middle_initial:       nameParts.middleInitial,
      client_last_name:     titleCase((maxRow.last_name ?? "").trim()),
      phone:                (maxRow.phone_nbr ?? "").trim(),
      email:                "",
      address:              "",
      city:                 "",
      state:                (maxRow.issue_state ?? "").trim(),
      zip:                  (maxRow.zip ?? "").trim(),
      plan_name:            planName,
      plan_type:            planType,
      plan_premium:         String(monthly),
      submission_date:      usDate(maxRow.app_recvd_date),
      effective_date:       usDate(maxRow.issue_date),
      paid_to_date:         usDate(maxRow.paid_to_date),
      billing_mode:         billingModeLabel(maxRow.billing_mode),
      at_risk_status:       maxRow.at_risk_policy,
      client_status:        CONTRACT_STATUS[maxRow.cntrct_code?.trim() ?? ""] ?? (maxRow.cntrct_code ?? ""),
      policy_number:        pn,
      termination_date:     usDate(maxRow.term_date),
      contract_reason:      contractReasonLabel(maxRow.cntrct_reason ?? null),
      agent_npn:            npn,
      agency:               agencyName,
      carrier:              "UNL",
      agent_first_name:     agentFirst,
      agent_full_name:      agentFull,
      agent_writing_number: wn,
      trigger:              triggerLabel,
    };

    if (dry) {
      const dryBody = buildGhlContactBody(payload, ghlConfig.locationId);
      console.log(`[proposed-fires-push:dry-run] ${triggerLabel} ${pn}`, JSON.stringify(dryBody));
      auditRows.push({ policy_number: pn, trigger: triggerLabel, ok: true, dry_run: true, error: null, http_status: null, agency_id: agencyId, risk_signal: triggerType === "at_risk" ? "at_risk_policy=true" : null, previous_contract_code: null, contract_code: maxRow.cntrct_code, contract_reason: contractReasonLabel(maxRow.cntrct_reason ?? null), upload_id: null });
      pushed++;
      continue;
    }

    const body = buildGhlContactBody(payload, ghlConfig.locationId);
    const r    = await pushContactToGhl(ghlConfig, body);
    auditRows.push({ policy_number: pn, trigger: triggerLabel, ok: r.ok, dry_run: false, error: r.error, http_status: r.http_status, agency_id: agencyId, risk_signal: triggerType === "at_risk" ? "at_risk_policy=true" : null, previous_contract_code: null, contract_code: maxRow.cntrct_code, contract_reason: contractReasonLabel(maxRow.cntrct_reason ?? null), upload_id: null });

    if (r.ok) {
      pushed++;
      firedIds.push(pf.id as number);
      firedInserts.push({ policy_nbr: pn, trigger_type: triggerType, changed_on: changedOn });
    } else {
      failed++;
      console.warn(`[proposed-fires-push] GHL push failed for ${pn}: ${r.error}`);
    }
  }

  // ── 6. Mark fired_at + write fired_triggers + audit (best-effort) ─────────
  if (!dry) {
    const now = new Date().toISOString();

    if (firedIds.length > 0) {
      try {
        for (let i = 0; i < firedIds.length; i += 500) {
          const { error: fErr } = await supabase
            .from("proposed_fires")
            .update({ fired_at: now })
            .in("id", firedIds.slice(i, i + 500));
          if (fErr) console.error(`[proposed-fires-push] proposed_fires fired_at update failed: ${fErr.message}`);
        }
      } catch (e) { console.error("[proposed-fires-push] proposed_fires update error (non-fatal):", e); }

      try {
        for (let i = 0; i < firedInserts.length; i += 500) {
          const { error: ftErr } = await supabase
            .from("fired_triggers")
            .upsert(firedInserts.slice(i, i + 500), { onConflict: "policy_nbr,trigger_type,changed_on", ignoreDuplicates: true });
          if (ftErr) console.error(`[proposed-fires-push] fired_triggers write failed: ${ftErr.message}`);
        }
      } catch (e) { console.error("[proposed-fires-push] fired_triggers write error (non-fatal):", e); }
    }

    if (auditRows.length > 0) {
      try {
        for (let i = 0; i < auditRows.length; i += 500) {
          await supabase.from("lifecycle_event_log").insert(auditRows.slice(i, i + 500));
        }
      } catch (e) { console.error("[proposed-fires-push] audit write error (non-fatal):", e); }
    }
  }

  console.log(`[proposed-fires-push] done — pushed=${pushed} failed=${failed} dry=${dry}`);
  return new Response(
    JSON.stringify({ ok: true, dry, pushed, failed, total: pendingRows.length }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
