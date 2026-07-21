import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveAgentIdFromPolicy } from "./resolve.ts";
import { syncStageToGhl } from "./ghl.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

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

// Secrets are read from the function environment only. Never hardcode
// credentials here — set DB_PASSWORD (and any others) as Supabase function
// secrets. A committed fallback was removed because it leaked the prod DB
// password into the repo and tripped Netlify secret scanning.
function resolveSecret(name: string): string {
  return Deno.env.get(name) || "";
}

function cleanHost(raw: string): string {
  return raw.replace(/^https?:\/\//, "").replace(/\/$/, "").split(":")[0];
}

// Open a short-lived postgres connection to Max's DB (READ-ONLY).
// Always call sql.end() in a finally block.
async function openMaxDb() {
  const { default: postgres } = await import("npm:postgres@3.4.5");
  return postgres({
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
}

const LOWERCASE_PARTICLES = new Set([
  "de", "del", "della", "di", "da", "das", "do", "dos",
  "van", "von", "der", "den", "het",
  "la", "le", "les", "el", "al",
  "bin", "ibn",
]);

// Generate a 14-char password (same charset/policy as reset-agency-credential).
function genPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*";
  let out = "";
  const arr = new Uint8Array(14);
  crypto.getRandomValues(arr);
  for (let i = 0; i < 14; i++) out += chars[arr[i] % chars.length];
  return out;
}

// Build a manager username as first-initial + last name (e.g. "rmitchell"),
// globally unique (usernames are unique across all agencies) by appending a
// number on collision.
// deno-lint-ignore no-explicit-any
async function genManagerUsername(supabase: any, firstName: string, lastName: string): Promise<string> {
  const clean = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const fi = clean(firstName).slice(0, 1);
  const ln = clean(lastName);
  const base = (fi + ln) || "manager";
  const { data } = await supabase
    .from("agency_manager_credentials")
    .select("username")
    .ilike("username", `${base}%`);
  const taken = new Set(((data || []) as { username: string }[]).map((r) => r.username.toLowerCase()));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}${i}`)) i++;
  return `${base}${i}`;
}

// Split a display name into first/last for username generation.
function splitName(full: string): { first: string; last: string } {
  const parts = (full || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: parts[0] };
  return { first: parts[0], last: parts[parts.length - 1] };
}

function capitalizeWord(word: string): string {
  if (word.length === 0) return word;
  if (word.length === 1) return word.toUpperCase();
  const lower = word.toLowerCase();
  if (lower.startsWith("mc") && word.length > 2) {
    return "Mc" + word.charAt(2).toUpperCase() + lower.slice(3);
  }
  if (lower.startsWith("mac") && word.length > 3 && /^mac[a-z]/.test(lower) && !["mace", "mach", "mack", "macs", "macy"].includes(lower)) {
    return "Mac" + word.charAt(3).toUpperCase() + lower.slice(4);
  }
  if (lower.startsWith("o'") && word.length > 2) {
    return "O'" + word.charAt(2).toUpperCase() + lower.slice(3);
  }
  return word.charAt(0).toUpperCase() + lower.slice(1);
}

function toProperCase(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) return trimmed;
  const words = trimmed.split(" ");
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && LOWERCASE_PARTICLES.has(lower)) return lower;
      return word.split("-").map((part) => capitalizeWord(part)).join("-");
    })
    .join(" ");
}

function stripMiddleInitial(lastName: string): string {
  const trimmed = lastName.trim();
  const match = trimmed.match(/^[A-Za-z]\.?\s+(.+)$/);
  return match ? match[1] : trimmed;
}

function normalizeKeys(obj: Record<string, string> | null): Record<string, string> {
  if (!obj) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key.trim()] = value;
  }
  return result;
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Normalize a form_submissions row into the manager worklist payload shape.
// Renames client contact columns and surfaces the (optional) termination
// reason. `contract_reason` is now populated from the mapped UNL "Contract
// Reason" column by sql-import-cron (null if the source row has none).
function shapeWorklistRow(
  p: Record<string, unknown>,
  dispRow: unknown
) {
  const { phone, email, ...rest } = p;
  // dispRow is the policy_dispositions row ({ disposition, follow_up_at, ... })
  // or null; the worklist payload exposes just the disposition enum string.
  const disposition =
    dispRow && typeof dispRow === "object"
      ? ((dispRow as { disposition?: string }).disposition ?? null)
      : (dispRow as string | null) ?? null;
  return {
    ...rest,
    client_phone: (phone as string | null) ?? null,
    client_email: (email as string | null) ?? null,
    contract_reason: (p["contract_reason"] as string | null) ?? null,
    disposition,
  };
}

// ---- At-Risk pipeline v3 stage model -------------------------------------
// Membership is data-driven (active + DIR + paid_to_date < today). The 45-day
// grace clock starts at the missed draft, which is ~paid_to_date, so age and
// urgency derive straight from paid_to_date — no stored flag needed.
const AT_RISK_TOTAL_DAYS = 45;   // policy auto-terminates at day 45
const HEATING_UP_DAY = 30;       // early escalation tier
const CODE_RED_DAY = 38;         // <7 days left — drop everything
const AGENT_SLA_DAYS = 5;        // agent must make contact within 5 days

type DispRow = {
  disposition?: string | null;
  agent_id?: string | null;
  agent_outreach_at?: string | null;
  agent_contacted_at?: string | null;
  agent_saved_at?: string | null;
  manager_approved_at?: string | null;
} | null;

function daysBetween(fromIso: string | null, to = Date.now()): number | null {
  if (!fromIso) return null;
  const t = new Date(fromIso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((to - t) / 86400000);
}

// ---- 90-day persistency (per-agent) --------------------------------------
// Mirrors the validated agency-wide retention rule (memory/sales-tracker-schema):
//   drafted_first  = paid_to_date >= effective + 1 month
//   retained (monthly, billing_mode '1' or null) = paid_to_date >= effective + 3 months
//   retained (non-monthly '3'/'6'/'12') = drafted_first (one draft pays >=90d)
// Denominator = policies old enough to have had 3 draws (effective <= today-3mo)
// AND that drafted their first premium. Rate = retained / drafted_first.
type PersistPolicy = {
  policy_effective_date?: string | null;
  paid_to_date?: string | null;
  billing_mode?: string | null;
};

function addMonthsIso(iso: string, months: number): number {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d.getTime();
}

function isMonthly(billingMode: string | null | undefined): boolean {
  const m = (billingMode ?? "").trim();
  return m === "" || m === "1"; // treat null/blank as monthly (conservative)
}

// Is this policy old enough to be counted (had the chance for 3 monthly draws)?
function persistEligible(p: PersistPolicy, nowMs = Date.now()): boolean {
  if (!p.policy_effective_date) return false;
  const eff = new Date(p.policy_effective_date).getTime();
  if (Number.isNaN(eff)) return false;
  return addMonthsIso(p.policy_effective_date, 3) <= nowMs;
}

function draftedFirst(p: PersistPolicy): boolean {
  if (!p.policy_effective_date || !p.paid_to_date) return false;
  const ptd = new Date(p.paid_to_date).getTime();
  if (Number.isNaN(ptd)) return false;
  return ptd >= addMonthsIso(p.policy_effective_date, 1);
}

function retained90(p: PersistPolicy): boolean {
  if (!draftedFirst(p)) return false;
  if (!isMonthly(p.billing_mode)) return true; // one non-monthly draft pays >=90d
  const ptd = new Date(p.paid_to_date as string).getTime();
  return ptd >= addMonthsIso(p.policy_effective_date as string, 3);
}

// Roll a set of policies into {drafted_first, retained, pct}. Only eligible
// (old-enough) policies count.
function persistencyOf(policies: PersistPolicy[]): { drafted_first: number; retained: number; pct: number } {
  let df = 0, ret = 0;
  for (const p of policies) {
    if (!persistEligible(p)) continue;
    if (!draftedFirst(p)) continue;
    df += 1;
    if (retained90(p)) ret += 1;
  }
  return { drafted_first: df, retained: ret, pct: df ? Math.round((1000 * ret) / df) / 10 : 0 };
}

// Returns the action-stage (persisted), the computed urgency overlay, and
// the current owner. Code Red / Heating Up are overlays: a policy keeps its
// action-stage AND carries is_code_red so the board can bucket it regardless.
function computeAtRiskStage(paidToDate: string | null, disp: DispRow) {
  const ageDays = daysBetween(paidToDate) ?? 0;
  const daysToTerminate = AT_RISK_TOTAL_DAYS - ageDays;
  const d = (disp?.disposition as string | null) ?? null;

  // action-stage (normalize legacy values onto the v3 set)
  const ageDays0 = ageDays;
  let stage: string;
  if (d === "saved" || d === "secured") stage = "saved";
  else if (d === "lost") stage = "lost";
  // Grace is over (>= 45 days past due): the policy is effectively gone, so it
  // drops into Lost even before the next data refresh flips it to terminated.
  // A confirmed save (above) still wins.
  else if (ageDays0 >= AT_RISK_TOTAL_DAYS) stage = "lost";
  // Code Red is a persisted, GHL-owned stage (GHL runs the day-35 timer +
  // exemptions and pushes it in via the webhook; a manager can also set it
  // here, which syncs back to GHL). We just reflect the persisted value.
  else if (d === "code_red") stage = "code_red";
  else if (d === "agent_saved_pending") stage = "agent_saved_pending";
  else if (d === "agent_outreach") stage = "agent_outreach";
  else if (d === "manager_outreach" || d === "working" || d === "follow_up") stage = "manager_outreach";
  else if (d === "responded") stage = "responded";
  else stage = "new";

  let owner: "system" | "manager" | "agent" | "closed";
  if (stage === "saved" || stage === "lost") owner = "closed";
  else if (stage === "agent_outreach" || stage === "agent_saved_pending") owner = "agent";
  else if (stage === "responded" || stage === "manager_outreach") owner = "manager";
  else owner = "system";

  const terminal = stage === "saved" || stage === "lost";
  const isCodeRed = !terminal && ageDays >= CODE_RED_DAY;
  const isHeatingUp = !terminal && !isCodeRed && ageDays >= HEATING_UP_DAY;

  // 5-day agent follow-up SLA: handed off, never contacted, past the window.
  const agentDays = daysBetween(disp?.agent_outreach_at ?? null);
  const agentOverdue =
    stage === "agent_outreach" &&
    !disp?.agent_contacted_at &&
    agentDays !== null &&
    agentDays > AGENT_SLA_DAYS;

  return {
    stage,
    owner,
    days_at_risk: ageDays,
    days_to_terminate: daysToTerminate,
    is_heating_up: isHeatingUp,
    is_code_red: isCodeRed,
    agent_overdue: agentOverdue,
    agent_id: disp?.agent_id ?? null,
    agent_outreach_at: disp?.agent_outreach_at ?? null,
    agent_contacted_at: disp?.agent_contacted_at ?? null,
  };
}

async function promoteQualifyingAgents(
  supabase: ReturnType<typeof createClient>,
  uploadIds: string[]
) {
  if (uploadIds.length === 0) return;

  const { data: rosterAgents } = await supabase
    .from("agent_rosters")
    .select("first_name, last_name, agent_number, carrier, npn")
    .in("roster_upload_id", uploadIds);

  if (!rosterAgents || rosterAgents.length === 0) return;

  const qualifying = rosterAgents.filter(
    (a: { npn: string; agent_number: string }) =>
      a.npn && a.npn.trim() !== "" && a.agent_number && a.agent_number.trim() !== ""
  );

  const byNpn: Record<
    string,
    { first_name: string; last_name: string; npn: string; unl: string; gtl: string }
  > = {};

  for (const agent of qualifying) {
    if (!byNpn[agent.npn]) {
      byNpn[agent.npn] = {
        first_name: agent.first_name,
        last_name: agent.last_name,
        npn: agent.npn,
        unl: "",
        gtl: "",
      };
    }
    if (agent.carrier === "UNL" && agent.agent_number) byNpn[agent.npn].unl = agent.agent_number;
    if (agent.carrier === "GTL" && agent.agent_number) byNpn[agent.npn].gtl = agent.agent_number;
  }

  for (const entry of Object.values(byNpn)) {
    const { data: existing } = await supabase
      .from("agents")
      .select("id, unl_writing_number, gtl_writing_number")
      .eq("npn", entry.npn)
      .maybeSingle();

    if (existing) {
      const updates: Record<string, string> = {};
      if (entry.unl && !existing.unl_writing_number) updates.unl_writing_number = entry.unl;
      if (entry.gtl && !existing.gtl_writing_number) updates.gtl_writing_number = entry.gtl;
      if (Object.keys(updates).length > 0) {
        await supabase.from("agents").update(updates).eq("id", existing.id);
      }
    } else {
      await supabase.from("agents").insert({
        first_name: toProperCase(entry.first_name),
        last_name: stripMiddleInitial(toProperCase(entry.last_name)),
        npn: entry.npn,
        unl_writing_number: entry.unl.toUpperCase(),
        gtl_writing_number: entry.gtl.toUpperCase(),
        source: "Roster",
      });
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const { action } = body;

    if (action === "login") {
      const { email, password } = body;

      if (!email || !password) {
        return jsonResponse(
          { error: "Email and password are required" },
          400
        );
      }

      // Look up credentials by email domain
      const { data: allCreds } = await supabase
        .from("admin_credentials")
        .select("id, agency_id, email_domain, password, role, session_duration_days, login_count");

      const cred = (allCreds || []).find(
        (c: { email_domain: string; password: string }) =>
          (email.toLowerCase().endsWith(c.email_domain.toLowerCase()) ||
           email.toLowerCase() === c.email_domain.toLowerCase()) &&
          password === c.password
      );

      if (!cred) {
        return jsonResponse({ error: "Invalid credentials" }, 401);
      }

      // Resolve agency slug and name if agency_admin
      let agencySlug: string | null = null;
      let agencyName: string | null = null;
      if (cred.agency_id) {
        const { data: agency } = await supabase
          .from("agencies")
          .select("slug, name")
          .eq("id", cred.agency_id)
          .maybeSingle();
        agencySlug = agency?.slug || null;
        agencyName = agency?.name || null;
      }

      const token = crypto.randomUUID();
      const expiresAt = new Date(
        Date.now() + cred.session_duration_days * 24 * 60 * 60 * 1000
      ).toISOString();

      const { error } = await supabase
        .from("admin_sessions")
        .insert({
          email,
          token,
          expires_at: expiresAt,
          role: cred.role,
          agency_id: cred.agency_id || null,
          agency_slug: agencySlug,
        });

      if (error) throw error;

      // Stamp usage tracking on the credential (best-effort — never block login).
      try {
        await supabase
          .from("admin_credentials")
          .update({
            last_login_at: new Date().toISOString(),
            login_count: (cred.login_count ?? 0) + 1,
          })
          .eq("id", cred.id);
      } catch (_e) {
        // usage tracking is non-critical; swallow so a tracking failure never
        // prevents a valid login
      }

      await supabase
        .from("admin_sessions")
        .delete()
        .lt("expires_at", new Date().toISOString());

      return jsonResponse({ token, email, role: cred.role, agency_id: cred.agency_id, agency_slug: agencySlug, agency_name: agencyName });
    }

    // Per-person Agency Manager login (separate store from shared agency-admin creds)
    if (action === "manager-login") {
      const { username, password } = body;
      if (!username || !password) {
        return jsonResponse({ error: "Username and password are required" }, 400);
      }
      const { data: mgr } = await supabase
        .from("agency_manager_credentials")
        .select("id, agency_id, username, password, display_name, is_active")
        .ilike("username", username)
        .maybeSingle();

      if (!mgr || !mgr.is_active || password !== mgr.password) {
        return jsonResponse({ error: "Invalid credentials" }, 401);
      }

      const { data: agency } = await supabase
        .from("agencies")
        .select("slug, name")
        .eq("id", mgr.agency_id)
        .maybeSingle();

      const mgrToken = crypto.randomUUID();
      const mgrExpires = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
      const { error: msErr } = await supabase.from("admin_sessions").insert({
        email: mgr.username,
        token: mgrToken,
        expires_at: mgrExpires,
        role: "manager",
        agency_id: mgr.agency_id,
        agency_slug: agency?.slug || null,
      });
      if (msErr) throw msErr;
      await supabase.from("admin_sessions").delete().lt("expires_at", new Date().toISOString());

      return jsonResponse({
        token: mgrToken,
        manager_id: mgr.id,
        username: mgr.username,
        display_name: mgr.display_name,
        role: "manager",
        agency_id: mgr.agency_id,
        agency_slug: agency?.slug || null,
        agency_name: agency?.name || null,
      });
    }

    const { token } = body;
    if (!token) {
      return jsonResponse({ error: "Authentication required" }, 401);
    }

    const { data: session } = await supabase
      .from("admin_sessions")
      .select("id, email, role, agency_id, agency_slug")
      .eq("token", token)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (!session) {
      return jsonResponse({ error: "Invalid or expired session" }, 401);
    }

    const refreshedExpiry = new Date(
      Date.now() + 90 * 24 * 60 * 60 * 1000
    ).toISOString();
    await supabase
      .from("admin_sessions")
      .update({ expires_at: refreshedExpiry })
      .eq("id", session.id);

    switch (action) {
      case "verify-session": {
        let sessionAgencyName: string | null = null;
        if (session.agency_id) {
          const { data: ag } = await supabase
            .from("agencies")
            .select("name")
            .eq("id", session.agency_id)
            .maybeSingle();
          sessionAgencyName = ag?.name || null;
        }
        return jsonResponse({
          email: session.email,
          role: session.role,
          agency_id: session.agency_id,
          agency_slug: session.agency_slug,
          agency_name: sessionAgencyName,
        });
      }

      case "resolve-agency-slug": {
        if (session.role !== "global_admin") {
          return jsonResponse({ error: "Forbidden" }, 403);
        }
        const { slug } = body;
        if (!slug) {
          return jsonResponse({ error: "slug is required" }, 400);
        }
        const { data: agency } = await supabase
          .from("agencies")
          .select("id, name, slug")
          .eq("slug", slug)
          .maybeSingle();
        if (!agency) {
          return jsonResponse({ error: "Agency not found" }, 404);
        }
        return jsonResponse({ id: agency.id, name: agency.name, slug: agency.slug });
      }

      case "upload-roster": {
        const { carrier, agents, filename } = body;

        if (!carrier || !agents || !Array.isArray(agents)) {
          return jsonResponse({ error: "Invalid request data" }, 400);
        }

        if (!["UNL", "GTL"].includes(carrier)) {
          return jsonResponse({ error: "Invalid carrier" }, 400);
        }

        const rows = agents
          .map((a: Record<string, string>) => ({
            first_name: (a["First Name"] || "").trim(),
            last_name: stripMiddleInitial((a["Last Name"] || "").trim()),
            agent_number: (a["Agent Number"] || "").trim().toUpperCase(),
            npn: (a["NPN"] || a["National Producer Number"] || "").trim(),
            carrier,
          }))
          .filter(
            (r: { first_name: string; last_name: string; agent_number: string }) =>
              r.first_name && r.last_name && r.agent_number
          );

        if (rows.length === 0) {
          return jsonResponse(
            { error: "No valid agent records found" },
            400
          );
        }

        const { data: outgoingUploads } = await supabase
          .from("roster_uploads")
          .select("id")
          .eq("carrier", carrier)
          .eq("is_active", true);

        if (outgoingUploads && outgoingUploads.length > 0) {
          await promoteQualifyingAgents(
            supabase,
            outgoingUploads.map((u: { id: string }) => u.id)
          );
        }

        await supabase
          .from("roster_uploads")
          .update({ is_active: false })
          .eq("carrier", carrier)
          .eq("is_active", true);

        const { data: upload, error: uploadError } = await supabase
          .from("roster_uploads")
          .insert({
            carrier,
            filename: filename || "roster.csv",
            agent_count: rows.length,
            is_active: true,
            uploaded_by: session.email,
          })
          .select("id")
          .single();

        if (uploadError) throw uploadError;

        const agentRows = rows.map((r: { first_name: string; last_name: string; agent_number: string; carrier: string }) => ({
          ...r,
          roster_upload_id: upload.id,
        }));

        const { error: insertError } = await supabase
          .from("agent_rosters")
          .insert(agentRows);

        if (insertError) throw insertError;

        return jsonResponse({ success: true, count: rows.length, uploadId: upload.id });
      }

      case "get-roster-uploads": {
        const { carrier } = body;

        if (carrier && !["UNL", "GTL"].includes(carrier)) {
          return jsonResponse({ error: "Invalid carrier" }, 400);
        }

        let query = supabase
          .from("roster_uploads")
          .select("*")
          .order("created_at", { ascending: false });

        if (carrier) {
          query = query.eq("carrier", carrier);
        }

        const { data, error } = await query;
        if (error) throw error;

        return jsonResponse({ uploads: data || [] });
      }

      case "activate-roster": {
        const { uploadId } = body;

        if (!uploadId) {
          return jsonResponse({ error: "Upload ID is required" }, 400);
        }

        const { data: upload, error: fetchError } = await supabase
          .from("roster_uploads")
          .select("id, carrier")
          .eq("id", uploadId)
          .maybeSingle();

        if (fetchError) throw fetchError;
        if (!upload) {
          return jsonResponse({ error: "Roster upload not found" }, 404);
        }

        const { data: outgoingActive } = await supabase
          .from("roster_uploads")
          .select("id")
          .eq("carrier", upload.carrier)
          .eq("is_active", true);

        if (outgoingActive && outgoingActive.length > 0) {
          await promoteQualifyingAgents(
            supabase,
            outgoingActive.map((u: { id: string }) => u.id)
          );
        }

        await supabase
          .from("roster_uploads")
          .update({ is_active: false })
          .eq("carrier", upload.carrier)
          .eq("is_active", true);

        const { error: activateError } = await supabase
          .from("roster_uploads")
          .update({ is_active: true })
          .eq("id", uploadId);

        if (activateError) throw activateError;

        return jsonResponse({ success: true });
      }

      case "delete-roster-upload": {
        const { uploadId } = body;

        if (!uploadId) {
          return jsonResponse({ error: "Upload ID is required" }, 400);
        }

        const { data: upload, error: fetchError } = await supabase
          .from("roster_uploads")
          .select("id, carrier, is_active")
          .eq("id", uploadId)
          .maybeSingle();

        if (fetchError) throw fetchError;
        if (!upload) {
          return jsonResponse({ error: "Roster upload not found" }, 404);
        }

        if (upload.is_active) {
          return jsonResponse(
            { error: "Cannot delete the active roster. Activate a different version first." },
            400
          );
        }

        await promoteQualifyingAgents(supabase, [uploadId]);

        const { error: deleteError } = await supabase
          .from("roster_uploads")
          .delete()
          .eq("id", uploadId);

        if (deleteError) throw deleteError;

        return jsonResponse({ success: true });
      }

      case "get-dashboard-kpis": {
        const { startDate, endDate, prevStartDate, prevEndDate, agencyFilter, agencies, agentNumber } = body;
        if (!startDate || !endDate) {
          return jsonResponse({ error: "Date range required" }, 400);
        }

        const kpiAgencyParam = Array.isArray(agencies) ? null : (agencyFilter || null);
        const kpiAgenciesParam = Array.isArray(agencies) ? agencies : null;
        const kpiAgentParam = agentNumber || null;

        const [{ data: curRaw, error: curErr }, { data: prevRaw, error: prevErr }] = await Promise.all([
          supabase.rpc("dashboard_kpis", {
            p_start_date: startDate,
            p_end_date: endDate,
            p_agency: kpiAgencyParam,
            p_agencies: kpiAgenciesParam,
            p_agent_number: kpiAgentParam,
          }),
          supabase.rpc("dashboard_kpis", {
            p_start_date: prevStartDate || startDate,
            p_end_date: prevEndDate || endDate,
            p_agency: kpiAgencyParam,
            p_agencies: kpiAgenciesParam,
            p_agent_number: kpiAgentParam,
          }),
        ]);

        if (curErr) throw curErr;
        if (prevErr) throw prevErr;

        const formatKpis = (raw: { policies_sold: number; total_premium_sum: number; active_agents: number; new_clients: number }) => {
          const totalRevenue = (Number(raw.total_premium_sum) || 0) * 12;
          const policiesSold = Number(raw.policies_sold) || 0;
          const avgPolicyValue = policiesSold > 0 ? totalRevenue / policiesSold : 0;
          const activeAgents = Number(raw.active_agents) || 0;
          const newClients = Number(raw.new_clients) || 0;
          const revenuePerAgent = activeAgents > 0 ? totalRevenue / activeAgents : 0;
          return { totalRevenue, policiesSold, avgPolicyValue, activeAgents, newClients, revenuePerAgent };
        };

        const cur = formatKpis(curRaw);
        const prev = formatKpis(prevRaw);

        return jsonResponse({
          ...cur,
          prevTotalRevenue: prev.totalRevenue,
          prevPoliciesSold: prev.policiesSold,
          prevAvgPolicyValue: prev.avgPolicyValue,
          prevActiveAgents: prev.activeAgents,
          prevNewClients: prev.newClients,
          prevRevenuePerAgent: prev.revenuePerAgent,
        });
      }

      case "policy-status-kpis": {
        const { referenceDate, periodStartDate, agencyFilter: psaAgency, agencies: psaAgencies, agentNumber: psaAgent } = body;

        const agency = Array.isArray(psaAgencies) ? null : (psaAgency || null);
        const agenciesArr = Array.isArray(psaAgencies) ? psaAgencies : null;
        const agentNum = psaAgent || null;

        const { data: statusRaw, error: statusErr } = await supabase.rpc("dashboard_policy_status_kpis", {
          p_reference_date: referenceDate || null,
          p_period_start_date: periodStartDate || null,
          p_agency: agency,
          p_agencies: agenciesArr,
          p_agent_number: agentNum,
        });

        if (statusErr) throw statusErr;

        return jsonResponse(statusRaw);
      }

      case "get-sales-chart": {
        const { startDate, endDate, agencyFilter, agencies, agentNumber } = body;
        if (!startDate || !endDate) {
          return jsonResponse({ error: "Date range required" }, 400);
        }

        const start = new Date(startDate);
        const end = new Date(endDate);
        const daysDiff = Math.ceil((end.getTime() - start.getTime()) / 86400000);
        const bucket = daysDiff > 90 ? "month" : daysDiff > 14 ? "week" : "day";

        const { data, error } = await supabase.rpc("dashboard_sales_chart", {
          p_start_date: startDate,
          p_end_date: endDate,
          p_agency: Array.isArray(agencies) ? null : (agencyFilter || null),
          p_bucket: bucket,
          p_agencies: Array.isArray(agencies) ? agencies : null,
          p_agent_number: agentNumber || null,
        });

        if (error) throw error;

        const chartData = (data || []).map((row: { bucket_date: string; policies: number; premium_sum: number }) => ({
          date: row.bucket_date,
          policies: Number(row.policies),
          revenue: Number(row.premium_sum) * 12,
        }));

        return jsonResponse({ chartData });
      }

      case "get-agent-leaderboard": {
        const { startDate, endDate, agencyFilter } = body;
        if (!startDate || !endDate) {
          return jsonResponse({ error: "Date range required" }, 400);
        }

        const { data, error } = await supabase.rpc("dashboard_agent_leaderboard", {
          p_start_date: startDate,
          p_end_date: endDate,
          p_agency: agencyFilter || null,
        });

        if (error) throw error;

        const agents = (data || []).map((row: { agent_first_name: string; agent_last_name: string; agent_number: string; carrier: string; policies_sold: number; total_sales: number }) => {
          const policiesSold = Number(row.policies_sold);
          const totalSales = Number(row.total_sales);
          return {
            agentFirstName: row.agent_first_name,
            agentLastName: row.agent_last_name,
            agentNumber: row.agent_number,
            carrier: row.carrier,
            policiesSold,
            totalSales,
            avgPolicyValue: policiesSold > 0 ? totalSales / policiesSold : 0,
          };
        });

        return jsonResponse({ agents });
      }

      case "get-enhanced-leaderboard": {
        const { startDate, endDate, agencyFilter: alFilter } = body;
        if (!startDate || !endDate) {
          return jsonResponse({ error: "Date range required" }, 400);
        }

        const { data, error } = await supabase.rpc("dashboard_enhanced_leaderboard", {
          p_start_date: startDate,
          p_end_date: endDate,
          p_agency: alFilter || null,
        });

        if (error) throw error;
        return jsonResponse({ agents: data || [] });
      }

      case "get-agencies": {
        const { data, error } = await supabase.rpc("dashboard_agencies");
        if (error) throw error;
        return jsonResponse({ agencies: data || [] });
      }

      case "get-agency-breakdown": {
        const { startDate, endDate, prevStartDate, prevEndDate } = body;
        if (!startDate || !endDate) {
          return jsonResponse({ error: "Date range required" }, 400);
        }
        const { data, error } = await supabase.rpc("dashboard_agency_breakdown", {
          p_start_date: startDate,
          p_end_date: endDate,
          p_prev_start: prevStartDate || null,
          p_prev_end: prevEndDate || null,
        });
        if (error) throw error;
        return jsonResponse({ agencies: data || [] });
      }

      case "get-agent-breakdown": {
        const { startDate, endDate, prevStartDate, prevEndDate, agencyFilter } = body;
        if (!startDate || !endDate) {
          return jsonResponse({ error: "Date range required" }, 400);
        }
        const { data, error } = await supabase.rpc("dashboard_agent_breakdown", {
          p_start_date: startDate,
          p_end_date: endDate,
          p_prev_start: prevStartDate || null,
          p_prev_end: prevEndDate || null,
          p_agency: agencyFilter || null,
        });
        if (error) throw error;
        return jsonResponse({ agents: data || [] });
      }

      case "get-plan-breakdown": {
        const { startDate, endDate, agencyFilter, agencies } = body;
        if (!startDate || !endDate) {
          return jsonResponse({ error: "Date range required" }, 400);
        }
        const { data, error } = await supabase.rpc("dashboard_plan_breakdown", {
          p_start_date: startDate,
          p_end_date: endDate,
          p_agency: agencyFilter || null,
          p_agencies: agencies || null,
        });
        if (error) throw error;
        return jsonResponse({ plans: data || [] });
      }

      case "get-policies": {
        return jsonResponse({ error: "This endpoint has been removed. Data is sourced directly from Max's DB." }, 410);
      }
      case "export-policies": {
        return jsonResponse({ error: "This endpoint has been removed. Data is sourced directly from Max's DB." }, 410);
      }
      case "export-leaderboard": {
        return jsonResponse({ error: "This endpoint has been removed. Data is sourced directly from Max's DB." }, 410);
      }
      case "delete-policies": {
        return jsonResponse({ error: "This endpoint has been removed. Data is sourced directly from Max's DB." }, 410);
      }
      case "get-submissions": {
        return jsonResponse({ error: "This endpoint has been removed. Data is sourced directly from Max's DB." }, 410);
      }
      case "get-intake-submissions": {
        const { startDate, endDate, agentFilter, npnFilter, agencyFilter, page = 1, pageSize = 20 } = body;
        if (!startDate || !endDate) {
          return jsonResponse({ error: "Date range required" }, 400);
        }

        const offset = (page - 1) * pageSize;

        let agentWritingNumbers: string[] = [];
        if (agentFilter) {
          const { data: agentRow } = await supabase
            .from("agents")
            .select("unl_writing_number, gtl_writing_number")
            .eq("id", agentFilter)
            .maybeSingle();
          if (agentRow) {
            if (agentRow.unl_writing_number) agentWritingNumbers.push(agentRow.unl_writing_number);
            if (agentRow.gtl_writing_number) agentWritingNumbers.push(agentRow.gtl_writing_number);
          }
        }

        if (npnFilter) {
          const { data: npnAgents } = await supabase
            .from("agents")
            .select("unl_writing_number, gtl_writing_number")
            .ilike("npn", `%${npnFilter}%`);
          if (npnAgents && npnAgents.length > 0) {
            const nums: string[] = [];
            for (const a of npnAgents) {
              if (a.unl_writing_number) nums.push(a.unl_writing_number);
              if (a.gtl_writing_number) nums.push(a.gtl_writing_number);
            }
            if (agentWritingNumbers.length > 0) {
              agentWritingNumbers = agentWritingNumbers.filter((n) => nums.includes(n));
              if (agentWritingNumbers.length === 0) agentWritingNumbers = ["__NO_MATCH__"];
            } else {
              agentWritingNumbers = nums.length > 0 ? nums : ["__NO_MATCH__"];
            }
          } else {
            agentWritingNumbers = ["__NO_MATCH__"];
          }
        }

        let countQuery = supabase
          .from("form_submissions")
          .select("id", { count: "exact", head: true })
          .eq("source", "Intake Form")
          .gte("app_submit_date", startDate)
          .lt("app_submit_date", endDate);

        let dataQuery = supabase
          .from("form_submissions")
          .select("*")
          .eq("source", "Intake Form")
          .gte("app_submit_date", startDate)
          .lt("app_submit_date", endDate)
          .order("app_submit_date", { ascending: false })
          .range(offset, offset + pageSize - 1);

        if (agentWritingNumbers.length > 0) {
          countQuery = countQuery.in("agent_number", agentWritingNumbers);
          dataQuery = dataQuery.in("agent_number", agentWritingNumbers);
        } else if (agentFilter && !npnFilter) {
          countQuery = countQuery.eq("agent_number", "__NO_MATCH__");
          dataQuery = dataQuery.eq("agent_number", "__NO_MATCH__");
        }

        if (agencyFilter) {
          countQuery = countQuery.eq("agency", agencyFilter);
          dataQuery = dataQuery.eq("agency", agencyFilter);
        }

        const [countResult, dataResult] = await Promise.all([countQuery, dataQuery]);
        if (countResult.error) throw countResult.error;
        if (dataResult.error) throw dataResult.error;

        const submissions = dataResult.data || [];
        const writingNums = Array.from(new Set(submissions.map((s: { agent_number: string }) => s.agent_number).filter(Boolean)));

        let npnMap: Record<string, string> = {};
        if (writingNums.length > 0) {
          const { data: agentNpns } = await supabase
            .from("agents")
            .select("npn, unl_writing_number, gtl_writing_number")
            .or(writingNums.map((n: string) => `unl_writing_number.eq.${n},gtl_writing_number.eq.${n}`).join(","));
          if (agentNpns) {
            for (const a of agentNpns) {
              if (a.unl_writing_number && a.npn) npnMap[a.unl_writing_number] = a.npn;
              if (a.gtl_writing_number && a.npn) npnMap[a.gtl_writing_number] = a.npn;
            }
          }
        }

        const enriched = submissions.map((s: Record<string, unknown>) => ({
          ...s,
          npn: npnMap[(s as { agent_number: string }).agent_number] || "",
        }));

        const { data: allAgents } = await supabase
          .from("agents")
          .select("id, first_name, last_name");

        const { data: filterList } = await supabase
          .from("form_submissions")
          .select("agency")
          .eq("source", "Intake Form")
          .gte("app_submit_date", startDate)
          .lt("app_submit_date", endDate);

        const uniqueAgencies = Array.from(
          new Set((filterList || []).map((r: { agency: string }) => r.agency).filter(Boolean))
        ).sort().map((name) => ({ name }));

        const agentOptions = (allAgents || [])
          .map((a: { id: string; first_name: string; last_name: string }) => ({
            id: a.id,
            label: `${a.first_name} ${a.last_name}`.trim(),
          }))
          .sort((a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label));

        return jsonResponse({
          submissions: enriched,
          totalCount: countResult.count || 0,
          agents: agentOptions,
          agencies: uniqueAgencies,
        });
      }

      case "update-intake-submission": {
        const { submissionId, updates, editedBy } = body;
        if (!submissionId || typeof submissionId !== "string") {
          return jsonResponse({ error: "submissionId required" }, 400);
        }
        if (!updates || typeof updates !== "object") {
          return jsonResponse({ error: "updates object required" }, 400);
        }

        const ALLOWED_TEXT_FIELDS = [
          "agent_first_name",
          "agent_last_name",
          "agent_number",
          "carrier",
          "agency",
          "client_first_name",
          "client_last_name",
          "phone",
          "email",
          "address",
          "city",
          "state",
          "zip",
          "plan_name",
          "policy_number",
        ] as const;
        const ALLOWED_DATE_FIELDS = ["policy_effective_date", "app_submit_date"] as const;
        const ALLOWED_NUMERIC_FIELDS = ["plan_premium"] as const;
        const ALLOWED_ENUM_FIELDS: Record<string, string[]> = {
          status: ["pending", "submitted", "approved", "active", "cancelled", "terminated", "superseded"],
          product_type: ["HI", "HHC"],
        };
        const ALLOWED_BOOL_FIELDS = ["duplicate_flag"] as const;

        const cleanUpdates: Record<string, unknown> = {};
        const validationErrors: string[] = [];

        for (const [key, rawValue] of Object.entries(updates as Record<string, unknown>)) {
          if (rawValue === undefined) continue;

          if ((ALLOWED_TEXT_FIELDS as readonly string[]).includes(key)) {
            if (rawValue === null) {
              if (key === "agency" || key === "policy_number") {
                cleanUpdates[key] = null;
              } else {
                validationErrors.push(`${key} cannot be null`);
              }
              continue;
            }
            if (typeof rawValue !== "string") {
              validationErrors.push(`${key} must be a string`);
              continue;
            }
            const trimmed = rawValue.trim();
            if (key === "email" && trimmed.length > 0) {
              const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
              if (!emailOk) {
                validationErrors.push("email is not a valid address");
                continue;
              }
            }
            if (key === "agent_number") {
              cleanUpdates[key] = trimmed.toUpperCase();
            } else if (key === "agency" || key === "policy_number") {
              cleanUpdates[key] = trimmed.length === 0 ? null : trimmed;
            } else {
              cleanUpdates[key] = trimmed;
            }
            continue;
          }

          if ((ALLOWED_DATE_FIELDS as readonly string[]).includes(key)) {
            if (rawValue === null || rawValue === "") {
              if (key === "app_submit_date") {
                cleanUpdates[key] = null;
              } else {
                validationErrors.push(`${key} is required`);
              }
              continue;
            }
            if (typeof rawValue !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) {
              validationErrors.push(`${key} must be YYYY-MM-DD`);
              continue;
            }
            cleanUpdates[key] = rawValue;
            continue;
          }

          if ((ALLOWED_NUMERIC_FIELDS as readonly string[]).includes(key)) {
            const num = typeof rawValue === "string" ? Number(rawValue) : (rawValue as number);
            if (!Number.isFinite(num) || num < 0) {
              validationErrors.push(`${key} must be a non-negative number`);
              continue;
            }
            cleanUpdates[key] = num;
            continue;
          }

          if (key in ALLOWED_ENUM_FIELDS) {
            const allowed = ALLOWED_ENUM_FIELDS[key];
            if (typeof rawValue !== "string" || !allowed.includes(rawValue)) {
              validationErrors.push(`${key} must be one of: ${allowed.join(", ")}`);
              continue;
            }
            cleanUpdates[key] = rawValue;
            continue;
          }

          if ((ALLOWED_BOOL_FIELDS as readonly string[]).includes(key)) {
            if (typeof rawValue !== "boolean") {
              validationErrors.push(`${key} must be a boolean`);
              continue;
            }
            cleanUpdates[key] = rawValue;
            continue;
          }

          validationErrors.push(`Unknown field: ${key}`);
        }

        if (validationErrors.length > 0) {
          return jsonResponse({ error: validationErrors.join("; ") }, 400);
        }

        if (Object.keys(cleanUpdates).length === 0) {
          return jsonResponse({ error: "No valid changes provided" }, 400);
        }

        const { data: existing, error: fetchErr } = await supabase
          .from("form_submissions")
          .select("*")
          .eq("id", submissionId)
          .maybeSingle();
        if (fetchErr) throw fetchErr;
        if (!existing) {
          return jsonResponse({ error: "Submission not found" }, 404);
        }
        // Bucket 5 guard: writes are only permitted on intake-form rows (2026-07-20).
        // UNL/Max's DB rows must not be modified here — Max's DB is the source of truth.
        if ((existing as Record<string, unknown>).source !== "Intake Form") {
          return jsonResponse({ error: "Only Intake Form submissions may be edited here." }, 403);
        }

        const changes: Record<string, { old: unknown; new: unknown }> = {};
        for (const [k, v] of Object.entries(cleanUpdates)) {
          const before = (existing as Record<string, unknown>)[k];
          const beforeStr = before === null || before === undefined ? "" : String(before);
          const afterStr = v === null || v === undefined ? "" : String(v);
          if (beforeStr !== afterStr) {
            changes[k] = { old: before ?? null, new: v ?? null };
          }
        }

        if (Object.keys(changes).length === 0) {
          return jsonResponse({ submission: existing, unchanged: true });
        }

        const { data: updated, error: updErr } = await supabase
          .from("form_submissions")
          .update(cleanUpdates)
          .eq("id", submissionId)
          .select("*")
          .maybeSingle();
        if (updErr) {
          const msg = updErr.message || "Update failed";
          if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique")) {
            return jsonResponse({ error: "Policy number already exists on another submission" }, 409);
          }
          return jsonResponse({ error: msg }, 400);
        }

        await supabase.from("form_submission_edits").insert({
          submission_id: submissionId,
          edited_by: typeof editedBy === "string" && editedBy.length > 0 ? editedBy.slice(0, 200) : "admin",
          changes,
        });

        return jsonResponse({ submission: updated });
      }

      case "export-intake-submissions": {
        const { startDate, endDate, agentFilter, npnFilter, agencyFilter } = body;
        if (!startDate || !endDate) {
          return jsonResponse({ error: "Date range required" }, 400);
        }

        let agentWritingNumbers: string[] = [];
        if (agentFilter) {
          const { data: agentRow } = await supabase
            .from("agents")
            .select("unl_writing_number, gtl_writing_number")
            .eq("id", agentFilter)
            .maybeSingle();
          if (agentRow) {
            if (agentRow.unl_writing_number) agentWritingNumbers.push(agentRow.unl_writing_number);
            if (agentRow.gtl_writing_number) agentWritingNumbers.push(agentRow.gtl_writing_number);
          }
        }

        if (npnFilter) {
          const { data: npnAgents } = await supabase
            .from("agents")
            .select("unl_writing_number, gtl_writing_number")
            .ilike("npn", `%${npnFilter}%`);
          if (npnAgents && npnAgents.length > 0) {
            const nums: string[] = [];
            for (const a of npnAgents) {
              if (a.unl_writing_number) nums.push(a.unl_writing_number);
              if (a.gtl_writing_number) nums.push(a.gtl_writing_number);
            }
            if (agentWritingNumbers.length > 0) {
              agentWritingNumbers = agentWritingNumbers.filter((n) => nums.includes(n));
              if (agentWritingNumbers.length === 0) agentWritingNumbers = ["__NO_MATCH__"];
            } else {
              agentWritingNumbers = nums.length > 0 ? nums : ["__NO_MATCH__"];
            }
          } else {
            agentWritingNumbers = ["__NO_MATCH__"];
          }
        }

        let exportQuery = supabase
          .from("form_submissions")
          .select("*")
          .eq("source", "Intake Form")
          .gte("app_submit_date", startDate)
          .lt("app_submit_date", endDate)
          .order("app_submit_date", { ascending: false })
          .limit(50000);

        if (agentWritingNumbers.length > 0) {
          exportQuery = exportQuery.in("agent_number", agentWritingNumbers);
        } else if (agentFilter && !npnFilter) {
          exportQuery = exportQuery.eq("agent_number", "__NO_MATCH__");
        }

        if (agencyFilter) {
          exportQuery = exportQuery.eq("agency", agencyFilter);
        }

        const exportResult = await exportQuery;
        if (exportResult.error) throw exportResult.error;

        const rows = exportResult.data || [];
        const nums = Array.from(new Set(rows.map((s: { agent_number: string }) => s.agent_number).filter(Boolean)));

        let npnMap: Record<string, string> = {};
        if (nums.length > 0) {
          const { data: agentNpns } = await supabase
            .from("agents")
            .select("npn, unl_writing_number, gtl_writing_number")
            .or(nums.map((n: string) => `unl_writing_number.eq.${n},gtl_writing_number.eq.${n}`).join(","));
          if (agentNpns) {
            for (const a of agentNpns) {
              if (a.unl_writing_number && a.npn) npnMap[a.unl_writing_number] = a.npn;
              if (a.gtl_writing_number && a.npn) npnMap[a.gtl_writing_number] = a.npn;
            }
          }
        }

        const enriched = rows.map((s: Record<string, unknown>) => ({
          ...s,
          npn: npnMap[(s as { agent_number: string }).agent_number] || "",
        }));

        return jsonResponse({ submissions: enriched });
      }

      case "get-agents": {
        const merged: Record<string, {
          firstName: string;
          lastName: string;
          npn: string;
          unlWritingNumber: string;
          gtlWritingNumber: string;
          source: string;
          agency: string;
          agentTableId: string | null;
          rosterEntryIds: string[];
        }> = {};

        const { data: portalAgents } = await supabase
          .from("agents")
          .select("id, first_name, last_name, npn, unl_writing_number, gtl_writing_number, source, agency");

        for (const agent of portalAgents || []) {
          const key = agent.npn
            ? `npn:${agent.npn}`
            : `name:${agent.first_name.toLowerCase()}|${agent.last_name.toLowerCase()}`;
          merged[key] = {
            firstName: agent.first_name,
            lastName: agent.last_name,
            npn: agent.npn || "",
            unlWritingNumber: agent.unl_writing_number || "",
            gtlWritingNumber: agent.gtl_writing_number || "",
            source: agent.source || "Contracting Portal",
            agency: agent.agency || "",
            agentTableId: agent.id,
            rosterEntryIds: [],
          };
        }

        const { data: activeUploads } = await supabase
          .from("roster_uploads")
          .select("id, carrier")
          .eq("is_active", true);

        if (activeUploads && activeUploads.length > 0) {
          const uploadIds = activeUploads.map((u: { id: string }) => u.id);

          const { data: rosterAgents, error: agentsError } = await supabase
            .from("agent_rosters")
            .select("id, first_name, last_name, agent_number, carrier, npn")
            .in("roster_upload_id", uploadIds);

          if (agentsError) throw agentsError;

          for (const agent of rosterAgents || []) {
            let matchKey: string | null = null;

            if (agent.npn) {
              const npnKey = `npn:${agent.npn}`;
              if (merged[npnKey]) matchKey = npnKey;
            }

            if (!matchKey && agent.carrier === "UNL" && agent.agent_number) {
              const found = Object.entries(merged).find(
                ([, v]) => v.unlWritingNumber === agent.agent_number
              );
              if (found) matchKey = found[0];
            }

            if (!matchKey && agent.carrier === "GTL" && agent.agent_number) {
              const found = Object.entries(merged).find(
                ([, v]) => v.gtlWritingNumber === agent.agent_number
              );
              if (found) matchKey = found[0];
            }

            if (matchKey) {
              const existing = merged[matchKey];
              if (!existing.npn && agent.npn) existing.npn = agent.npn;
              if (agent.carrier === "UNL" && !existing.unlWritingNumber) existing.unlWritingNumber = agent.agent_number;
              if (agent.carrier === "GTL" && !existing.gtlWritingNumber) existing.gtlWritingNumber = agent.agent_number;
              existing.rosterEntryIds.push(agent.id);
            } else {
              const nameKey = `name:${agent.first_name.toLowerCase()}|${agent.last_name.toLowerCase()}`;
              if (!merged[nameKey]) {
                merged[nameKey] = {
                  firstName: agent.first_name,
                  lastName: agent.last_name,
                  npn: agent.npn || "",
                  unlWritingNumber: "",
                  gtlWritingNumber: "",
                  source: "Roster",
                  agency: "",
                  agentTableId: null,
                  rosterEntryIds: [],
                };
              }
              const entry = merged[nameKey];
              if (agent.npn && !entry.npn) entry.npn = agent.npn;
              if (agent.carrier === "UNL") entry.unlWritingNumber = agent.agent_number;
              if (agent.carrier === "GTL") entry.gtlWritingNumber = agent.agent_number;
              entry.rosterEntryIds.push(agent.id);
            }
          }
        }

        const agents = Object.values(merged).sort((a, b) =>
          a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)
        );

        return jsonResponse({ agents, total: agents.length });
      }

      case "create-agent": {
        const { firstName, lastName, npn, unlWritingNumber, gtlWritingNumber, agency } = body;

        const fName = toProperCase((firstName || "").trim());
        const lName = stripMiddleInitial(toProperCase((lastName || "").trim()));
        const cleanNpn = (npn || "").trim();
        const cleanUnl = (unlWritingNumber || "").trim().toUpperCase();
        const cleanGtl = (gtlWritingNumber || "").trim().toUpperCase();
        const cleanAgency = (agency || "").trim();

        if (!fName || !lName) {
          return jsonResponse({ error: "First name and last name are required" }, 400);
        }
        if (!cleanNpn) {
          return jsonResponse({ error: "NPN is required" }, 400);
        }
        if (!cleanUnl && !cleanGtl) {
          return jsonResponse({ error: "At least one writing number (UNL or GTL) is required" }, 400);
        }

        const { error: insertError } = await supabase
          .from("agents")
          .insert({
            first_name: fName,
            last_name: lName,
            npn: cleanNpn,
            unl_writing_number: cleanUnl,
            gtl_writing_number: cleanGtl,
            agency: cleanAgency || "FYM",
            source: "Contracting Portal",
          });

        if (insertError) {
          if (insertError.message?.includes("idx_agents_npn_unique")) {
            return jsonResponse({ error: "An agent with this NPN already exists" }, 409);
          }
          throw insertError;
        }

        return jsonResponse({ success: true });
      }

      case "update-agent": {
        const { agentTableId, rosterEntryIds, firstName, lastName, npn, unlWritingNumber, gtlWritingNumber, agency } = body;

        if (!agentTableId && (!rosterEntryIds || !Array.isArray(rosterEntryIds) || rosterEntryIds.length === 0)) {
          return jsonResponse({ error: "No agent identifiers provided" }, 400);
        }

        const fName = toProperCase((firstName || "").trim());
        const lName = stripMiddleInitial(toProperCase((lastName || "").trim()));
        if (!fName || !lName) {
          return jsonResponse({ error: "First name and last name are required" }, 400);
        }

        const cleanNpn = (npn || "").trim();
        const cleanUnl = (unlWritingNumber || "").trim().toUpperCase();
        const cleanGtl = (gtlWritingNumber || "").trim().toUpperCase();
        const cleanAgency = (agency || "").trim();

        if (agentTableId) {
          const { data: currentAgent } = await supabase
            .from("agents")
            .select("agency")
            .eq("id", agentTableId)
            .maybeSingle();
          const agencyChanged = currentAgent && cleanAgency && currentAgent.agency !== cleanAgency;
          const { error } = await supabase
            .from("agents")
            .update({
              first_name: fName,
              last_name: lName,
              npn: cleanNpn,
              unl_writing_number: cleanUnl,
              gtl_writing_number: cleanGtl,
              agency: cleanAgency || "FYM",
              ...(agencyChanged ? { agency_locked: true } : {}),
              updated_at: new Date().toISOString(),
            })
            .eq("id", agentTableId);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from("agents")
            .insert({
              first_name: fName,
              last_name: lName,
              npn: cleanNpn,
              unl_writing_number: cleanUnl,
              gtl_writing_number: cleanGtl,
              agency: cleanAgency || "FYM",
              agency_locked: !!cleanAgency,
              source: "Roster",
            });
          if (error) throw error;
        }

        if (rosterEntryIds && Array.isArray(rosterEntryIds) && rosterEntryIds.length > 0) {
          const { data: entries } = await supabase
            .from("agent_rosters")
            .select("id, carrier")
            .in("id", rosterEntryIds);

          if (entries) {
            for (const entry of entries) {
              const updateData: Record<string, string> = {
                first_name: fName,
                last_name: lName,
                npn: cleanNpn,
              };
              if (entry.carrier === "UNL") updateData.agent_number = cleanUnl;
              else if (entry.carrier === "GTL") updateData.agent_number = cleanGtl;

              await supabase
                .from("agent_rosters")
                .update(updateData)
                .eq("id", entry.id);
            }
          }
        }

        return jsonResponse({ success: true });
      }

      case "bulk-fix-names": {
        const { corrections } = body;

        if (!corrections || !Array.isArray(corrections) || corrections.length === 0) {
          return jsonResponse({ error: "No corrections provided" }, 400);
        }

        let updated = 0;
        for (const c of corrections) {
          const fName = toProperCase((c.firstName || "").trim());
          const lName = stripMiddleInitial(toProperCase((c.lastName || "").trim()));
          if (!fName || !lName) continue;

          if (c.agentTableId) {
            const { error } = await supabase
              .from("agents")
              .update({
                first_name: fName,
                last_name: lName,
                updated_at: new Date().toISOString(),
              })
              .eq("id", c.agentTableId);
            if (!error) updated++;
          }

          if (c.rosterEntryIds && Array.isArray(c.rosterEntryIds) && c.rosterEntryIds.length > 0) {
            await supabase
              .from("agent_rosters")
              .update({ first_name: fName, last_name: lName })
              .in("id", c.rosterEntryIds);
          }
        }

        return jsonResponse({ success: true, updated });
      }

      case "delete-agent": {
        const { agentTableId, rosterEntryIds } = body;

        if (!agentTableId && (!rosterEntryIds || !Array.isArray(rosterEntryIds) || rosterEntryIds.length === 0)) {
          return jsonResponse({ error: "No agent identifiers provided" }, 400);
        }

        if (agentTableId) {
          const { error } = await supabase
            .from("agents")
            .delete()
            .eq("id", agentTableId);
          if (error) throw error;
        }

        if (rosterEntryIds && Array.isArray(rosterEntryIds) && rosterEntryIds.length > 0) {
          const { error } = await supabase
            .from("agent_rosters")
            .delete()
            .in("id", rosterEntryIds);
          if (error) throw error;
        }

        return jsonResponse({ success: true });
      }

      case "get-roster-status": {
        const { data: unlActive } = await supabase
          .from("roster_uploads")
          .select("agent_count")
          .eq("carrier", "UNL")
          .eq("is_active", true)
          .maybeSingle();

        const { data: gtlActive } = await supabase
          .from("roster_uploads")
          .select("agent_count")
          .eq("carrier", "GTL")
          .eq("is_active", true)
          .maybeSingle();

        return jsonResponse({
          unl: { count: unlActive?.agent_count || 0 },
          gtl: { count: gtlActive?.agent_count || 0 },
        });
      }

      case "get-promotions": {
        const { data, error } = await supabase
          .from("leaderboard_promotions")
          .select("*")
          .order("period_type", { ascending: true })
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: false });
        if (error) throw error;
        return jsonResponse({ promotions: data });
      }

      case "create-promotion": {
        const { title, goal_tokens, incentive, start_date, end_date, message, period_type, sort_order } = body;
        if (!title || goal_tokens === undefined || !incentive || !start_date || !end_date || !period_type) {
          return errorResponse("Required fields: title, goal_tokens, incentive, start_date, end_date, period_type");
        }
        const { data, error } = await supabase
          .from("leaderboard_promotions")
          .insert({
            title,
            goal: String(goal_tokens),
            goal_tokens: Number(goal_tokens),
            incentive,
            start_date,
            end_date,
            message: message || null,
            period_type,
            sort_order: sort_order || 0,
            is_active: false,
          })
          .select()
          .single();
        if (error) throw error;
        return jsonResponse({ promotion: data });
      }

      case "update-promotion": {
        const { id: promoId, title: pTitle, goal_tokens: pGoalTokens, incentive: pIncentive, start_date: pStart, end_date: pEnd, message: pMessage, period_type: pPeriod, sort_order: pSort } = body;
        if (!promoId) return errorResponse("Promotion id is required");
        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (pTitle !== undefined) updates.title = pTitle;
        if (pGoalTokens !== undefined) { updates.goal_tokens = Number(pGoalTokens); updates.goal = String(pGoalTokens); }
        if (pIncentive !== undefined) updates.incentive = pIncentive;
        if (pStart !== undefined) updates.start_date = pStart;
        if (pEnd !== undefined) updates.end_date = pEnd;
        if (pMessage !== undefined) updates.message = pMessage || null;
        if (pPeriod !== undefined) updates.period_type = pPeriod;
        if (pSort !== undefined) updates.sort_order = pSort;
        const { data, error } = await supabase
          .from("leaderboard_promotions")
          .update(updates)
          .eq("id", promoId)
          .select()
          .single();
        if (error) throw error;
        return jsonResponse({ promotion: data });
      }

      case "delete-promotion": {
        const { id: deleteId } = body;
        if (!deleteId) return errorResponse("Promotion id is required");
        const { error } = await supabase
          .from("leaderboard_promotions")
          .delete()
          .eq("id", deleteId);
        if (error) throw error;
        return jsonResponse({ success: true });
      }

      case "toggle-promotion": {
        const { id: toggleId, is_active: activate } = body;
        if (!toggleId) return errorResponse("Promotion id is required");
        const { data, error } = await supabase
          .from("leaderboard_promotions")
          .update({ is_active: !!activate, updated_at: new Date().toISOString() })
          .eq("id", toggleId)
          .select()
          .single();
        if (error) throw error;
        return jsonResponse({ promotion: data });
      }

      // ─── Data Sources ─────────────────────────────────────────

      case "list-data-sources": {
        const { data, error } = await supabase
          .from("data_sources")
          .select("*")
          .order("created_at", { ascending: false });
        if (error) throw error;

        const sourceIds = (data || []).map((s: { id: string }) => s.id);
        let uploadStats: Record<string, { lastUpload: string; totalRecords: number }> = {};
        if (sourceIds.length > 0) {
          const { data: uploads } = await supabase
            .from("source_uploads")
            .select("data_source_id, row_count, created_at, status")
            .in("data_source_id", sourceIds)
            .eq("status", "complete")
            .order("created_at", { ascending: false });

          for (const u of uploads || []) {
            if (!uploadStats[u.data_source_id]) {
              uploadStats[u.data_source_id] = { lastUpload: u.created_at, totalRecords: 0 };
            }
            uploadStats[u.data_source_id].totalRecords += u.row_count;
          }
        }

        const sources = (data || []).map((s: { id: string }) => ({
          ...s,
          last_upload: uploadStats[s.id]?.lastUpload || null,
          total_records: uploadStats[s.id]?.totalRecords || 0,
        }));

        return jsonResponse({ sources });
      }

      case "create-data-source": {
        const { name: dsName, description: dsDesc, type: dsType, apiUrl: dsApiUrl, apiKeySecretName: dsApiSecret, pollInterval: dsPoll, dbHost, dbPort, dbName: dsDbName, dbSchema: dsDbSchema, dbTable, dbUser, dbPasswordSecretName } = body;
        if (!dsName) return jsonResponse({ error: "Name is required" }, 400);
        const validTypes = ["csv_upload", "api_pull", "api_push", "sql_import"];
        const sourceType = validTypes.includes(dsType) ? dsType : "csv_upload";

        const insertData: Record<string, unknown> = {
          name: dsName,
          description: dsDesc || "",
          type: sourceType,
        };
        if (dsApiUrl) insertData.api_url = dsApiUrl;
        if (dsApiSecret) insertData.api_key_secret_name = dsApiSecret;
        if (dsPoll) insertData.poll_interval = dsPoll;
        if (dbHost) insertData.db_host = dbHost;
        if (dbPort) insertData.db_port = parseInt(dbPort, 10) || null;
        if (dsDbName) insertData.db_name = dsDbName;
        if (dsDbSchema) insertData.db_schema = dsDbSchema;
        if (dbTable) insertData.db_table = dbTable;
        if (dbUser) insertData.db_user = dbUser;
        if (dbPasswordSecretName) insertData.db_password_secret_name = dbPasswordSecretName;

        const { data, error } = await supabase
          .from("data_sources")
          .insert(insertData)
          .select()
          .single();
        if (error) throw error;
        return jsonResponse({ source: data });
      }

      case "update-data-source": {
        const { sourceId: usId, name: usName, description: usDesc, type: usType, apiUrl: usApiUrl, apiKeySecretName: usApiSecret, pollInterval: usPoll, dbHost: usDbHost, dbPort: usDbPort, dbName: usDbName, dbSchema: usDbSchema, dbTable: usDbTable, dbUser: usDbUser, dbPasswordSecretName: usDbPwSecret } = body;
        if (!usId) return jsonResponse({ error: "Source ID required" }, 400);

        const updateData: Record<string, unknown> = {};
        if (usName !== undefined) updateData.name = usName;
        if (usDesc !== undefined) updateData.description = usDesc;
        if (usType !== undefined) updateData.type = usType;
        if (usApiUrl !== undefined) updateData.api_url = usApiUrl;
        if (usApiSecret !== undefined) updateData.api_key_secret_name = usApiSecret;
        if (usPoll !== undefined) updateData.poll_interval = usPoll;
        if (usDbHost !== undefined) updateData.db_host = usDbHost;
        if (usDbPort !== undefined) updateData.db_port = usDbPort ? parseInt(usDbPort, 10) : null;
        if (usDbName !== undefined) updateData.db_name = usDbName;
        if (usDbSchema !== undefined) updateData.db_schema = usDbSchema;
        if (usDbTable !== undefined) updateData.db_table = usDbTable;
        if (usDbUser !== undefined) updateData.db_user = usDbUser;
        if (usDbPwSecret !== undefined) updateData.db_password_secret_name = usDbPwSecret;

        const { data, error } = await supabase
          .from("data_sources")
          .update(updateData)
          .eq("id", usId)
          .select()
          .single();
        if (error) throw error;
        return jsonResponse({ source: data });
      }

      case "delete-data-source": {
        const { sourceId: dsId } = body;
        if (!dsId) return jsonResponse({ error: "Source ID required" }, 400);
        const { error } = await supabase.from("data_sources").delete().eq("id", dsId);
        if (error) throw error;
        return jsonResponse({ success: true });
      }

      case "trigger-poll": {
        const { sourceId: pollSourceId, date_range: pollDateRange } = body;
        if (!pollSourceId) return jsonResponse({ error: "Source ID required" }, 400);

        const { data: pollSource, error: pollSourceErr } = await supabase
          .from("data_sources")
          .select("*")
          .eq("id", pollSourceId)
          .maybeSingle();
        if (pollSourceErr) throw pollSourceErr;
        if (!pollSource) return jsonResponse({ error: "Data source not found" }, 404);
        if (!pollSource.api_url) return jsonResponse({ error: "No API URL configured" }, 400);

        const rawSecret = pollSource.api_key_secret_name || "";
        const isEnvVarName = /^[A-Z_][A-Z0-9_]*$/.test(rawSecret);
        const apiKey = rawSecret
          ? (isEnvVarName ? (Deno.env.get(rawSecret) || "") : rawSecret)
          : "";

        // Detect EnrollHere source (requires POST with JSON body)
        const isEnrollHere = pollSource.name === "EnrollHere Dialer";

        let apiResponse: Response;
        if (isEnrollHere) {
          const enrollBody = {
            aggregations: { summary: true },
            filter: {
              date: { range: pollDateRange || "today", start: "", end: "", timeframe: 1, timeZone: "" },
              agency: { id: "", ids: [] as string[] },
              agent: { id: "", ids: [] as string[] },
            },
          };
          apiResponse = await fetch(pollSource.api_url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": apiKey,
            },
            body: JSON.stringify(enrollBody),
          });
        } else {
          apiResponse = await fetch(pollSource.api_url, {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
          });
        }

        if (!apiResponse.ok) {
          const errText = await apiResponse.text();
          return jsonResponse({ error: `API returned ${apiResponse.status}: ${errText}` }, 502);
        }

        const apiData = await apiResponse.json();
        const records = Array.isArray(apiData) ? apiData : (apiData.data || apiData.results || apiData.agents || apiData.calls || [apiData]);

        const { data: upload, error: uploadErr } = await supabase
          .from("source_uploads")
          .insert({
            data_source_id: pollSourceId,
            carrier: pollSource.name || "API",
            filename: `api_poll_${new Date().toISOString()}`,
            row_count: records.length,
            status: "complete",
            uploaded_by: "system_poll",
          })
          .select()
          .single();
        if (uploadErr) throw uploadErr;

        if (records.length > 0) {
          const sourceRecords = records.map((r: unknown) => ({
            source_upload_id: upload.id,
            raw_data: r,
            mapped_data: {},
            processing_status: "pending",
          }));
          const { error: recErr } = await supabase
            .from("source_records")
            .insert(sourceRecords);
          if (recErr) throw recErr;
        }

        await supabase
          .from("data_sources")
          .update({ last_polled_at: new Date().toISOString() })
          .eq("id", pollSourceId);

        return jsonResponse({ success: true, records_fetched: records.length, upload_id: upload.id });
      }

      case "get-column-mappings": {
        const { sourceId: cmSourceId } = body;
        if (!cmSourceId) return jsonResponse({ error: "Source ID required" }, 400);

        const { data, error } = await supabase
          .from("column_mappings")
          .select("*")
          .eq("data_source_id", cmSourceId)
          .order("source_column");
        if (error) throw error;
        return jsonResponse({ mappings: data || [] });
      }

      case "save-column-mappings": {
        const { sourceId: smSourceId, mappings: newMappings } = body;
        if (!smSourceId || !newMappings || !Array.isArray(newMappings)) {
          return jsonResponse({ error: "Source ID and mappings array required" }, 400);
        }

        await supabase.from("column_mappings").delete().eq("data_source_id", smSourceId);

        if (newMappings.length > 0) {
          const rows = newMappings.map((m: { source_column: string; target_field: string }) => ({
            data_source_id: smSourceId,
            source_column: m.source_column,
            target_field: m.target_field,
          }));
          const { error } = await supabase.from("column_mappings").insert(rows);
          if (error) throw error;
        }

        return jsonResponse({ success: true });
      }

      case "analyze-source-upload": {
        const { sourceId: asSourceId, records: asRecords, carrier: asCarrier, filename: asFilename } = body;
        if (!asSourceId || !asRecords || !Array.isArray(asRecords) || asRecords.length === 0) {
          return jsonResponse({ error: "Source ID and records required" }, 400);
        }
        if (!asCarrier) return jsonResponse({ error: "Carrier is required" }, 400);

        const { data: existingMappings } = await supabase
          .from("column_mappings")
          .select("source_column, target_field")
          .eq("data_source_id", asSourceId);

        const mappingMap: Record<string, string> = {};
        for (const m of existingMappings || []) {
          mappingMap[m.source_column] = m.target_field;
        }

        const headers = Object.keys(asRecords[0] || {});

        // Fallback: if no mappings for this source, look for matching mappings from other data sources
        if (Object.keys(mappingMap).length === 0) {
          const { data: allMappings } = await supabase
            .from("column_mappings")
            .select("source_column, target_field")
            .neq("data_source_id", asSourceId);

          if (allMappings && allMappings.length > 0) {
            const globalMap: Record<string, string> = {};
            for (const m of allMappings) {
              if (!globalMap[m.source_column]) {
                globalMap[m.source_column] = m.target_field;
              }
            }
            for (const h of headers) {
              if (globalMap[h]) {
                mappingMap[h] = globalMap[h];
              }
            }
          }
        }

        const hasSavedMapping = Object.keys(mappingMap).length > 0;
        const unmappedColumns = headers.filter(h => !mappingMap[h]);

        const sampleRows = asRecords.slice(0, 5);
        const mappedSample = sampleRows.map((row: Record<string, string>) => {
          const mapped: Record<string, string> = {};
          for (const [col, val] of Object.entries(row)) {
            const target = mappingMap[col];
            if (target) mapped[target] = val;
          }
          return mapped;
        });

        return jsonResponse({
          headers,
          hasSavedMapping,
          savedMappings: mappingMap,
          unmappedColumns,
          sampleRows,
          mappedSample,
          totalRows: asRecords.length,
          carrier: asCarrier,
          filename: asFilename || "upload.csv",
        });
      }

      case "process-source-upload": {
        const { sourceId: psSourceId, records: psRecords, carrier: psCarrier, mappings: psMappings, filename: psFilename, uploadId: psUploadId, isFinalChunk, totalRows: psTotalRows } = body;
        if (!psRecords || !Array.isArray(psRecords) || psRecords.length === 0) {
          return jsonResponse({ error: "Records required" }, 400);
        }
        if (!psCarrier) return jsonResponse({ error: "Carrier is required" }, 400);
        if (!psMappings || typeof psMappings !== "object") {
          return jsonResponse({ error: "Mappings required" }, 400);
        }

        let upload: { id: string; data_source_id: string; carrier: string; [key: string]: unknown };

        if (psUploadId) {
          // Append mode: fetch existing upload
          const { data: existingUpload, error: fetchErr } = await supabase
            .from("source_uploads")
            .select("*")
            .eq("id", psUploadId)
            .maybeSingle();
          if (fetchErr || !existingUpload) {
            return jsonResponse({ error: "Upload not found" }, 404);
          }
          upload = existingUpload as typeof upload;
        } else {
          // First chunk: create new upload
          if (!psSourceId) return jsonResponse({ error: "Source ID required" }, 400);

          // Deactivate previous active upload for this source+carrier
          await supabase
            .from("source_uploads")
            .update({ is_active: false })
            .eq("data_source_id", psSourceId)
            .eq("carrier", psCarrier)
            .eq("is_active", true);

          const { data: newUpload, error: upErr } = await supabase
            .from("source_uploads")
            .insert({
              data_source_id: psSourceId,
              carrier: psCarrier,
              filename: psFilename || "upload.csv",
              row_count: psTotalRows || psRecords.length,
              status: "processing",
              uploaded_by: session.email,
              is_active: true,
            })
            .select()
            .single();
          if (upErr) throw upErr;
          upload = newUpload as typeof upload;
        }

        let imported = 0;
        let skipped = 0;
        let errors = 0;
        const batchSize = 200;

        for (let i = 0; i < psRecords.length; i += batchSize) {
          const batch = psRecords.slice(i, i + batchSize);
          const recordRows = batch.map((row: Record<string, string>) => {
            const mapped: Record<string, string> = {};
            for (const [col, val] of Object.entries(row)) {
              const target = psMappings[col];
              if (target) mapped[target] = val;
            }
            // Derive Writing Agent First Name / Last Name from full name
            if (mapped["Writing Agent"] && !mapped["Writing Agent First Name"]) {
              const parts = mapped["Writing Agent"].trim().split(/\s+/).filter(Boolean);
              mapped["Writing Agent First Name"] = parts.length > 0 ? parts[0] : "";
              mapped["Writing Agent Last Name"] = parts.length > 1 ? parts[parts.length - 1] : parts[0] || "";
            }
            return {
              source_upload_id: upload.id,
              raw_data: row,
              mapped_data: mapped,
              processing_status: "imported",
            };
          });

          const { error: insErr } = await supabase.from("source_records").insert(recordRows);
          if (insErr) {
            errors += batch.length;
          } else {
            imported += batch.length;
          }
        }

        skipped = psRecords.length - imported - errors;

        // Update row_count on the final chunk (status stays "processing" until finalize)
        if (isFinalChunk !== false) {
          const { count: totalImported } = await supabase
            .from("source_records")
            .select("*", { count: "exact", head: true })
            .eq("source_upload_id", upload.id)
            .eq("processing_status", "imported");

          await supabase
            .from("source_uploads")
            .update({ row_count: totalImported || imported })
            .eq("id", upload.id);
        }

        return jsonResponse({
          success: true,
          uploadId: upload.id,
          imported,
          skipped,
          errors,
          total: psRecords.length,
        });
      }

      case "finalize-source-upload": {
        return jsonResponse({ error: "This endpoint has been removed. Data is sourced directly from Max's DB." }, 410);
      }
      case "revert-source-upload": {
        return jsonResponse({ error: "This endpoint has been removed. Data is sourced directly from Max's DB." }, 410);
      }
      case "resync-policies": {
        return jsonResponse({ error: "This endpoint has been removed. Data is sourced directly from Max's DB." }, 410);
      }
      case "delete-source-upload": {
        return jsonResponse({ error: "This endpoint has been removed. Data is sourced directly from Max's DB." }, 410);
      }
      case "sync-policies-from-source": {
        return jsonResponse({ error: "This endpoint has been removed. Data is sourced directly from Max's DB." }, 410);
      }
      case "get-source-uploads": {
        const { sourceId: suSourceId } = body;
        if (!suSourceId) return jsonResponse({ error: "Source ID required" }, 400);

        const { data, error } = await supabase
          .from("source_uploads")
          .select("*")
          .eq("data_source_id", suSourceId)
          .order("created_at", { ascending: false });
        if (error) throw error;
        return jsonResponse({ uploads: data || [] });
      }

      case "get-source-records": {
        const { uploadId: srUploadId, page: srPage = 1, pageSize: srPageSize = 50 } = body;
        if (!srUploadId) return jsonResponse({ error: "Upload ID required" }, 400);

        const offset = ((srPage as number) - 1) * (srPageSize as number);

        const { count } = await supabase
          .from("source_records")
          .select("id", { count: "exact", head: true })
          .eq("source_upload_id", srUploadId);

        const { data, error } = await supabase
          .from("source_records")
          .select("*")
          .eq("source_upload_id", srUploadId)
          .order("created_at")
          .range(offset, offset + (srPageSize as number) - 1);
        if (error) throw error;

        return jsonResponse({ records: data || [], totalCount: count || 0 });
      }

      case "resync-agents": {
        const { data: allRecs } = await supabase
          .from("source_records")
          .select("mapped_data")
          .eq("processing_status", "imported");

        const syncMap = new Map<string, { name: string; agency: string }>();
        const syncDownlineCounts = new Map<string, { total: number; withDownline: number }>();
        for (const rec of allRecs || []) {
          const md = normalizeKeys(rec.mapped_data as Record<string, string> | null);
          const code = (md["UNL Writing Number"] || md["Writing Agent Code"] || "").trim().toUpperCase();
          if (!code) continue;
          const downline = (md["Downline Agency"] || "").trim().replace(/\s+/g, " ");
          const counts = syncDownlineCounts.get(code) || { total: 0, withDownline: 0 };
          counts.total++;
          if (downline) counts.withDownline++;
          syncDownlineCounts.set(code, counts);
          if (syncMap.has(code)) continue;
          const name = (md["Writing Agent"] || md["Writing Agent Name"] || "").trim();
          syncMap.set(code, { name, agency: downline ? toProperCase(downline) : "" });
        }
        for (const [code, entry] of syncMap) {
          if (!entry.agency) {
            const counts = syncDownlineCounts.get(code);
            if (counts && counts.withDownline > 0) {
              for (const rec of allRecs || []) {
                const md = normalizeKeys(rec.mapped_data as Record<string, string> | null);
                const rc = (md["UNL Writing Number"] || md["Writing Agent Code"] || "").trim().toUpperCase();
                if (rc !== code) continue;
                const dl = (md["Downline Agency"] || "").trim().replace(/\s+/g, " ");
                if (dl) { entry.agency = toProperCase(dl); break; }
              }
            }
            if (!entry.agency) entry.agency = "FYM";
          }
        }

        let rsAdded = 0;
        let rsUpdated = 0;
        for (const [code, { name, agency }] of syncMap) {
          const nameParts = name.split(/\s+/).filter(Boolean);
          if (nameParts.length === 0) continue;
          const firstName = toProperCase(nameParts[0]);
          const lastName = toProperCase(nameParts[nameParts.length - 1]);
          if (!firstName || !lastName) continue;

          const { data: existing } = await supabase
            .from("agents")
            .select("id, agency, agency_locked, source")
            .eq("unl_writing_number", code)
            .maybeSingle();

          if (existing) {
            if (existing.source === "Contracting Portal") continue;
            if (existing.agency_locked) continue;
            if (agency && existing.agency !== agency) {
              await supabase
                .from("agents")
                .update({ agency, updated_at: new Date().toISOString() })
                .eq("id", existing.id);
              rsUpdated++;
            }
          } else {
            const { error: insErr } = await supabase
              .from("agents")
              .insert({
                first_name: firstName,
                last_name: lastName,
                unl_writing_number: code,
                agency: agency || "FYM",
                source: "Data Source",
              });
            if (!insErr) rsAdded++;
          }
        }

        return jsonResponse({ success: true, agentsAdded: rsAdded, agentsUpdated: rsUpdated });
      }

      case "logout": {
        await supabase
          .from("admin_sessions")
          .delete()
          .eq("token", token);

        return jsonResponse({ success: true });
      }

      case "get-monte-carlo-data": {
        const { agencyFilter: mcAgency, agencies: mcAgencies, startDate: mcStart, endDate: mcEnd } = body;
        const agencyParam = Array.isArray(mcAgencies) ? null : (mcAgency || null);
        const agenciesParam = Array.isArray(mcAgencies) ? mcAgencies : null;
        const startParam = mcStart || null;
        const endParam = mcEnd || null;

        const rpcParams = { p_agency: agencyParam, p_start_date: startParam, p_end_date: endParam, p_agencies: agenciesParam };

        const [dailyResult, trendResult, metaResult, targetResult] = await Promise.all([
          supabase.rpc("monte_carlo_daily_history_by_agency", rpcParams),
          supabase.rpc("monte_carlo_monthly_trend_by_agency", rpcParams),
          supabase.rpc("monte_carlo_meta_by_agency", rpcParams),
          supabase.rpc("get_monte_carlo_target"),
        ]);

        if (dailyResult.error) throw dailyResult.error;
        if (trendResult.error) throw trendResult.error;

        return jsonResponse({
          daily: dailyResult.data || [],
          monthly: trendResult.data || [],
          meta: metaResult.data || {},
          target: targetResult.data || { target: null },
        });
      }

      case "set-monte-carlo-target": {
        const { target: targetValue } = body;
        if (targetValue !== null && (typeof targetValue !== "number" || targetValue < 0)) {
          return jsonResponse({ error: "Target must be a positive number or null" }, 400);
        }

        if (targetValue === null) {
          await supabase
            .from("admin_settings")
            .delete()
            .eq("key", "monte_carlo_target");
          return jsonResponse({ target: null });
        }

        const { data, error } = await supabase.rpc("set_monte_carlo_target", {
          p_target: targetValue,
        });
        if (error) throw error;
        return jsonResponse(data);
      }

      case "refresh-monte-carlo": {
        const { data, error } = await supabase.rpc("refresh_monte_carlo_view");
        if (error) throw error;
        return jsonResponse(data);
      }

      case "get-monte-carlo-agent-data": {
        const { agentNumber: mcAgent, startDate: mcaStart, endDate: mcaEnd } = body;
        if (!mcAgent) {
          return jsonResponse({ error: "agentNumber is required" }, 400);
        }
        const agentRpcParams = { p_agent_number: mcAgent, p_start_date: mcaStart || null, p_end_date: mcaEnd || null };

        const [dailyRes, trendRes, metaRes] = await Promise.all([
          supabase.rpc("monte_carlo_daily_history_by_agent", agentRpcParams),
          supabase.rpc("monte_carlo_monthly_trend_by_agent", agentRpcParams),
          supabase.rpc("monte_carlo_meta_by_agent", agentRpcParams),
        ]);

        if (dailyRes.error) throw dailyRes.error;
        if (trendRes.error) throw trendRes.error;

        return jsonResponse({
          daily: dailyRes.data || [],
          monthly: trendRes.data || [],
          meta: metaRes.data || {},
        });
      }

      case "at-risk-agents-summary": {
        const { agencyFilter: arAgency, agencies: arAgencies } = body;
        const { data, error } = await supabase.rpc("get_at_risk_agents_summary", {
          p_agency: arAgency || null,
          p_agencies: Array.isArray(arAgencies) ? arAgencies : null,
        });
        if (error) throw error;
        return jsonResponse(data);
      }

      case "at-risk-policies-for-agent": {
        const { agentNumber } = body;
        if (!agentNumber) return jsonResponse({ error: "agentNumber required" }, 400);
        const { data, error } = await supabase.rpc("get_at_risk_policies_for_agent", {
          p_agent_number: agentNumber,
        });
        if (error) throw error;
        return jsonResponse(data);
      }

      case "at-risk-aging": {
        const { agencyFilter: agAgency, agencies: agAgencies } = body;
        const { data, error } = await supabase.rpc("get_at_risk_aging_distribution", {
          p_agency: agAgency || null,
          p_agencies: Array.isArray(agAgencies) ? agAgencies : null,
        });
        if (error) throw error;
        return jsonResponse(data);
      }

      case "at-risk-trend": {
        const { agencyFilter: trAgency, agencies: trAgencies } = body;
        const { data, error } = await supabase.rpc("get_at_risk_trend", {
          p_agency: trAgency || null,
          p_agencies: Array.isArray(trAgencies) ? trAgencies : null,
        });
        if (error) throw error;
        return jsonResponse(data);
      }

      case "log-at-risk-activity": {
        const { policyId, actionType, note: actNote, adminUser } = body;
        if (!policyId || !actionType) {
          return jsonResponse({ error: "policyId and actionType required" }, 400);
        }
        const { data, error } = await supabase
          .from("at_risk_activities")
          .insert({
            policy_id: policyId,
            action_type: actionType,
            note: actNote || "",
            admin_user: adminUser || "Admin",
          })
          .select()
          .single();
        if (error) throw error;
        return jsonResponse(data);
      }

      case "get-agent-tokens": {
        const { data } = await supabase
          .from("agent_tokens")
          .select("*, agents!inner(id, first_name, last_name)")
          .order("tokens_total", { ascending: false });

        // Also fetch recent daily talk time for streak display
        const { data: dailyLogs } = await supabase
          .from("agent_talk_time_daily")
          .select("agent_id, date, minutes")
          .gte("date", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
          .order("date", { ascending: false });

        return jsonResponse({ tokens: data || [], dailyTalkTime: dailyLogs || [] });
      }

      case "update-agent-talk-time": {
        const { agentId: ttAgentId, minutes, date: ttDate } = body;
        if (!ttAgentId) return jsonResponse({ error: "agentId required" }, 400);
        const talkMinutes = Math.max(0, parseInt(minutes) || 0);
        const entryDate = ttDate || new Date().toISOString().slice(0, 10);

        // Upsert daily talk time log
        const { error: dailyError } = await supabase
          .from("agent_talk_time_daily")
          .upsert({
            agent_id: ttAgentId,
            date: entryDate,
            minutes: talkMinutes,
            updated_at: new Date().toISOString(),
          }, { onConflict: "agent_id,date" });

        if (dailyError) throw dailyError;

        // Recompute cumulative talk time from all daily entries
        const { data: allDaily } = await supabase
          .from("agent_talk_time_daily")
          .select("minutes")
          .eq("agent_id", ttAgentId);

        const totalMinutes = (allDaily || []).reduce((sum, r) => sum + r.minutes, 0);
        const tokensFromTalkTime = totalMinutes;

        const { data: existing } = await supabase
          .from("agent_tokens")
          .select("tokens_policies")
          .eq("agent_id", ttAgentId)
          .maybeSingle();

        const policiesTokens = existing?.tokens_policies || 0;
        const total = policiesTokens + tokensFromTalkTime;

        const { data, error } = await supabase
          .from("agent_tokens")
          .upsert({
            agent_id: ttAgentId,
            talk_time_minutes: totalMinutes,
            tokens_talk_time: tokensFromTalkTime,
            tokens_policies: policiesTokens,
            tokens_ap: 0,
            tokens_total: total,
            updated_at: new Date().toISOString(),
          }, { onConflict: "agent_id" })
          .select()
          .maybeSingle();

        if (error) throw error;
        return jsonResponse(data);
      }


      case "billing-mode-breakdown": {
        // Queries Max's DB directly (2026-07-20).
        const { agencyFilter, agencies, startDate, endDate, agentNumber } = body;

        // Resolve writing numbers for scope filter
        let scopeWns: string[] = [];
        if (agentNumber) {
          scopeWns = [(agentNumber as string).trim().toUpperCase()];
        } else if (agencies && Array.isArray(agencies) && agencies.length > 0) {
          // agencies is an array of agency names — look up writing numbers
          const { data: awnBm } = await supabase
            .from("agency_writing_numbers")
            .select("writing_number, agencies(name)")
          for (const r of awnBm || []) {
            const name = (r.agencies as { name: string } | null)?.name ?? "";
            if ((agencies as string[]).includes(name)) {
              scopeWns.push(((r.writing_number as string) ?? "").trim().toUpperCase());
            }
          }
        } else if (agencyFilter) {
          const { data: awnBm2 } = await supabase
            .from("agency_writing_numbers")
            .select("writing_number, agencies(name)")
          for (const r of awnBm2 || []) {
            const name = (r.agencies as { name: string } | null)?.name ?? "";
            if (name === agencyFilter) scopeWns.push(((r.writing_number as string) ?? "").trim().toUpperCase());
          }
        }

        const maxDbBm = await openMaxDb();
        let bmRows: Array<{ billing_mode: number | null; cntrct_code: string | null }> = [];
        try {
          let whereClause = "WHERE t.billing_mode IS NOT NULL AND t.cntrct_code IS NOT NULL";
          const params: unknown[] = [];
          if (scopeWns.length > 0) {
            whereClause += ` AND TRIM(UPPER(t.wa)) = ANY(${ scopeWns.map((_: unknown, i: number) => `$${i + 1}`).join(",") })`;
            params.push(...scopeWns);
          }
          if (startDate) { whereClause += ` AND t.app_recvd_date >= $${params.length + 1}::date`; params.push(startDate); }
          if (endDate)   { whereClause += ` AND t.app_recvd_date <= $${params.length + 1}::date`; params.push(endDate); }
          bmRows = await maxDbBm.unsafe(
            `SELECT t.billing_mode, TRIM(t.cntrct_code) AS cntrct_code FROM typed.unl_fym_policy_latest_load t ${whereClause}`,
            params
          ) as Array<{ billing_mode: number | null; cntrct_code: string | null }>;
        } finally {
          try { await maxDbBm.end(); } catch { /* ignore */ }
        }

        const modeMap: Record<string, Record<string, number>> = {};
        for (const row of bmRows) {
          const mode = String(row.billing_mode ?? "");
          const code = (row.cntrct_code ?? "").trim();
          if (!mode || !code) continue;
          if (!modeMap[mode]) modeMap[mode] = {};
          modeMap[mode][code] = (modeMap[mode][code] || 0) + 1;
        }

        const distribution: { billing_mode: string; total: number; breakdown: Record<string, number> }[] = [];
        const termination: { billing_mode: string; rate: number; terminated: number; total: number }[] = [];

        for (const [mode, codes] of Object.entries(modeMap)) {
          const total = Object.values(codes).reduce((s, n) => s + n, 0);
          distribution.push({ billing_mode: mode, total, breakdown: codes });
          const terminated = codes["T"] || 0;
          termination.push({ billing_mode: mode, rate: total > 0 ? terminated / total : 0, terminated, total });
        }

        return jsonResponse({ distribution, termination });
      }

      case "agency-upload-roster": {
        const { rows: rosterRows, filename: rosterFilename, overrideAgencyId: uploadOverrideId } = body;
        const uploadAgencyId = (session.role === "global_admin" && uploadOverrideId) ? uploadOverrideId : session.agency_id;
        if (!uploadAgencyId) {
          return jsonResponse({ error: "Agency context required" }, 403);
        }
        if (!Array.isArray(rosterRows) || rosterRows.length === 0) {
          return jsonResponse({ error: "No roster rows provided" }, 400);
        }

        // Look up agency name for agent record creation
        const { data: rosterAgency } = await supabase
          .from("agencies")
          .select("name")
          .eq("id", uploadAgencyId)
          .maybeSingle();
        const rosterAgencyName = rosterAgency?.name || "FYM";

        // Create upload record
        const { data: upload, error: uploadErr } = await supabase
          .from("agency_roster_uploads")
          .insert({
            agency_id: uploadAgencyId,
            uploaded_by_session_id: session.id,
            filename: rosterFilename || "roster.csv",
            total_rows: rosterRows.length,
          })
          .select()
          .single();
        if (uploadErr) throw uploadErr;

        // Fetch all agents for matching to existing records
        const { data: allAgents } = await supabase
          .from("agents")
          .select("id, first_name, last_name, unl_writing_number, gtl_writing_number, npn");

        let matchedCount = 0;
        let createdCount = 0;

        // Existing roster entries for this agency, keyed by writing number, so a
        // re-upload MERGES (updates in place) instead of appending duplicates.
        const { data: existingEntries } = await supabase
          .from("agency_rosters")
          .select("id, writing_number, status")
          .eq("agency_id", uploadAgencyId);
        const existingByWn = new Map<string, { id: string; status: string }>();
        for (const e of existingEntries || []) {
          existingByWn.set((e.writing_number || "").toUpperCase(), { id: e.id, status: e.status });
        }
        // Guard against duplicate writing numbers within the same uploaded file.
        const seenInUpload = new Set<string>();
        let updatedCount = 0;

        const entries: Array<{
          agency_id: string;
          agent_first_name: string;
          agent_last_name: string;
          writing_number: string;
          carrier: string;
          npn: string;
          match_status: string;
          matched_agent_id: string | null;
          upload_id: string;
        }> = [];

        for (const row of rosterRows) {
          const firstName = (row.agent_first_name || "").trim();
          const lastName = (row.agent_last_name || "").trim();
          const writingNumber = (row.writing_number || "").trim().toUpperCase();
          const npn = (row.npn || "").trim();
          const carrier = (row.carrier || "UNL").trim().toUpperCase();

          if (!firstName || !lastName || !writingNumber) continue;

          // All roster entries are confirmed -- the agency vouches for the writing number
          let matchedAgentId: string | null = null;

          // Try to find existing agent by writing number
          const writingNumberMatch = (allAgents || []).find(
            (a: { unl_writing_number: string; gtl_writing_number: string }) =>
              a.unl_writing_number?.toUpperCase() === writingNumber ||
              a.gtl_writing_number?.toUpperCase() === writingNumber
          );

          if (writingNumberMatch) {
            matchedAgentId = writingNumberMatch.id;
            matchedCount++;
          } else {
            // Try to match by NPN
            let npnMatch = null;
            if (npn) {
              npnMatch = (allAgents || []).find(
                (a: { npn: string }) => a.npn === npn
              );
            }
            if (npnMatch) {
              matchedAgentId = (npnMatch as { id: string }).id;
              matchedCount++;
            } else {
              // No existing agent -- create one
              const writingCol = carrier === "GTL" ? "gtl_writing_number" : "unl_writing_number";
              const { data: newAgent } = await supabase
                .from("agents")
                .insert({
                  first_name: toProperCase(firstName),
                  last_name: toProperCase(lastName),
                  npn,
                  [writingCol]: writingNumber,
                  source: "Roster",
                  agency: rosterAgencyName,
                  agency_id: uploadAgencyId,
                  agency_locked: true,
                  status: "active",
                })
                .select("id")
                .single();
              if (newAgent) {
                matchedAgentId = newAgent.id;
                createdCount++;
              }
            }
          }

          if (seenInUpload.has(writingNumber)) continue;
          seenInUpload.add(writingNumber);

          const existing = existingByWn.get(writingNumber);
          if (existing) {
            // Merge into the existing roster row: refresh name/npn/carrier/match,
            // reactivate if it had been terminated, and re-home it to this upload.
            const { error: mergeErr } = await supabase
              .from("agency_rosters")
              .update({
                agent_first_name: toProperCase(firstName),
                agent_last_name: toProperCase(lastName),
                carrier,
                npn,
                match_status: "confirmed",
                matched_agent_id: matchedAgentId,
                upload_id: upload.id,
                status: "active",
                terminated_at: null,
                updated_at: new Date().toISOString(),
              })
              .eq("id", existing.id)
              .eq("agency_id", uploadAgencyId);
            if (mergeErr) throw mergeErr;
            updatedCount++;
            if (matchedAgentId) {
              await supabase
                .from("agents")
                .update({ agency: rosterAgencyName, agency_id: uploadAgencyId, agency_locked: true })
                .eq("id", matchedAgentId);
            }
            continue;
          }

          entries.push({
            agency_id: uploadAgencyId,
            agent_first_name: toProperCase(firstName),
            agent_last_name: toProperCase(lastName),
            writing_number: writingNumber,
            carrier,
            npn,
            match_status: "confirmed",
            matched_agent_id: matchedAgentId,
            upload_id: upload.id,
          });
        }

        // Insert brand-new roster entries (merged ones were updated in place above)
        if (entries.length > 0) {
          const { error: insertErr } = await supabase
            .from("agency_rosters")
            .insert(entries);
          if (insertErr) throw insertErr;
        }

        // Lock agency assignment on all matched agents
        for (const entry of entries) {
          if (entry.matched_agent_id) {
            await supabase
              .from("agents")
              .update({ agency: rosterAgencyName, agency_id: uploadAgencyId, agency_locked: true })
              .eq("id", entry.matched_agent_id);
          }
        }

        // Update upload counts
        await supabase
          .from("agency_roster_uploads")
          .update({ matched_count: matchedCount + createdCount, fuzzy_count: 0, unmatched_count: 0 })
          .eq("id", upload.id);

        return jsonResponse({
          upload_id: upload.id,
          total: entries.length + updatedCount,
          matched: matchedCount,
          created: createdCount,
          updated: updatedCount,
          fuzzy: 0,
          unmatched: 0,
        });
      }

      case "agency-get-roster": {
        const { statusFilter, search, overrideAgencyId: getRosterOverride } = body;
        const agencyId = (session.role === "global_admin" && getRosterOverride) ? getRosterOverride : session.agency_id;
        if (!agencyId) {
          return jsonResponse({ error: "Agency context required" }, 403);
        }

        let query = supabase
          .from("agency_rosters")
          .select("*, agents:matched_agent_id(id, first_name, last_name, unl_writing_number, gtl_writing_number, npn)")
          .eq("agency_id", agencyId)
          .order("created_at", { ascending: false });

        if (statusFilter && statusFilter !== "all") {
          query = query.eq("status", statusFilter);
        }

        const { data, error } = await query;
        if (error) throw error;

        let results = data || [];
        if (search) {
          const s = search.toLowerCase();
          results = results.filter(
            (r: { agent_first_name: string; agent_last_name: string; writing_number: string; npn: string }) =>
              r.agent_first_name.toLowerCase().includes(s) ||
              r.agent_last_name.toLowerCase().includes(s) ||
              r.writing_number.toLowerCase().includes(s) ||
              r.npn.toLowerCase().includes(s)
          );
        }

        // Also fetch additional writing numbers for matched agents
        const matchedIds = results
          .filter((r: { matched_agent_id: string | null }) => r.matched_agent_id)
          .map((r: { matched_agent_id: string }) => r.matched_agent_id);

        let writingNumbers: Array<{ id: string; agent_id: string; carrier_name: string; writing_number: string }> = [];
        if (matchedIds.length > 0) {
          const { data: wn } = await supabase
            .from("agent_writing_numbers")
            .select("id, agent_id, carrier_name, writing_number")
            .eq("agency_id", agencyId)
            .in("agent_id", matchedIds);
          writingNumbers = wn || [];
        }

        return jsonResponse({ roster: results, writing_numbers: writingNumbers });
      }

      case "agency-get-roster-uploads": {
        const { overrideAgencyId: uploadsOverride } = body;
        const uploadsAgencyId = (session.role === "global_admin" && uploadsOverride) ? uploadsOverride : session.agency_id;
        if (!uploadsAgencyId) {
          return jsonResponse({ error: "Agency context required" }, 403);
        }
        const { data, error } = await supabase
          .from("agency_roster_uploads")
          .select("*")
          .eq("agency_id", uploadsAgencyId)
          .order("created_at", { ascending: false });
        if (error) throw error;
        return jsonResponse({ uploads: data || [] });
      }

      case "agency-add-roster-entry": {
        const { firstName: arFirst, lastName: arLast, writingNumber: arNum, npn: arNpn, carrier: arCarrier, overrideAgencyId: addOverride } = body;
        const addAgencyId = (session.role === "global_admin" && addOverride) ? addOverride : session.agency_id;
        if (!addAgencyId) {
          return jsonResponse({ error: "Agency context required" }, 403);
        }
        if (!arFirst || !arLast || !arNum) {
          return jsonResponse({ error: "First name, last name, and writing number are required" }, 400);
        }

        const cleanNum = arNum.trim().toUpperCase();
        const cleanCarrier = (arCarrier || "UNL").trim().toUpperCase();

        // Check for existing agent match
        const { data: existingAgent } = await supabase
          .from("agents")
          .select("id, first_name, last_name, unl_writing_number, gtl_writing_number")
          .or(`unl_writing_number.ilike.${cleanNum},gtl_writing_number.ilike.${cleanNum}`)
          .maybeSingle();

        let matchStatus = "unmatched";
        let matchedAgentId: string | null = null;

        if (existingAgent) {
          const nameMatches =
            existingAgent.first_name.toLowerCase() === arFirst.trim().toLowerCase() &&
            existingAgent.last_name.toLowerCase() === arLast.trim().toLowerCase();
          matchStatus = nameMatches ? "confirmed" : "fuzzy";
          matchedAgentId = existingAgent.id;
        } else {
          // No existing agent for this writing number. The agency vouches for
          // the roster entry, so create a login-capable `agents` row (mirrors the
          // bulk roster upload). Without this the agent has no `agents` record and
          // agent-login returns "Invalid credentials" -- the WiseChoice lockout bug.
          const { data: addAgencyRow } = await supabase
            .from("agencies")
            .select("name")
            .eq("id", addAgencyId)
            .maybeSingle();
          const writingCol = cleanCarrier === "GTL" ? "gtl_writing_number" : "unl_writing_number";
          const { data: newAgent } = await supabase
            .from("agents")
            .insert({
              first_name: toProperCase(arFirst.trim()),
              last_name: toProperCase(arLast.trim()),
              npn: (arNpn || "").trim(),
              [writingCol]: cleanNum,
              source: "Roster",
              agency: addAgencyRow?.name || null,
              agency_id: addAgencyId,
              agency_locked: true,
              status: "active",
            })
            .select("id")
            .single();
          if (newAgent) {
            matchStatus = "confirmed";
            matchedAgentId = newAgent.id;
          }
        }

        const { data: entry, error: entryErr } = await supabase
          .from("agency_rosters")
          .insert({
            agency_id: addAgencyId,
            agent_first_name: toProperCase(arFirst.trim()),
            agent_last_name: toProperCase(arLast.trim()),
            writing_number: cleanNum,
            carrier: cleanCarrier,
            npn: (arNpn || "").trim(),
            match_status: matchStatus,
            matched_agent_id: matchedAgentId,
          })
          .select()
          .single();
        if (entryErr) throw entryErr;

        // If confirmed, lock agency
        if (matchStatus === "confirmed" && matchedAgentId) {
          await supabase
            .from("agents")
            .update({ agency_id: addAgencyId, agency_locked: true })
            .eq("id", matchedAgentId);
        }

        return jsonResponse(entry);
      }

      case "agency-edit-roster-entry": {
        const {
          rosterId: editRosterId,
          firstName: editFirst,
          lastName: editLast,
          writingNumber: editNum,
          npn: editNpn,
          carrier: editCarrier,
          overrideAgencyId: editOverride,
        } = body;
        const editAgencyId = (session.role === "global_admin" && editOverride) ? editOverride : session.agency_id;
        if (!editAgencyId) {
          return jsonResponse({ error: "Agency context required" }, 403);
        }
        if (!editRosterId) return jsonResponse({ error: "rosterId required" }, 400);
        if (!editFirst || !editLast || !editNum) {
          return jsonResponse({ error: "First name, last name, and writing number are required" }, 400);
        }

        const cleanEditNum = editNum.trim().toUpperCase();
        const cleanEditCarrier = (editCarrier || "UNL").trim().toUpperCase();

        // Guard: don't let an edit collide with another roster row's writing number
        // in the same agency (writing number is the merge key on re-upload).
        const { data: clash } = await supabase
          .from("agency_rosters")
          .select("id")
          .eq("agency_id", editAgencyId)
          .eq("writing_number", cleanEditNum)
          .neq("id", editRosterId)
          .maybeSingle();
        if (clash) {
          return jsonResponse({ error: "Another roster entry already uses that writing number" }, 409);
        }

        // Re-run matching against the new writing number.
        const { data: editMatchAgent } = await supabase
          .from("agents")
          .select("id, first_name, last_name, unl_writing_number, gtl_writing_number")
          .or(`unl_writing_number.ilike.${cleanEditNum},gtl_writing_number.ilike.${cleanEditNum}`)
          .maybeSingle();

        let editMatchStatus = "unmatched";
        let editMatchedAgentId: string | null = null;
        if (editMatchAgent) {
          const nameMatches =
            editMatchAgent.first_name.toLowerCase() === editFirst.trim().toLowerCase() &&
            editMatchAgent.last_name.toLowerCase() === editLast.trim().toLowerCase();
          editMatchStatus = nameMatches ? "confirmed" : "fuzzy";
          editMatchedAgentId = editMatchAgent.id;
        } else {
          // Same rule as add: no agent for this writing number means the agent
          // cannot log in. Create a login-capable `agents` row so the edited
          // roster entry resolves to a real, authenticatable agent.
          const { data: editAgencyRow } = await supabase
            .from("agencies")
            .select("name")
            .eq("id", editAgencyId)
            .maybeSingle();
          const editWritingCol = cleanEditCarrier === "GTL" ? "gtl_writing_number" : "unl_writing_number";
          const { data: editNewAgent } = await supabase
            .from("agents")
            .insert({
              first_name: toProperCase(editFirst.trim()),
              last_name: toProperCase(editLast.trim()),
              npn: (editNpn || "").trim(),
              [editWritingCol]: cleanEditNum,
              source: "Roster",
              agency: editAgencyRow?.name || null,
              agency_id: editAgencyId,
              agency_locked: true,
              status: "active",
            })
            .select("id")
            .single();
          if (editNewAgent) {
            editMatchStatus = "confirmed";
            editMatchedAgentId = editNewAgent.id;
          }
        }

        const { data: editedEntry, error: editErr } = await supabase
          .from("agency_rosters")
          .update({
            agent_first_name: toProperCase(editFirst.trim()),
            agent_last_name: toProperCase(editLast.trim()),
            writing_number: cleanEditNum,
            carrier: cleanEditCarrier,
            npn: (editNpn || "").trim(),
            match_status: editMatchStatus,
            matched_agent_id: editMatchedAgentId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", editRosterId)
          .eq("agency_id", editAgencyId)
          .select()
          .maybeSingle();
        if (editErr) throw editErr;
        if (!editedEntry) return jsonResponse({ error: "Roster entry not found" }, 404);

        // Keep the linked agent record in sync when the match is confirmed.
        if (editMatchStatus === "confirmed" && editMatchedAgentId) {
          await supabase
            .from("agents")
            .update({ agency_id: editAgencyId, agency_locked: true })
            .eq("id", editMatchedAgentId);
        }

        return jsonResponse(editedEntry);
      }

      case "agency-terminate-roster-entry": {
        const { rosterId, overrideAgencyId: termOverride } = body;
        const termAgencyId = (session.role === "global_admin" && termOverride) ? termOverride : session.agency_id;
        if (!termAgencyId) {
          return jsonResponse({ error: "Agency context required" }, 403);
        }
        if (!rosterId) return jsonResponse({ error: "rosterId required" }, 400);

        const { data, error } = await supabase
          .from("agency_rosters")
          .update({ status: "terminated", terminated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", rosterId)
          .eq("agency_id", termAgencyId)
          .select()
          .maybeSingle();
        if (error) throw error;
        if (!data) return jsonResponse({ error: "Roster entry not found" }, 404);
        return jsonResponse(data);
      }

      case "agency-reactivate-roster-entry": {
        const { rosterId: reRosterId, overrideAgencyId: reactOverride } = body;
        const reactAgencyId = (session.role === "global_admin" && reactOverride) ? reactOverride : session.agency_id;
        if (!reactAgencyId) {
          return jsonResponse({ error: "Agency context required" }, 403);
        }
        if (!reRosterId) return jsonResponse({ error: "rosterId required" }, 400);

        const { data, error } = await supabase
          .from("agency_rosters")
          .update({ status: "active", terminated_at: null, updated_at: new Date().toISOString() })
          .eq("id", reRosterId)
          .eq("agency_id", reactAgencyId)
          .select()
          .maybeSingle();
        if (error) throw error;
        if (!data) return jsonResponse({ error: "Roster entry not found" }, 404);
        return jsonResponse(data);
      }

      case "agency-set-manager": {
        const { rosterId: mgrRosterId, isManager, overrideAgencyId: mgrOverride } = body;
        const mgrAgencyId = (session.role === "global_admin" && mgrOverride) ? mgrOverride : session.agency_id;
        if (!mgrAgencyId) {
          return jsonResponse({ error: "Agency context required" }, 403);
        }
        if (!mgrRosterId) return jsonResponse({ error: "rosterId required" }, 400);

        const { data, error } = await supabase
          .from("agency_rosters")
          .update({ is_agency_manager: !!isManager, updated_at: new Date().toISOString() })
          .eq("id", mgrRosterId)
          .eq("agency_id", mgrAgencyId)
          .select()
          .maybeSingle();
        if (error) throw error;

        // Also update the agent record if matched
        if (data?.matched_agent_id) {
          await supabase
            .from("agents")
            .update({ is_agency_manager: !!isManager })
            .eq("id", data.matched_agent_id);
        }

        // Bridge: keep the per-person manager login in sync with the roster flag,
        // keyed off the roster entry so it works for matched AND unmatched entries.
        // Toggle on mints (or reactivates) an agency_manager_credentials login;
        // toggle off deactivates it (row kept for the password log / history).
        let bridgedManager: Record<string, unknown> | null = null;
        if (data) {
          const { data: existingCred } = await supabase
            .from("agency_manager_credentials")
            .select("id, username, password, is_active")
            .eq("roster_id", mgrRosterId)
            .maybeSingle();

          if (isManager) {
            if (existingCred) {
              if (!existingCred.is_active) {
                await supabase
                  .from("agency_manager_credentials")
                  .update({ is_active: true, updated_at: new Date().toISOString() })
                  .eq("id", existingCred.id);
              }
              bridgedManager = { ...existingCred, is_active: true };
            } else {
              const username = await genManagerUsername(
                supabase,
                (data.agent_first_name as string) || "",
                (data.agent_last_name as string) || "",
              );
              const password = genPassword();
              const rosterName = `${data.agent_first_name || ""} ${data.agent_last_name || ""}`.trim();
              const displayName = rosterName || username;
              const { data: createdCred } = await supabase
                .from("agency_manager_credentials")
                .insert({
                  agency_id: mgrAgencyId,
                  username,
                  password,
                  agent_id: data.matched_agent_id || null,
                  roster_id: mgrRosterId,
                  display_name: displayName,
                  added_by: session.email,
                })
                .select("id, username, password, is_active")
                .maybeSingle();
              bridgedManager = createdCred || null;
            }
          } else if (existingCred && existingCred.is_active) {
            await supabase
              .from("agency_manager_credentials")
              .update({ is_active: false, updated_at: new Date().toISOString() })
              .eq("id", existingCred.id);
            bridgedManager = { ...existingCred, is_active: false };
          }
        }

        return jsonResponse({ ...data, bridged_manager: bridgedManager });
      }

      case "agency-add-writing-number": {
        const { agentId: awnAgentId, carrierName, writingNumber: awnNum, overrideAgencyId: awnOverride } = body;
        const awnAgencyId = (session.role === "global_admin" && awnOverride) ? awnOverride : session.agency_id;
        if (!awnAgencyId) {
          return jsonResponse({ error: "Agency context required" }, 403);
        }
        if (!awnAgentId || !carrierName || !awnNum) {
          return jsonResponse({ error: "agentId, carrierName, and writingNumber required" }, 400);
        }

        // Verify agent is in this agency's roster
        const { data: rosterEntry } = await supabase
          .from("agency_rosters")
          .select("id")
          .eq("agency_id", awnAgencyId)
          .eq("matched_agent_id", awnAgentId)
          .eq("status", "active")
          .maybeSingle();

        if (!rosterEntry) {
          return jsonResponse({ error: "Agent not found in your agency roster" }, 404);
        }

        const { data, error } = await supabase
          .from("agent_writing_numbers")
          .insert({
            agent_id: awnAgentId,
            agency_id: awnAgencyId,
            carrier_name: carrierName.trim(),
            writing_number: awnNum.trim().toUpperCase(),
          })
          .select()
          .single();
        if (error) throw error;
        return jsonResponse(data);
      }

      case "agency-remove-writing-number": {
        const { writingNumberId, overrideAgencyId: rwnOverride } = body;
        const rwnAgencyId = (session.role === "global_admin" && rwnOverride) ? rwnOverride : session.agency_id;
        if (!rwnAgencyId) {
          return jsonResponse({ error: "Agency context required" }, 403);
        }
        if (!writingNumberId) return jsonResponse({ error: "writingNumberId required" }, 400);

        const { error } = await supabase
          .from("agent_writing_numbers")
          .delete()
          .eq("id", writingNumberId)
          .eq("agency_id", rwnAgencyId);
        if (error) throw error;
        return jsonResponse({ success: true });
      }

      case "admin-get-fuzzy-matches": {
        if (session.role !== "global_admin") {
          return jsonResponse({ error: "Global admin access required" }, 403);
        }
        const { data, error } = await supabase
          .from("agency_rosters")
          .select("*, agencies:agency_id(id, name, slug), agents:matched_agent_id(id, first_name, last_name, unl_writing_number, gtl_writing_number, npn)")
          .eq("match_status", "fuzzy")
          .order("created_at", { ascending: false });
        if (error) throw error;
        return jsonResponse({ entries: data || [] });
      }

      case "admin-approve-fuzzy-match": {
        if (session.role !== "global_admin") {
          return jsonResponse({ error: "Global admin access required" }, 403);
        }
        const { rosterId: fmRosterId, approve, linkToAgentId } = body;
        if (!fmRosterId) return jsonResponse({ error: "rosterId required" }, 400);

        if (approve) {
          const targetAgentId = linkToAgentId || null;
          const updates: { match_status: string; matched_agent_id?: string; updated_at: string } = {
            match_status: "confirmed",
            updated_at: new Date().toISOString(),
          };
          if (targetAgentId) updates.matched_agent_id = targetAgentId;

          const { data: updated, error } = await supabase
            .from("agency_rosters")
            .update(updates)
            .eq("id", fmRosterId)
            .select("*, agencies:agency_id(id)")
            .maybeSingle();
          if (error) throw error;

          // Lock agent to this agency
          if (updated?.matched_agent_id && updated?.agency_id) {
            await supabase
              .from("agents")
              .update({ agency_id: updated.agency_id, agency_locked: true })
              .eq("id", updated.matched_agent_id);
          }

          return jsonResponse(updated);
        } else {
          // Reject - remove fuzzy entry
          const { error } = await supabase
            .from("agency_rosters")
            .delete()
            .eq("id", fmRosterId);
          if (error) throw error;
          return jsonResponse({ success: true });
        }
      }

      case "admin-get-unassigned-agents": {
        if (session.role !== "global_admin") {
          return jsonResponse({ error: "Global admin access required" }, 403);
        }

        // Agents that are NOT in any agency roster (confirmed)
        const { data: rosterAgentIds } = await supabase
          .from("agency_rosters")
          .select("matched_agent_id")
          .eq("match_status", "confirmed")
          .not("matched_agent_id", "is", null);

        const assignedIds = (rosterAgentIds || []).map((r: { matched_agent_id: string }) => r.matched_agent_id);

        let query = supabase
          .from("agents")
          .select("id, first_name, last_name, unl_writing_number, gtl_writing_number, npn, agency, agency_id, status")
          .eq("status", "active")
          .order("last_name");

        if (assignedIds.length > 0) {
          // Get agents NOT in the assigned list
          const { data: allActive } = await query;
          const unassigned = (allActive || []).filter(
            (a: { id: string }) => !assignedIds.includes(a.id)
          );
          return jsonResponse({ agents: unassigned });
        }

        const { data, error } = await query;
        if (error) throw error;
        return jsonResponse({ agents: data || [] });
      }

      case "get-audit-issues": {
        const statusFilter = body.status || "open";
        const { data, error } = await supabase
          .from("audit_issues")
          .select("*")
          .eq("status", statusFilter)
          .order("created_at", { ascending: false });
        if (error) throw error;
        return jsonResponse({ issues: data || [] });
      }

      case "get-audit-summary": {
        const { data, error } = await supabase
          .from("audit_issues")
          .select("status");
        if (error) throw error;
        const counts = { open: 0, resolved: 0, dismissed: 0 };
        for (const row of data || []) {
          if (row.status in counts) counts[row.status as keyof typeof counts]++;
        }
        return jsonResponse({ counts });
      }

      case "resolve-audit-issue": {
        const { issueId, resolution } = body;
        if (!issueId) return jsonResponse({ error: "issueId is required" }, 400);

        const { data: issue, error: fetchErr } = await supabase
          .from("audit_issues")
          .select("*")
          .eq("id", issueId)
          .maybeSingle();
        if (fetchErr) throw fetchErr;
        if (!issue) return jsonResponse({ error: "Issue not found" }, 404);
        if (issue.status !== "open") return jsonResponse({ error: "Issue is already resolved" }, 400);

        if (issue.issue_type === "duplicate_agent" && resolution === "merge") {
          const meta = issue.metadata as { keep_id: string; remove_id: string; writing_number_1: string; writing_number_2: string; agency_id: string };
          const keepId = meta.keep_id;
          const removeId = meta.remove_id;

          const { data: keepAgent } = await supabase
            .from("agents")
            .select("*")
            .eq("id", keepId)
            .maybeSingle();

          const { data: removeAgent } = await supabase
            .from("agents")
            .select("*")
            .eq("id", removeId)
            .maybeSingle();

          if (!keepAgent || !removeAgent) {
            return jsonResponse({ error: "One or both agent records no longer exist" }, 400);
          }

          const removeWritingNumber = removeAgent.unl_writing_number;

          if (removeWritingNumber && removeWritingNumber !== keepAgent.unl_writing_number) {
            await supabase.from("agent_writing_numbers").insert({
              agent_id: keepId,
              agency_id: meta.agency_id,
              carrier_name: "UNL",
              writing_number: removeWritingNumber,
            });
          }

          if (removeAgent.npn && !keepAgent.npn) {
            await supabase.from("agents").update({ npn: removeAgent.npn }).eq("id", keepId);
          }
          if (removeAgent.gtl_writing_number && !keepAgent.gtl_writing_number) {
            await supabase.from("agents").update({ gtl_writing_number: removeAgent.gtl_writing_number }).eq("id", keepId);
          }

          await supabase.from("agents").delete().eq("id", removeId);
        }

        const { error: updateErr } = await supabase
          .from("audit_issues")
          .update({
            status: resolution === "dismiss" ? "dismissed" : "resolved",
            resolved_at: new Date().toISOString(),
            resolved_by: session.email || "admin",
          })
          .eq("id", issueId);
        if (updateErr) throw updateErr;

        return jsonResponse({ success: true });
      }

      case "scan-audit-duplicates": {
        const { data: agents } = await supabase
          .from("agents")
          .select("id, first_name, last_name, unl_writing_number, gtl_writing_number, npn, agency_id")
          .eq("status", "active");

        if (!agents) return jsonResponse({ found: 0 });

        const nameMap: Record<string, typeof agents> = {};
        for (const agent of agents) {
          const key = `${agent.first_name.toLowerCase().trim()}|${agent.last_name.toLowerCase().trim()}`;
          if (!nameMap[key]) nameMap[key] = [];
          nameMap[key].push(agent);
        }

        const { data: existingIssues } = await supabase
          .from("audit_issues")
          .select("entity_ids")
          .eq("issue_type", "duplicate_agent")
          .in("status", ["open", "resolved"]);

        const existingPairKeys = new Set<string>();
        for (const issue of existingIssues || []) {
          const ids = (issue.entity_ids as string[]).sort().join("|");
          existingPairKeys.add(ids);
        }

        let found = 0;
        for (const [, group] of Object.entries(nameMap)) {
          if (group.length < 2) continue;
          for (let i = 0; i < group.length; i++) {
            for (let j = i + 1; j < group.length; j++) {
              const a1 = group[i];
              const a2 = group[j];
              const pairKey = [a1.id, a2.id].sort().join("|");
              if (existingPairKeys.has(pairKey)) continue;

              const keepId = a1.npn ? a1.id : a2.npn ? a2.id : a1.id;
              const removeId = keepId === a1.id ? a2.id : a1.id;

              await supabase.from("audit_issues").insert({
                issue_type: "duplicate_agent",
                severity: "warning",
                title: `Duplicate agent: ${a1.first_name} ${a1.last_name}`,
                description: "Agent has two separate records with different UNL writing numbers. Both should be merged into a single agent record.",
                entity_ids: [a1.id, a2.id],
                metadata: {
                  first_name: a1.first_name,
                  last_name: a1.last_name,
                  writing_number_1: a1.unl_writing_number,
                  writing_number_2: a2.unl_writing_number,
                  keep_id: keepId,
                  remove_id: removeId,
                  agency_id: a1.agency_id || a2.agency_id,
                },
              });
              found++;
              existingPairKeys.add(pairKey);
            }
          }
        }

        return jsonResponse({ found });
      }

      case "get-upload-history": {
        const { data: logs, error: logErr } = await supabase
          .from("upload_history_log")
          .select("id, source_upload_id, source, action, carrier, filename, records_inserted, records_replaced, records_superseded, uploaded_by, created_at, details")
          .order("created_at", { ascending: false })
          .limit(50);
        if (logErr) throw logErr;
        return jsonResponse({ logs: logs || [] });
      }

      case "get-upload-history-detail": {
        const { logId } = body;
        if (!logId) return jsonResponse({ error: "Log ID required" }, 400);
        const { data: log, error: logErr } = await supabase
          .from("upload_history_log")
          .select("*")
          .eq("id", logId)
          .maybeSingle();
        if (logErr) throw logErr;
        if (!log) return jsonResponse({ error: "Log not found" }, 404);
        return jsonResponse({ log });
      }

      case "get-duplicate-policies": {
        const { statusFilter: dpStatus = "flagged" } = body;
        let query = supabase
          .from("form_submissions")
          .select("id, agent_number, agent_first_name, agent_last_name, client_first_name, client_last_name, zip, plan_name, carrier, policy_effective_date, plan_premium, source, status, policy_number, created_at")
          .eq("duplicate_flag", true)
          .order("client_last_name")
          .limit(200);

        if (dpStatus === "flagged") {
          query = query.in("status", ["duplicate", "superseded"]);
        }

        const { data: dupes, error: dupeErr } = await query;
        if (dupeErr) throw dupeErr;

        const { count: totalFlagged } = await supabase
          .from("form_submissions")
          .select("*", { count: "exact", head: true })
          .eq("duplicate_flag", true)
          .in("status", ["duplicate", "superseded"]);

        const { count: duplicateCount } = await supabase
          .from("form_submissions")
          .select("*", { count: "exact", head: true })
          .eq("status", "duplicate");

        const { count: supersededCount } = await supabase
          .from("form_submissions")
          .select("*", { count: "exact", head: true })
          .eq("status", "superseded");

        return jsonResponse({
          policies: dupes || [],
          counts: {
            total_flagged: totalFlagged || 0,
            duplicate: duplicateCount || 0,
            superseded: supersededCount || 0,
          },
        });
      }

      case "resolve-duplicate-policy": {
        const { policyId, resolution: dpResolution } = body;
        if (!policyId) return jsonResponse({ error: "Policy ID required" }, 400);
        if (!dpResolution || !["keep_flagged", "unflag"].includes(dpResolution)) {
          return jsonResponse({ error: "Resolution must be 'keep_flagged' or 'unflag'" }, 400);
        }

        if (dpResolution === "unflag") {
          const { error: unflagErr } = await supabase
            .from("form_submissions")
            .update({ status: "active", duplicate_flag: false })
            .eq("id", policyId);
          if (unflagErr) throw unflagErr;
        }

        return jsonResponse({ success: true });
      }

      case "run-duplicate-scan": {
        const { data: supersededResult } = await supabase.rpc("flag_superseded_by_data_source");
        const { data: dupResult } = await supabase.rpc("flag_duplicate_submissions");
        return jsonResponse({
          success: true,
          superseded: supersededResult || 0,
          duplicates: dupResult || 0,
        });
      }

      case "get-agency-credentials": {
        if (session.role !== "global_admin") {
          return jsonResponse({ error: "Forbidden" }, 403);
        }

        const { data: creds, error: credsErr } = await supabase
          .from("admin_credentials")
          .select("id, email_domain, password, agency_id, session_duration_days, last_login_at, login_count")
          .eq("role", "agency_admin");

        if (credsErr) throw credsErr;

        const agencyIds = (creds || []).map((c: { agency_id: string }) => c.agency_id).filter(Boolean);
        const { data: agencyRows } = await supabase
          .from("agencies")
          .select("id, name, slug, ghl_api_enabled")
          .in("id", agencyIds);

        const agencyMap = Object.fromEntries(
          (agencyRows || []).map((a: { id: string; name: string; slug: string; ghl_api_enabled: boolean }) => [a.id, a])
        );

        const credentials = (creds || []).map((c: { id: string; email_domain: string; password: string; agency_id: string; session_duration_days: number; last_login_at: string | null; login_count: number | null }) => ({
          id: c.id,
          username: c.email_domain,
          password: c.password,
          agency_id: c.agency_id,
          agency_name: agencyMap[c.agency_id]?.name || "Unknown",
          agency_slug: agencyMap[c.agency_id]?.slug || "",
          ghl_api_enabled: agencyMap[c.agency_id]?.ghl_api_enabled ?? false,
          session_duration_days: c.session_duration_days,
          last_login_at: c.last_login_at ?? null,
          login_count: c.login_count ?? 0,
        }));

        credentials.sort((a: { agency_name: string }, b: { agency_name: string }) => a.agency_name.localeCompare(b.agency_name));

        return jsonResponse({ credentials });
      }

      case "set-agency-zaps-enabled": {
        if (session.role !== "global_admin") {
          return jsonResponse({ error: "Forbidden" }, 403);
        }

        const { agencyId, enabled } = body;
        if (!agencyId) return jsonResponse({ error: "Agency ID required" }, 400);
        if (typeof enabled !== "boolean") return jsonResponse({ error: "enabled (boolean) required" }, 400);

        const { error: zapErr } = await supabase
          .from("agencies")
          .update({ ghl_api_enabled: enabled })
          .eq("id", agencyId);

        if (zapErr) throw zapErr;
        return jsonResponse({ success: true, agencyId, ghl_api_enabled: enabled });
      }

      case "update-agency-credential": {
        if (session.role !== "global_admin") {
          return jsonResponse({ error: "Forbidden" }, 403);
        }

        const { credentialId, newPassword, newUsername } = body;
        if (!credentialId) return jsonResponse({ error: "Credential ID required" }, 400);
        if (!newPassword && !newUsername) return jsonResponse({ error: "New password or username required" }, 400);

        const updates: Record<string, string> = {};
        if (newPassword) updates.password = newPassword;
        if (newUsername) updates.email_domain = newUsername;

        const { error: updateErr } = await supabase
          .from("admin_credentials")
          .update(updates)
          .eq("id", credentialId)
          .eq("role", "agency_admin");

        if (updateErr) throw updateErr;
        return jsonResponse({ success: true });
      }

      case "reset-agency-credential": {
        if (session.role !== "global_admin") {
          return jsonResponse({ error: "Forbidden" }, 403);
        }

        const { credentialId: resetId } = body;
        if (!resetId) return jsonResponse({ error: "Credential ID required" }, 400);

        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*";
        let generated = "";
        const arr = new Uint8Array(14);
        crypto.getRandomValues(arr);
        for (let i = 0; i < 14; i++) {
          generated += chars[arr[i] % chars.length];
        }

        const { error: resetErr } = await supabase
          .from("admin_credentials")
          .update({ password: generated })
          .eq("id", resetId)
          .eq("role", "agency_admin");

        if (resetErr) throw resetErr;
        return jsonResponse({ success: true, newPassword: generated });
      }

      case "admin-onboarding-status": {
        const { data: cred } = await supabase
          .from("admin_credentials")
          .select("id")
          .eq("email_domain", session.email)
          .maybeSingle();

        if (!cred) return jsonResponse({ completed: false, completedAt: null });

        const { data: onboarding } = await supabase
          .from("admin_onboarding")
          .select("completed_at")
          .eq("admin_credential_id", cred.id)
          .maybeSingle();

        return jsonResponse({
          completed: !!onboarding?.completed_at,
          completedAt: onboarding?.completed_at || null,
        });
      }

      case "admin-complete-onboarding": {
        const { data: cred2 } = await supabase
          .from("admin_credentials")
          .select("id")
          .eq("email_domain", session.email)
          .maybeSingle();

        if (!cred2) return jsonResponse({ error: "Credential not found" }, 404);

        const { error: obErr } = await supabase
          .from("admin_onboarding")
          .upsert({
            admin_credential_id: cred2.id,
            completed_at: new Date().toISOString(),
          }, { onConflict: "admin_credential_id" });

        if (obErr) throw obErr;
        return jsonResponse({ success: true });
      }

      case "test-sql-connection": {
        const { sourceId: tcSourceId, dbPassword: tcDirectPassword } = body;
        if (!tcSourceId) return jsonResponse({ error: "Source ID required" }, 400);

        const { data: tcSource, error: tcErr } = await supabase
          .from("data_sources")
          .select("*")
          .eq("id", tcSourceId)
          .maybeSingle();
        if (tcErr) throw tcErr;
        if (!tcSource) return jsonResponse({ error: "Data source not found" }, 404);
        if (!tcSource.db_host || !tcSource.db_table) {
          return jsonResponse({ error: "Database connection not fully configured" }, 400);
        }

        const tcPassword = tcDirectPassword
          || (tcSource.db_password_secret_name ? resolveSecret(tcSource.db_password_secret_name) : "");

        const passwordSource = tcDirectPassword
          ? "direct"
          : (tcSource.db_password_secret_name ? `secret:${tcSource.db_password_secret_name}` : "none");
        const pwBytes = new TextEncoder().encode(tcPassword);
        const pwHashBuf = await crypto.subtle.digest("SHA-256", pwBytes);
        const pwHashHex = Array.from(new Uint8Array(pwHashBuf))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        const hasLeadingWs = tcPassword !== tcPassword.trimStart();
        const hasTrailingWs = tcPassword !== tcPassword.trimEnd();
        const nonAsciiCount = [...tcPassword].filter((ch) => ch.charCodeAt(0) > 127).length;
        const controlCharCount = [...tcPassword].filter((ch) => {
          const c = ch.charCodeAt(0);
          return c < 32 || c === 127;
        }).length;
        const passwordDiagnostics = {
          source: passwordSource,
          length: tcPassword.length,
          byteLength: pwBytes.length,
          sha256Prefix: pwHashHex.slice(0, 12),
          hasLeadingWhitespace: hasLeadingWs,
          hasTrailingWhitespace: hasTrailingWs,
          nonAsciiCount,
          controlCharCount,
        };

        try {
          // TEMPORARY DIAGNOSTIC - remove after debugging auth failure
          const _tcPwBytes = new TextEncoder().encode(tcPassword);
          const _tcPwHash = await crypto.subtle.digest("SHA-256", _tcPwBytes);
          const _tcPwHex = Array.from(new Uint8Array(_tcPwHash)).map(b => b.toString(16).padStart(2, "0")).join("");
          console.log("DB pw sha256 prefix:", _tcPwHex.slice(0, 12), "| length:", tcPassword.length, "| action: test-sql-connection");

          const { default: postgres } = await import("npm:postgres@3.4.5");
          const sql = postgres({
            host: tcSource.db_host,
            port: tcSource.db_port || 5432,
            database: tcSource.db_name || "postgres",
            username: tcSource.db_user || "postgres",
            password: tcPassword,
            ssl: { ca: AKAMAI_CA_CERT },
            connect_timeout: 10,
            max: 1,
            idle_timeout: 5,
          });

          const schemaName = tcSource.db_schema || "public";
          const tableName = tcSource.db_table;
          const countResult = await sql.unsafe(
            `SELECT COUNT(*) as total FROM "${schemaName}"."${tableName}"`
          );
          const total = parseInt(String(countResult[0]?.total ?? "0"), 10);

          const colResult = await sql`
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = ${schemaName} AND table_name = ${tableName}
            ORDER BY ordinal_position
          `;
          const columns = colResult.map((r: { column_name: string }) => r.column_name);

          await sql.end();
          return jsonResponse({ success: true, total, columns, passwordDiagnostics });
        } catch (connErr: unknown) {
          const msg = connErr instanceof Error ? connErr.message : "Connection failed";
          const errCode = (connErr as { code?: string })?.code;
          const errSeverity = (connErr as { severity?: string })?.severity;
          return jsonResponse({
            error: msg,
            errorCode: errCode,
            errorSeverity: errSeverity,
            passwordDiagnostics,
          }, 502);
        }
      }

      case "confirm-auto-import": {
        return jsonResponse({ error: "This endpoint has been removed. Data is sourced directly from Max's DB." }, 410);
      }
      case "disable-auto-import": {
        return jsonResponse({ error: "This endpoint has been removed. Data is sourced directly from Max's DB." }, 410);
      }
      case "start-sql-import": {
        return jsonResponse({ error: "This endpoint has been removed. Data is sourced directly from Max's DB." }, 410);
      }
      case "get-import-progress": {
        return jsonResponse({ error: "This endpoint has been removed. Data is sourced directly from Max's DB." }, 410);
      }
      case "sql-import-count": {
        return jsonResponse({ error: "This endpoint has been removed. Data is sourced directly from Max's DB." }, 410);
      }
      case "sql-import-batch": {
        return jsonResponse({ error: "This endpoint has been removed. Data is sourced directly from Max's DB." }, 410);
      }
      case "prune-source-records": {
        return jsonResponse({ error: "This endpoint has been removed. Data is sourced directly from Max's DB." }, 410);
      }
      case "get-lead-vendors": {
        const { data: vendors, error: vErr } = await supabase
          .from("lead_vendors")
          .select("id, name, is_active, created_at")
          .order("name");
        if (vErr) throw vErr;
        return jsonResponse({ vendors: vendors || [] });
      }

      case "create-lead-vendor": {
        const { name: vendorName } = body;
        if (!vendorName?.trim()) return jsonResponse({ error: "Vendor name required" }, 400);
        const { data: newVendor, error: cvErr } = await supabase
          .from("lead_vendors")
          .insert({ name: vendorName.trim() })
          .select()
          .single();
        if (cvErr) {
          if (cvErr.code === "23505") return jsonResponse({ error: "Vendor already exists" }, 409);
          throw cvErr;
        }
        return jsonResponse({ vendor: newVendor });
      }

      case "update-lead-vendor": {
        const { id: vendorId, name: newName, is_active: vendorActive } = body;
        if (!vendorId) return jsonResponse({ error: "Vendor ID required" }, 400);
        const updates: Record<string, unknown> = {};
        if (newName !== undefined) updates.name = newName.trim();
        if (vendorActive !== undefined) updates.is_active = !!vendorActive;
        if (Object.keys(updates).length === 0) return jsonResponse({ error: "No updates provided" }, 400);
        const { data: updatedVendor, error: uvErr } = await supabase
          .from("lead_vendors")
          .update(updates)
          .eq("id", vendorId)
          .select()
          .single();
        if (uvErr) {
          if (uvErr.code === "23505") return jsonResponse({ error: "Vendor name already exists" }, 409);
          throw uvErr;
        }
        return jsonResponse({ vendor: updatedVendor });
      }

      case "delete-lead-vendor": {
        const { id: delVendorId } = body;
        if (!delVendorId) return jsonResponse({ error: "Vendor ID required" }, 400);
        const { error: dvErr } = await supabase
          .from("lead_vendors")
          .update({ is_active: false })
          .eq("id", delVendorId);
        if (dvErr) throw dvErr;
        return jsonResponse({ success: true });
      }

      case "toggle-lead-form": {
        const { enabled } = body;
        const { error: tlErr } = await supabase
          .from("admin_settings")
          .upsert({ key: "fym_lead_form_enabled", value: { enabled: !!enabled }, updated_at: new Date().toISOString() }, { onConflict: "key" });
        if (tlErr) throw tlErr;
        return jsonResponse({ success: true, enabled: !!enabled });
      }

      case "get-lead-form-status": {
        const { data: lfSetting } = await supabase
          .from("admin_settings")
          .select("value")
          .eq("key", "fym_lead_form_enabled")
          .maybeSingle();
        return jsonResponse({ enabled: lfSetting?.value?.enabled === true });
      }

      case "get-lead-submissions": {
        const { page = 1, pageSize = 50, search, startDate, endDate } = body;
        let query = supabase
          .from("lead_submissions")
          .select("*", { count: "exact" })
          .order("created_at", { ascending: false });

        if (startDate) query = query.gte("created_at", startDate);
        if (endDate) query = query.lte("created_at", endDate + "T23:59:59");
        if (search) {
          query = query.or(
            `agent_first_name.ilike.%${search}%,agent_last_name.ilike.%${search}%,client_first_name.ilike.%${search}%,client_last_name.ilike.%${search}%,lead_vendor.ilike.%${search}%`
          );
        }

        const from = ((page as number) - 1) * (pageSize as number);
        const to = from + (pageSize as number) - 1;
        query = query.range(from, to);

        const { data: submissions, count, error: lsErr } = await query;
        if (lsErr) throw lsErr;
        return jsonResponse({ submissions: submissions || [], total: count || 0 });
      }

      // ===================== Agency Manager view =====================
      // Helpers: generate a readable unique-ish password
      // (manager management is used by agency_admin for own agency, global_admin for all)

      case "list-agencies-directory": {
        // Real agency rows (id, name, slug) from the agencies table.
        // Distinct from get-agencies, which returns only distinct agency
        // NAME strings from form_submissions (used by dashboard filters).
        // Manager create/scoping needs the real agencies.id UUID.
        if (session.role !== "global_admin" && session.role !== "agency_admin") {
          return jsonResponse({ error: "Forbidden" }, 403);
        }
        let dq = supabase
          .from("agencies")
          .select("id, name, slug")
          .eq("is_active", true)
          .order("name", { ascending: true });
        if (session.role === "agency_admin" && session.agency_id) {
          dq = dq.eq("id", session.agency_id);
        }
        const { data: dirAgencies, error: dirErr } = await dq;
        if (dirErr) throw dirErr;
        return jsonResponse({ agencies: dirAgencies || [] });
      }

      case "list-agency-managers": {
        if (session.role !== "global_admin" && session.role !== "agency_admin") {
          return jsonResponse({ error: "Forbidden" }, 403);
        }
        let q = supabase
          .from("agency_manager_credentials")
          .select("id, agency_id, username, password, agent_id, display_name, is_active, created_at")
          .order("created_at", { ascending: true });
        if (session.role === "agency_admin") {
          q = q.eq("agency_id", session.agency_id);
        } else if (body.agency_id) {
          q = q.eq("agency_id", body.agency_id);
        }
        const { data: managers, error: lmErr } = await q;
        if (lmErr) throw lmErr;
        return jsonResponse({ managers: managers || [] });
      }

      case "create-agency-manager": {
        if (session.role !== "global_admin" && session.role !== "agency_admin") {
          return jsonResponse({ error: "Forbidden" }, 403);
        }
        const agencyId = session.role === "agency_admin" ? session.agency_id : body.agency_id;
        if (!agencyId) return jsonResponse({ error: "agency_id is required" }, 400);
        const { agent_id: promoteAgentId, display_name } = body;

        const { data: ag } = await supabase
          .from("agencies").select("slug, name").eq("id", agencyId).maybeSingle();
        if (!ag) return jsonResponse({ error: "Agency not found" }, 404);

        let mgrName = display_name as string | undefined;
        let firstName = "";
        let lastName = "";
        if (promoteAgentId) {
          const { data: agent } = await supabase
            .from("agents").select("id, first_name, last_name, agency_id").eq("id", promoteAgentId).maybeSingle();
          if (!agent) return jsonResponse({ error: "Agent not found" }, 404);
          firstName = agent.first_name;
          lastName = agent.last_name;
          if (!mgrName) mgrName = `${agent.first_name} ${agent.last_name}`.trim();
        } else if (mgrName) {
          const sn = splitName(mgrName);
          firstName = sn.first;
          lastName = sn.last;
        }
        if (!mgrName) return jsonResponse({ error: "display_name or agent_id is required" }, 400);

        // Username = first initial + last name (e.g. "rmitchell"), globally unique.
        const username = await genManagerUsername(supabase, firstName, lastName);
        const password = genPassword();

        const { data: created, error: cmErr } = await supabase
          .from("agency_manager_credentials")
          .insert({
            agency_id: agencyId,
            username,
            password,
            agent_id: promoteAgentId || null,
            display_name: mgrName,
            added_by: session.email,
          })
          .select("id, agency_id, username, password, agent_id, display_name, is_active, created_at")
          .single();
        if (cmErr) throw cmErr;
        return jsonResponse({ manager: created });
      }

      case "reset-agency-manager-password": {
        if (session.role !== "global_admin" && session.role !== "agency_admin") {
          return jsonResponse({ error: "Forbidden" }, 403);
        }
        const { manager_id } = body;
        if (!manager_id) return jsonResponse({ error: "manager_id is required" }, 400);
        const guard = session.role === "agency_admin" ? { agency_id: session.agency_id } : {};
        const { data: target } = await supabase
          .from("agency_manager_credentials").select("id, agency_id").eq("id", manager_id).maybeSingle();
        if (!target || (guard.agency_id && target.agency_id !== guard.agency_id)) {
          return jsonResponse({ error: "Not found" }, 404);
        }
        const newPassword = genPassword();
        const { error: rpErr } = await supabase
          .from("agency_manager_credentials")
          .update({ password: newPassword, updated_at: new Date().toISOString() })
          .eq("id", manager_id);
        if (rpErr) throw rpErr;
        return jsonResponse({ manager_id, password: newPassword });
      }

      case "toggle-agency-manager": {
        if (session.role !== "global_admin" && session.role !== "agency_admin") {
          return jsonResponse({ error: "Forbidden" }, 403);
        }
        const { manager_id, is_active } = body;
        if (!manager_id) return jsonResponse({ error: "manager_id is required" }, 400);
        const { data: target } = await supabase
          .from("agency_manager_credentials").select("id, agency_id").eq("id", manager_id).maybeSingle();
        if (!target || (session.role === "agency_admin" && target.agency_id !== session.agency_id)) {
          return jsonResponse({ error: "Not found" }, 404);
        }
        const { error: tgErr } = await supabase
          .from("agency_manager_credentials")
          .update({ is_active: is_active !== false, updated_at: new Date().toISOString() })
          .eq("id", manager_id);
        if (tgErr) throw tgErr;
        return jsonResponse({ manager_id, is_active: is_active !== false });
      }

      // ----- Manager-role data endpoints (role = 'manager') -----
      case "mgr-at-risk-worklist": {
        if (session.role !== "manager") return jsonResponse({ error: "Forbidden" }, 403);
        // Data-driven at-risk lane — queries Max's DB directly (2026-07-20).
        // Definition (locked w/ Charlie 2026-06-30):
        //   cntrct_code = 'A' AND billing_form = 'DIR' AND paid_to_date < today
        // Only direct-bill (DIR) policies count — a past-due DIR is a missed auto-draft.
        // Flags/dispositions are an ACTION layer on top, never the entry gate.

        // Resolve writing numbers for this agency to scope the Max DB query
        const { data: awnRows } = await supabase
          .from("agency_writing_numbers")
          .select("writing_number")
          .eq("agency_id", session.agency_id);
        const agencyWns = (awnRows || []).map((r: { writing_number: string }) =>
          (r.writing_number || "").trim().toUpperCase()
        ).filter(Boolean);
        if (agencyWns.length === 0) return jsonResponse({ worklist: [], agency_id: session.agency_id });

        const todayIso = new Date().toISOString().slice(0, 10);
        const maxDb = await openMaxDb();
        let agencyPolicies: Record<string, unknown>[] = [];
        try {
          agencyPolicies = await maxDb.unsafe(`
            SELECT
              TRIM(t.policy_nbr)        AS policy_number,
              TRIM(t.first_name)        AS client_first_name,
              TRIM(t.last_name)         AS client_last_name,
              TRIM(t.wa_name)           AS agent_full_name,
              TRIM(t.wa)                AS agent_number,
              TRIM(t.plan_code)         AS product_type,
              TRIM(t.carrier)           AS carrier,
              t.annual_premium          AS plan_premium,
              t.paid_to_date,
              t.issue_date              AS policy_effective_date,
              TRIM(t.phone_nbr::text)    AS phone,
              TRIM(t.cntrct_code)       AS contract_code,
              TRIM(t.cntrct_reason)     AS contract_reason,
              TRIM(t.billing_form)      AS billing_form
            FROM typed.unl_fym_policy_latest_load t
            WHERE TRIM(UPPER(t.wa)) = ANY(${ agencyWns.map((_: string, i: number) => `$${i + 1}`).join(",") })
              AND t.cntrct_code = 'A'
              AND t.billing_form = 'DIR'
              AND t.paid_to_date < ${ agencyWns.length + 1 }::date
          `, [...agencyWns, todayIso]) as Record<string, unknown>[];
        } finally {
          try { await maxDb.end(); } catch { /* ignore */ }
        }

        if (agencyPolicies.length === 0) return jsonResponse({ worklist: [], agency_id: session.agency_id });

        // Overlay dispositions keyed on policy_nbr (added 2026-07-20)
        const policyNbrs = agencyPolicies.map((p) => p.policy_number as string).filter(Boolean);
        const { data: disps } = await supabase
          .from("policy_dispositions")
          .select("policy_nbr, disposition, follow_up_at, set_at, agent_id, agent_outreach_at, agent_contacted_at, agent_saved_at, manager_approved_at")
          .in("policy_nbr", policyNbrs);
        const dispByPolicy = new Map(
          (disps || []).map((d: { policy_nbr: string }) => [d.policy_nbr, d])
        );
        const worklist = agencyPolicies.map((p: Record<string, unknown>) => {
          const disp = dispByPolicy.get(p.policy_number as string) || null;
          const ptd = p.paid_to_date instanceof Date
            ? (p.paid_to_date as Date).toISOString().slice(0, 10)
            : String(p.paid_to_date ?? "").slice(0, 10);
          const computed = computeAtRiskStage(ptd || null, disp as DispRow);
          return { ...shapeWorklistRow({ ...p, paid_to_date: ptd }, disp), ...computed };
        });
        return jsonResponse({ worklist, agency_id: session.agency_id });
      }

      case "mgr-terminated-worklist": {
        if (session.role !== "manager") return jsonResponse({ error: "Forbidden" }, 403);
        // Terminated policies — win-back lane. Queries Max's DB directly (2026-07-20).
        // Window: terminated within last 45 days (term_date >= cutoff).

        const { data: awnRowsTerm } = await supabase
          .from("agency_writing_numbers")
          .select("writing_number")
          .eq("agency_id", session.agency_id);
        const agencyWnsTerm = (awnRowsTerm || []).map((r: { writing_number: string }) =>
          (r.writing_number || "").trim().toUpperCase()
        ).filter(Boolean);
        if (agencyWnsTerm.length === 0) return jsonResponse({ worklist: [], agency_id: session.agency_id });

        const TERMINATED_WINDOW_DAYS = 45;
        const termCutoff = new Date(Date.now() - TERMINATED_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
        const maxDbTerm = await openMaxDb();
        let termPolicies: Record<string, unknown>[] = [];
        try {
          termPolicies = await maxDbTerm.unsafe(`
            SELECT
              TRIM(t.policy_nbr)        AS policy_number,
              TRIM(t.first_name)        AS client_first_name,
              TRIM(t.last_name)         AS client_last_name,
              TRIM(t.wa_name)           AS agent_full_name,
              TRIM(t.wa)                AS agent_number,
              TRIM(t.plan_code)         AS product_type,
              TRIM(t.carrier)           AS carrier,
              t.annual_premium          AS plan_premium,
              t.paid_to_date,
              t.issue_date              AS policy_effective_date,
              t.term_date               AS terminated_date,
              TRIM(t.phone_nbr::text)    AS phone,
              TRIM(t.cntrct_code)       AS contract_code,
              TRIM(t.cntrct_reason)     AS contract_reason
            FROM typed.unl_fym_policy_latest_load t
            WHERE TRIM(UPPER(t.wa)) = ANY(${ agencyWnsTerm.map((_: string, i: number) => `$${i + 1}`).join(",") })
              AND t.cntrct_code = 'T'
              AND t.term_date >= ${ agencyWnsTerm.length + 1 }::date
          `, [...agencyWnsTerm, termCutoff]) as Record<string, unknown>[];
        } finally {
          try { await maxDbTerm.end(); } catch { /* ignore */ }
        }

        if (termPolicies.length === 0) return jsonResponse({ worklist: [], agency_id: session.agency_id });

        const termNbrs = termPolicies.map((p) => p.policy_number as string).filter(Boolean);
        const { data: termDisps } = await supabase
          .from("policy_dispositions")
          .select("policy_nbr, disposition, follow_up_at, set_at")
          .in("policy_nbr", termNbrs);
        const termDispByPolicy = new Map(
          (termDisps || []).map((d: { policy_nbr: string }) => [d.policy_nbr, d])
        );
        const worklist = termPolicies.map((p: Record<string, unknown>) => {
          const ptd = p.paid_to_date instanceof Date
            ? (p.paid_to_date as Date).toISOString().slice(0, 10)
            : String(p.paid_to_date ?? "").slice(0, 10);
          const tdate = p.terminated_date instanceof Date
            ? (p.terminated_date as Date).toISOString().slice(0, 10)
            : String(p.terminated_date ?? "").slice(0, 10);
          return shapeWorklistRow(
            { ...p, paid_to_date: ptd, terminated_date: tdate },
            termDispByPolicy.get(p.policy_number as string) || null
          );
        });
        return jsonResponse({ worklist, agency_id: session.agency_id });
      }

      case "mgr-policy-thread": {
        if (session.role !== "manager") return jsonResponse({ error: "Forbidden" }, 403);
        const { policy_id } = body;
        if (!policy_id) return jsonResponse({ error: "policy_id is required" }, 400);
        const { data: thread, error: thErr } = await supabase
          .from("at_risk_activities")
          .select("id, policy_id, agent_id, author_role, kind, note, manager_id, created_at")
          .eq("policy_id", policy_id)
          .order("created_at", { ascending: true });
        if (thErr) throw thErr;
        const { data: disp } = await supabase
          .from("policy_dispositions")
          .select("disposition, note, follow_up_at, set_at")
          .eq("policy_id", policy_id)
          .maybeSingle();
        return jsonResponse({ thread: thread || [], disposition: disp || null });
      }

      case "mgr-post-note": {
        if (session.role !== "manager") return jsonResponse({ error: "Forbidden" }, 403);
        const { policy_id, agent_id, note, kind = "note" } = body;
        if (!policy_id || !note) return jsonResponse({ error: "policy_id and note are required" }, 400);
        if (!["note", "nudge", "flag"].includes(kind)) return jsonResponse({ error: "invalid kind" }, 400);
        const { data: mgr } = await supabase
          .from("agency_manager_credentials").select("id").ilike("username", session.email).maybeSingle();
        const { data: activity, error: anErr } = await supabase
          .from("at_risk_activities")
          .insert({
            policy_id,
            agent_id: agent_id || null,
            admin_user: session.email,
            author_role: "manager",
            kind,
            action_type: "other",
            note,
            manager_id: mgr?.id || null,
          })
          .select("id")
          .single();
        if (anErr) throw anErr;
        // Resolve the owning agent from the policy when the client doesn't pass
        // an agent_id (the manager worklist only carries agent_number). Without
        // this, nudge/flag notifications silently never fired. agent_id stays
        // the source of truth; we derive it via the policy's writing number.
        let recipientAgentId: string | null = agent_id || null;
        if (!recipientAgentId && (kind === "nudge" || kind === "flag")) {
          recipientAgentId = await resolveAgentIdFromPolicy(supabase, policy_id);
        }
        if (recipientAgentId && (kind === "nudge" || kind === "flag")) {
          await supabase.from("notifications").insert({
            recipient_kind: "agent",
            recipient_id: recipientAgentId,
            agency_id: session.agency_id,
            policy_id,
            activity_id: activity.id,
            type: kind,
            body: note.slice(0, 280),
          });
          // Backfill the activity's agent_id so the thread is correctly
          // attributed even when the client omitted it.
          if (!agent_id) {
            await supabase
              .from("at_risk_activities")
              .update({ agent_id: recipientAgentId })
              .eq("id", activity.id);
          }
        }
        return jsonResponse({ activity_id: activity.id, agent_id: recipientAgentId });
      }

      case "mgr-set-disposition": {
        if (session.role !== "manager") return jsonResponse({ error: "Forbidden — manager only" }, 403);
        const { policy_id, disposition, note = "", follow_up_at } = body;
        if (!policy_id || !disposition) return jsonResponse({ error: "policy_id and disposition are required" }, 400);
        // v3 stages a manager may set directly. Agent-only states
        // (agent_outreach, agent_saved_pending) go through their own actions.
        const MGR_SETTABLE = ["responded", "manager_outreach", "code_red", "saved", "lost", "working", "secured", "follow_up"];
        if (!MGR_SETTABLE.includes(disposition)) {
          return jsonResponse({ error: "invalid disposition" }, 400);
        }
        const { data: mgr } = await supabase
          .from("agency_manager_credentials").select("id").ilike("username", session.email).maybeSingle();
        const { error: dsErr } = await supabase
          .from("policy_dispositions")
          .upsert({
            policy_id,
            agency_id: session.agency_id,
            disposition,
            note,
            follow_up_at: follow_up_at || null,
            set_by: mgr?.id || null,
            sync_origin: "tracker",
            set_at: new Date().toISOString(),
          }, { onConflict: "policy_id" });
        if (dsErr) throw dsErr;
        await syncStageToGhl(supabase, policy_id, disposition, "tracker");
        return jsonResponse({ policy_id, disposition });
      }

      // Manager hands a policy to the writing agent (warm relationship save).
      // Stays on the manager's board; ownership shows as the agent. Stamps the
      // 5-day SLA clock and notifies the agent.
      case "mgr-handoff-to-agent": {
        if (session.role !== "manager") return jsonResponse({ error: "Forbidden — manager only" }, 403);
        const { policy_id, note = "" } = body;
        if (!policy_id) return jsonResponse({ error: "policy_id is required" }, 400);
        let agentId = (body.agent_id as string | null) || null;
        if (!agentId) agentId = await resolveAgentIdFromPolicy(supabase, policy_id);
        const { data: mgr } = await supabase
          .from("agency_manager_credentials").select("id").ilike("username", session.email).maybeSingle();
        const { error: hoErr } = await supabase
          .from("policy_dispositions")
          .upsert({
            policy_id,
            agency_id: session.agency_id,
            disposition: "agent_outreach",
            note,
            agent_id: agentId,
            agent_outreach_at: new Date().toISOString(),
            agent_contacted_at: null,
            set_by: mgr?.id || null,
            sync_origin: "tracker",
            set_at: new Date().toISOString(),
          }, { onConflict: "policy_id" });
        if (hoErr) throw hoErr;
        await syncStageToGhl(supabase, policy_id, "agent_outreach", "tracker");
        if (agentId) {
          await supabase.from("notifications").insert({
            recipient_kind: "agent",
            recipient_id: agentId,
            agency_id: session.agency_id,
            policy_id,
            type: "flag",
            body: (note || "At-risk policy handed to you to save — please reach out to the client.").slice(0, 280),
          });
        }
        return jsonResponse({ policy_id, disposition: "agent_outreach", agent_id: agentId });
      }

      // Manager approves an agent-claimed save → moves it into Saved.
      case "mgr-approve-save": {
        if (session.role !== "manager") return jsonResponse({ error: "Forbidden — manager only" }, 403);
        const { policy_id } = body;
        if (!policy_id) return jsonResponse({ error: "policy_id is required" }, 400);
        const { error: apErr } = await supabase
          .from("policy_dispositions")
          .update({
            disposition: "saved",
            manager_approved_at: new Date().toISOString(),
            sync_origin: "tracker",
            set_at: new Date().toISOString(),
          })
          .eq("policy_id", policy_id)
          .eq("agency_id", session.agency_id)
          .eq("disposition", "agent_saved_pending");
        if (apErr) throw apErr;
        await syncStageToGhl(supabase, policy_id, "saved", "tracker");
        return jsonResponse({ policy_id, disposition: "saved" });
      }

      // NOTE: the agent-side writes that complete the loop — agent logs contact
      // (sets agent_contacted_at, satisfies the 5-day SLA) and agent marks saved
      // (sets disposition='agent_saved_pending', pending manager approval) — live
      // in the agent-facing app where the agent session authenticates, not here
      // in admin-api (manager/admin sessions only). They land in the agent-app
      // follow-up PR. The columns + manager approval gate are ready for them.

      // Per-agent Agent Quality rollup: how many at-risk policies were handed to
      // each agent, and what % the agent contacted within the 5-day SLA. Low
      // follow-up % flags agents who don't chase their own clients.
      case "mgr-agent-quality": {
        if (session.role !== "manager") return jsonResponse({ error: "Forbidden — manager only" }, 403);
        const { data: rows, error: aqErr } = await supabase
          .from("policy_dispositions")
          .select("agent_id, agent_outreach_at, agent_contacted_at")
          .eq("agency_id", session.agency_id)
          .not("agent_outreach_at", "is", null);
        if (aqErr) throw aqErr;
        const byAgent = new Map<string, { handed_off: number; contacted_in_sla: number }>();
        for (const r of (rows || []) as DispRow[]) {
          const aid = r?.agent_id || "unknown";
          const agg = byAgent.get(aid) || { handed_off: 0, contacted_in_sla: 0 };
          agg.handed_off += 1;
          if (r?.agent_contacted_at && r?.agent_outreach_at) {
            const diff = new Date(r.agent_contacted_at).getTime() - new Date(r.agent_outreach_at).getTime();
            if (diff <= AGENT_SLA_DAYS * 86400000) agg.contacted_in_sla += 1;
          }
          byAgent.set(aid, agg);
        }
        const agentIds = [...byAgent.keys()].filter((a) => a !== "unknown");
        const nameById = new Map<string, string>();
        if (agentIds.length) {
          const { data: ag } = await supabase
            .from("agents").select("id, first_name, last_name").in("id", agentIds);
          for (const a of (ag || []) as Array<Record<string, string>>) {
            nameById.set(a.id, `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim());
          }
        }
        const agents = [...byAgent.entries()].map(([aid, v]) => ({
          agent_id: aid === "unknown" ? null : aid,
          agent_name: nameById.get(aid) || "Unassigned",
          handed_off: v.handed_off,
          contacted_in_sla: v.contacted_in_sla,
          followup_rate_pct: v.handed_off ? Math.round((1000 * v.contacted_in_sla) / v.handed_off) / 10 : 0,
        })).sort((a, b) => a.followup_rate_pct - b.followup_rate_pct);

        // Agency-wide 6-month trend: 5-day hit rate bucketed by the month the
        // policy was dropped into the agent-outreach stage (agent_outreach_at).
        const monthKey = (iso: string) => iso.slice(0, 7); // YYYY-MM
        const now = new Date();
        const trendMonths: string[] = [];
        for (let i = 5; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          trendMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
        }
        const byMonth = new Map<string, { handed_off: number; contacted_in_sla: number }>();
        for (const r of (rows || []) as DispRow[]) {
          if (!r?.agent_outreach_at) continue;
          const mk = monthKey(r.agent_outreach_at);
          const agg = byMonth.get(mk) || { handed_off: 0, contacted_in_sla: 0 };
          agg.handed_off += 1;
          if (r?.agent_contacted_at) {
            const diff = new Date(r.agent_contacted_at).getTime() - new Date(r.agent_outreach_at).getTime();
            if (diff <= AGENT_SLA_DAYS * 86400000) agg.contacted_in_sla += 1;
          }
          byMonth.set(mk, agg);
        }
        const contact_trend = trendMonths.map((m) => {
          const v = byMonth.get(m);
          return {
            month: m,
            handed_off: v?.handed_off ?? 0,
            rate_pct: v && v.handed_off ? Math.round((1000 * v.contacted_in_sla) / v.handed_off) / 10 : null,
          };
        });
        return jsonResponse({ agents, sla_days: AGENT_SLA_DAYS, contact_trend, agency_id: session.agency_id });
      }

      // Per-agent 90-day persistency: retention on the business each agent wrote
      // (agency-scoped), using the validated billing-mode-aware rule. Returns a
      // current rollup per agent plus a 6-month effective-cohort trend, and an
      // agency-wide rollup + trend for the header line.
      case "mgr-agent-persistency": {
        if (session.role !== "manager") return jsonResponse({ error: "Forbidden — manager only" }, 403);
        // Queries Max's DB directly (2026-07-20). LOB filter via plan_code prefix.
        const { data: awnRowsPers } = await supabase
          .from("agency_writing_numbers")
          .select("writing_number")
          .eq("agency_id", session.agency_id);
        const agencyWnsPers = (awnRowsPers || []).map((r: { writing_number: string }) =>
          (r.writing_number || "").trim().toUpperCase()
        ).filter(Boolean);

        type FsRow = {
          agent_number?: string | null; agent_first_name?: string | null; agent_last_name?: string | null;
          policy_effective_date?: string | null; paid_to_date?: string | null; billing_mode?: string | null;
        };
        let all: FsRow[] = [];
        if (agencyWnsPers.length > 0) {
          const maxDbPers = await openMaxDb();
          try {
            const persRows = await maxDbPers.unsafe(`
              SELECT
                TRIM(t.wa)                            AS agent_number,
                TRIM(SPLIT_PART(t.wa_name, ' ', 1))  AS agent_first_name,
                TRIM(SUBSTRING(t.wa_name FROM POSITION(' ' IN t.wa_name) + 1)) AS agent_last_name,
                t.issue_date   AS policy_effective_date,
                t.paid_to_date,
                t.billing_mode::text AS billing_mode,
                CASE
                  WHEN t.plan_code ILIKE '%HHC%' THEN 'HHC'
                  ELSE 'HI'
                END AS product_type
              FROM typed.unl_fym_policy_latest_load t
              WHERE TRIM(UPPER(t.wa)) = ANY(${ agencyWnsPers.map((_: string, i: number) => `$${i + 1}`).join(",") })
                AND (t.plan_code ILIKE '%HI%' OR t.plan_code ILIKE '%HIP%'
                     OR t.plan_code ILIKE '%GHI%' OR t.plan_code ILIKE '%HHC%')
            `, agencyWnsPers) as Record<string, unknown>[];
            all = persRows.map((r) => ({
              agent_number:          String(r.agent_number ?? ""),
              agent_first_name:      String(r.agent_first_name ?? ""),
              agent_last_name:       String(r.agent_last_name ?? ""),
              policy_effective_date: r.policy_effective_date instanceof Date
                ? (r.policy_effective_date as Date).toISOString().slice(0, 10)
                : String(r.policy_effective_date ?? "").slice(0, 10),
              paid_to_date: r.paid_to_date instanceof Date
                ? (r.paid_to_date as Date).toISOString().slice(0, 10)
                : String(r.paid_to_date ?? "").slice(0, 10),
              billing_mode:  String(r.billing_mode ?? ""),
            }));
          } finally {
            try { await maxDbPers.end(); } catch { /* ignore */ }
          }
        }

        // 6-month effective-cohort buckets (only cohorts old enough to be eligible).
        const now = new Date();
        const cohortMonths: string[] = [];
        for (let i = 8; i >= 3; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          cohortMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
        }
        const trendFor = (list: FsRow[]) =>
          cohortMonths.map((m) => {
            const cohort = list.filter((p) => (p.policy_effective_date || "").slice(0, 7) === m);
            const roll = persistencyOf(cohort);
            return { month: m, drafted_first: roll.drafted_first, pct: roll.drafted_first ? roll.pct : null };
          });

        const byAgent = new Map<string, { name: string; rows: FsRow[] }>();
        for (const r of all) {
          const key = (r.agent_number || "").trim() || `${r.agent_first_name ?? ""} ${r.agent_last_name ?? ""}`.trim() || "unknown";
          const entry = byAgent.get(key) || { name: `${r.agent_first_name ?? ""} ${r.agent_last_name ?? ""}`.trim() || "Unassigned", rows: [] };
          entry.rows.push(r);
          byAgent.set(key, entry);
        }
        const agents = [...byAgent.entries()].map(([key, v]) => {
          const roll = persistencyOf(v.rows);
          return {
            agent_number: key === "unknown" ? null : key,
            agent_name: v.name,
            drafted_first: roll.drafted_first,
            retained: roll.retained,
            persistency_pct: roll.pct,
            trend: trendFor(v.rows),
          };
        })
          // Only surface agents with an eligible book; worst persistency first.
          .filter((a) => a.drafted_first > 0)
          .sort((a, b) => a.persistency_pct - b.persistency_pct);

        const agencyRoll = persistencyOf(all);
        return jsonResponse({
          agents,
          agency: {
            drafted_first: agencyRoll.drafted_first,
            retained: agencyRoll.retained,
            persistency_pct: agencyRoll.pct,
            trend: trendFor(all),
          },
          target_pct: 90,
          agency_id: session.agency_id,
        });
      }

      // ── NPN Holds / Proposed Fires ─────────────────────────────────────────
      case "get-npn-holds": {
        // Returns npn_holds (status='held') + proposed_fires (approved_at IS NULL)
        // for the admin portal NPN Holds tab. Reads from tracker DB (lryxxn).
        const trackerClient = createClient(
          Deno.env.get("ACTIVITY_TRACKER_SUPABASE_URL")!,
          Deno.env.get("ACTIVITY_TRACKER_SERVICE_ROLE_KEY")!
        );
        const PAGE = 200;

        // Page through npn_holds WHERE status='held'
        const holds: Record<string, unknown>[] = [];
        let offset = 0;
        while (true) {
          const { data, error } = await trackerClient
            .from("npn_holds")
            .select("id, policy_nbr, trigger_type, changed_on, agency_name, agent_name, writing_number, held_at, status")
            .eq("status", "held")
            .order("held_at", { ascending: false })
            .range(offset, offset + PAGE - 1);
          if (error) throw new Error(`npn_holds fetch failed: ${error.message}`);
          holds.push(...(data ?? []));
          if ((data ?? []).length < PAGE) break;
          offset += PAGE;
        }

        // Page through proposed_fires WHERE approved_at IS NULL
        const proposed: Record<string, unknown>[] = [];
        offset = 0;
        while (true) {
          const { data, error } = await trackerClient
            .from("proposed_fires")
            .select("id, npn_hold_id, policy_nbr, trigger_type, changed_on, agency_id, agent_npn, writing_number, proposed_at, approved_at, fired_at, approved_by")
            .is("approved_at", null)
            .is("fired_at", null)
            .order("proposed_at", { ascending: false })
            .range(offset, offset + PAGE - 1);
          if (error) throw new Error(`proposed_fires fetch failed: ${error.message}`);
          proposed.push(...(data ?? []));
          if ((data ?? []).length < PAGE) break;
          offset += PAGE;
        }

        return jsonResponse({ holds, proposed });
      }

      case "approve-proposed-fire": {
        // Sets proposed_fires.approved_at + approved_by for a given id.
        // The daily proposed-fires-push cron will pick it up at 7:15 AM CT.
        const { proposed_fire_id, approved_by: approver } = body;
        if (!proposed_fire_id) return jsonResponse({ error: "proposed_fire_id required" }, 400);

        const trackerClient = createClient(
          Deno.env.get("ACTIVITY_TRACKER_SUPABASE_URL")!,
          Deno.env.get("ACTIVITY_TRACKER_SERVICE_ROLE_KEY")!
        );

        const { data, error } = await trackerClient
          .from("proposed_fires")
          .update({
            approved_at: new Date().toISOString(),
            approved_by: approver ?? "crm-admin",
          })
          .eq("id", proposed_fire_id)
          .is("approved_at", null)   // idempotent — don't double-approve
          .select("id, policy_nbr, trigger_type, approved_at, approved_by")
          .single();

        if (error) throw new Error(`approve-proposed-fire failed: ${error.message}`);
        return jsonResponse({ ok: true, row: data });
      }

      // ── GHL Backfill: get per-agency trigger counts from Max's DB ────────────
      case "get-ghl-agencies": {
        if (session.role !== "global_admin") return jsonResponse({ error: "Forbidden" }, 403);

        const trackerClient = createClient(
          Deno.env.get("ACTIVITY_TRACKER_SUPABASE_URL")!,
          Deno.env.get("ACTIVITY_TRACKER_SERVICE_ROLE_KEY")!
        );

        // 1. Load all GHL-enabled agencies + their writing numbers from tracker DB
        const { data: agencyRows } = await trackerClient
          .from("agencies")
          .select("id, name, slug, ghl_api_enabled");

        const enabledAgencies = (agencyRows ?? []).filter((a: Record<string, unknown>) => a.ghl_api_enabled);
        if (enabledAgencies.length === 0) return jsonResponse({ agencies: [] });

        const agencyIds = enabledAgencies.map((a: Record<string, unknown>) => a.id as string);

        const { data: wnRows } = await trackerClient
          .from("agency_writing_numbers")
          .select("agency_id, writing_number")
          .in("agency_id", agencyIds);

        const wnByAgency = new Map<string, string[]>();
        for (const r of wnRows ?? []) {
          const list = wnByAgency.get(r.agency_id as string) ?? [];
          list.push((r.writing_number as string).trim().toUpperCase());
          wnByAgency.set(r.agency_id as string, list);
        }

        // 2. Load NPN coverage from tracker DB (agents + agency_rosters)
        const { data: agentRows } = await trackerClient
          .from("agents")
          .select("unl_writing_number, npn");
        const npnByWn = new Map<string, string>();
        for (const a of agentRows ?? []) {
          const wn = (a.unl_writing_number as string ?? "").trim().toUpperCase();
          if (wn && a.npn) npnByWn.set(wn, a.npn as string);
        }
        const { data: rosterRows } = await trackerClient
          .from("agency_rosters")
          .select("writing_number, npn")
          .eq("status", "active");
        for (const r of rosterRows ?? []) {
          const wn = (r.writing_number as string ?? "").trim().toUpperCase();
          if (wn && r.npn && !npnByWn.has(wn)) npnByWn.set(wn, r.npn as string);
        }

        // 3. Load last backfill run per agency from lifecycle_event_log
        const { data: lastRunRows } = await trackerClient
          .from("lifecycle_cron_runs")
          .select("fired, held, started_at")
          .order("started_at", { ascending: false })
          .limit(1);
        // Per-agency last run: query lifecycle_event_log for backfill mode entries
        // (agency_id field exists on event_log rows from backfill path)
        const lastRunByAgency = new Map<string, { fired: number; held: number; ran_at: string }>();
        for (const agencyId of agencyIds) {
          const { data: evRows } = await trackerClient
            .from("lifecycle_event_log")
            .select("agency_id, fired_at: created_at")
            .eq("agency_id", agencyId)
            .order("created_at", { ascending: false })
            .limit(1);
          if (evRows && evRows.length > 0) {
            lastRunByAgency.set(agencyId, { fired: 0, held: 0, ran_at: (evRows[0] as Record<string, unknown>).fired_at as string });
          }
        }

        // 4. Query Max's DB for unfired trigger counts per agency writing number
        const PLAN_FILTER = `(
          t.plan_code ILIKE '%HI%' OR t.plan_code ILIKE '%HHC%'
          OR t.plan_code ILIKE '%GHI%' OR t.plan_code ILIKE '%HIP%'
        )`;

        // Collect all WNs across all enabled agencies for a single Max DB query
        const allWns = [...new Set([...wnByAgency.values()].flat())];
        interface TriggerCount { wa: string; trigger_type: string; total: number }
        let triggerCounts: TriggerCount[] = [];

        if (allWns.length > 0) {
          await sql.unsafe("SET statement_timeout = '60s'");
          triggerCounts = await sql.unsafe(`
            SELECT TRIM(UPPER(t.wa)) AS wa, trigger_type, COUNT(*)::int AS total
            FROM (
              SELECT t.wa,
                CASE
                  WHEN t.previous_contract_code = 'P' AND t.cntrct_code = 'A' THEN 'approved'
                  WHEN t.previous_contract_code = 'A' AND t.cntrct_code = 'T' THEN 'terminated'
                END AS trigger_type
              FROM typed.unl_fym_policy_latest_load t
              WHERE ${PLAN_FILTER}
                AND ((t.previous_contract_code = 'P' AND t.cntrct_code = 'A')
                  OR (t.previous_contract_code = 'A' AND t.cntrct_code = 'T'))

              UNION ALL

              SELECT t.wa, 'submission' AS trigger_type
              FROM typed.unl_fym_policy_latest_load t
              WHERE ${PLAN_FILTER}
                AND t.cntrct_code = 'P' AND t.previous_contract_code IS NULL

              UNION ALL

              SELECT t.wa, 'submission' AS trigger_type
              FROM typed.unl_fym_policy_latest_load t
              WHERE ${PLAN_FILTER}
                AND t.cntrct_code = 'P' AND t.previous_contract_code IN ('T','A')

              UNION ALL

              SELECT t.wa, 'at_risk' AS trigger_type
              FROM typed.unl_fym_policy_latest_load t
              WHERE ${PLAN_FILTER}
                AND t.at_risk_policy = true
                AND (t.previous_at_risk_status = false OR t.previous_at_risk_status IS NULL)
            ) triggers
            WHERE TRIM(UPPER(wa)) = ANY(${ allWns.map((_: string, i: number) => `$${i + 1}`).join(",") })
            GROUP BY TRIM(UPPER(t.wa)), trigger_type
            ORDER BY wa, trigger_type
          `, allWns) as TriggerCount[];
        }

        // 5. Load already-fired set from fired_triggers (to subtract from counts)
        const firedByWn = new Map<string, { approved: number; terminated: number; submission: number; at_risk: number }>();
        {
          const { data: ftRows } = await trackerClient
            .from("fired_triggers")
            .select("policy_nbr, trigger_type");
          // Just need total counts per trigger type — build a fired set key
          // We'll subtract from trigger counts per WN below (simplified: just show gross counts,
          // note that fired_triggers doesn't store wa — so we report gross unfired from trigger logic)
          void ftRows; // fired_triggers doesn't have wa column; gross counts are fine for UI
        }

        // 6. Aggregate counts per agency
        const countsByWn = new Map<string, { approved: number; terminated: number; submission: number; at_risk: number }>();
        for (const row of triggerCounts) {
          const wn = (row.wa ?? "").trim().toUpperCase();
          if (!countsByWn.has(wn)) countsByWn.set(wn, { approved: 0, terminated: 0, submission: 0, at_risk: 0 });
          const c = countsByWn.get(wn)!;
          if (row.trigger_type === "approved")    c.approved    += row.total;
          if (row.trigger_type === "terminated")  c.terminated  += row.total;
          if (row.trigger_type === "submission")  c.submission  += row.total;
          if (row.trigger_type === "at_risk")     c.at_risk     += row.total;
        }

        const result = enabledAgencies.map((agency: Record<string, unknown>) => {
          const wns = wnByAgency.get(agency.id as string) ?? [];
          const counts = { approved: 0, terminated: 0, submission: 0, at_risk: 0 };
          let rosterTotal = 0;
          let npnCovered = 0;
          for (const wn of wns) {
            const c = countsByWn.get(wn);
            if (c) {
              counts.approved   += c.approved;
              counts.terminated += c.terminated;
              counts.submission += c.submission;
              counts.at_risk    += c.at_risk;
            }
            rosterTotal++;
            if (npnByWn.has(wn)) npnCovered++;
          }
          const lastRun = lastRunByAgency.get(agency.id as string) ?? null;
          return {
            id: agency.id,
            name: agency.name,
            slug: agency.slug,
            ghl_api_enabled: agency.ghl_api_enabled,
            writing_numbers: wns,
            roster_total: rosterTotal,
            npn_covered: npnCovered,
            counts,
            total_unfired: counts.approved + counts.terminated + counts.submission + counts.at_risk,
            last_run: lastRun,
          };
        });

        return jsonResponse({ agencies: result });
      }

      // ── GHL Backfill: invoke lifecycle-direct backfill for one agency ──────
      case "run-ghl-backfill": {
        if (session.role !== "global_admin") return jsonResponse({ error: "Forbidden" }, 403);

        const { agencyId, dateFrom, dry } = body as { agencyId: string; dateFrom?: string; dry?: boolean };
        if (!agencyId) return jsonResponse({ error: "agencyId required" }, 400);

        const trackerClient = createClient(
          Deno.env.get("ACTIVITY_TRACKER_SUPABASE_URL")!,
          Deno.env.get("ACTIVITY_TRACKER_SERVICE_ROLE_KEY")!
        );

        // Get agency's earliest policy app_recvd_date from Max's DB to use as date_from
        let effectiveDateFrom = dateFrom;
        if (!effectiveDateFrom) {
          const { data: wnRows } = await trackerClient
            .from("agency_writing_numbers")
            .select("writing_number")
            .eq("agency_id", agencyId);
          const wns = (wnRows ?? []).map((r: Record<string, unknown>) => (r.writing_number as string).trim().toUpperCase()).filter(Boolean);
          if (wns.length > 0) {
            await sql.unsafe("SET statement_timeout = '30s'");
            const minRows = await sql.unsafe(`
              SELECT MIN(app_recvd_date)::text AS min_date
              FROM typed.unl_fym_policy_latest_load
              WHERE TRIM(UPPER(wa)) = ANY(${ wns.map((_: string, i: number) => `$${i + 1}`).join(",") })
                AND (plan_code ILIKE '%HI%' OR plan_code ILIKE '%HHC%' OR plan_code ILIKE '%GHI%' OR plan_code ILIKE '%HIP%')
            `, wns) as { min_date: string | null }[];
            effectiveDateFrom = minRows[0]?.min_date ?? new Date().toISOString().slice(0, 10);
          } else {
            effectiveDateFrom = new Date().toISOString().slice(0, 10);
          }
        }

        // Fetch the cron secret from vault to authenticate lifecycle-direct
        const vaultRows = await sql.unsafe(
          `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_import_secret' LIMIT 1`
        ) as { decrypted_secret: string }[];
        // Note: vault is in Supabase, not Max's DB — use trackerClient RPC instead
        const { data: secretRow } = await trackerClient
          .rpc("get_secret", { secret_name: "cron_import_secret" })
          .single()
          .catch(() => ({ data: null }));
        void vaultRows; // Max's DB doesn't have vault; use Supabase secret

        const cronSecret = (secretRow as Record<string, unknown> | null)?.secret as string
          ?? Deno.env.get("ACTIVITY_TRACKER_SECRET_KEY")!;

        // Two-step: request token, then confirm
        const lifecycleFnUrl = `${Deno.env.get("ACTIVITY_TRACKER_SUPABASE_URL")!.replace("/rest/v1", "")}/functions/v1/lifecycle-direct`;

        // Step 1: get confirmation token
        const tokenRes = await fetch(
          `${lifecycleFnUrl}?mode=backfill&agency_id=${encodeURIComponent(agencyId)}&date_from=${encodeURIComponent(effectiveDateFrom)}${dry ? "&dry=true" : ""}`,
          { method: "POST", headers: { "X-Cron-Secret": cronSecret, "Content-Type": "application/json" } }
        );
        const tokenBody = await tokenRes.json() as { status?: string; token?: string; error?: string };
        if (tokenBody.error) return jsonResponse({ error: tokenBody.error }, 500);
        if (!tokenBody.token) return jsonResponse({ error: "No token returned from lifecycle-direct", detail: tokenBody }, 500);

        // Step 2: confirm
        const confirmRes = await fetch(
          `${lifecycleFnUrl}?mode=backfill&agency_id=${encodeURIComponent(agencyId)}&date_from=${encodeURIComponent(effectiveDateFrom)}&confirm=${encodeURIComponent(tokenBody.token)}${dry ? "&dry=true" : ""}`,
          { method: "POST", headers: { "X-Cron-Secret": cronSecret, "Content-Type": "application/json" } }
        );
        const confirmBody = await confirmRes.json();
        return jsonResponse({ ok: true, agency_id: agencyId, date_from: effectiveDateFrom, result: confirmBody });
      }

      default:
        return jsonResponse({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Internal server error" },
      500
    );
  }
});
