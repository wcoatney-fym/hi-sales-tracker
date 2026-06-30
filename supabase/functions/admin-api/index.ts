import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveAgentIdFromPolicy } from "./resolve.ts";

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
// reason. `contract_reason` stays null until the UNL "Contract Reason" column
// is mapped into the import pipeline.
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
        .select("id, agency_id, email_domain, password, role, session_duration_days");

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
        const { startDate, endDate, agentFilter, carrierFilter, productTypeFilter, agencyFilter, sourceFilter, clientSearch, page = 1, pageSize = 10 } = body;
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

        let countQuery = supabase
          .from("form_submissions")
          .select("id", { count: "exact", head: true })
          .gte("app_submit_date", startDate)
          .lt("app_submit_date", endDate)
          .not("status", "in", "(duplicate,superseded)");

        let dataQuery = supabase
          .from("form_submissions")
          .select("*")
          .gte("app_submit_date", startDate)
          .lt("app_submit_date", endDate)
          .not("status", "in", "(duplicate,superseded)")
          .order("app_submit_date", { ascending: false })
          .range(offset, offset + pageSize - 1);

        if (agentFilter && agentWritingNumbers.length > 0) {
          countQuery = countQuery.in("agent_number", agentWritingNumbers);
          dataQuery = dataQuery.in("agent_number", agentWritingNumbers);
        } else if (agentFilter) {
          countQuery = countQuery.eq("agent_number", "__NO_MATCH__");
          dataQuery = dataQuery.eq("agent_number", "__NO_MATCH__");
        }

        if (carrierFilter) {
          countQuery = countQuery.eq("carrier", carrierFilter);
          dataQuery = dataQuery.eq("carrier", carrierFilter);
        }

        if (productTypeFilter) {
          countQuery = countQuery.eq("product_type", productTypeFilter);
          dataQuery = dataQuery.eq("product_type", productTypeFilter);
        }

        if (agencyFilter) {
          countQuery = countQuery.eq("agency", agencyFilter);
          dataQuery = dataQuery.eq("agency", agencyFilter);
        }

        if (sourceFilter) {
          countQuery = countQuery.eq("source", sourceFilter);
          dataQuery = dataQuery.eq("source", sourceFilter);
        }

        if (clientSearch && typeof clientSearch === "string" && clientSearch.trim()) {
          // Case-insensitive match on client first/last name. Strip PostgREST
          // reserved chars to keep the .or() filter safe.
          const cleaned = clientSearch.trim().replace(/[%,().*]/g, " ").replace(/\s+/g, " ").trim();
          if (cleaned) {
            const parts = cleaned.split(" ");
            const orParts = [
              `client_first_name.ilike.%${cleaned}%`,
              `client_last_name.ilike.%${cleaned}%`,
            ];
            if (parts.length >= 2) {
              // Handle "First Last" typed together.
              const first = parts[0];
              const last = parts.slice(1).join(" ");
              orParts.push(`and(client_first_name.ilike.%${first}%,client_last_name.ilike.%${last}%)`);
            }
            const orFilter = orParts.join(",");
            countQuery = countQuery.or(orFilter);
            dataQuery = dataQuery.or(orFilter);
          }
        }

        const [countResult, dataResult] = await Promise.all([countQuery, dataQuery]);
        if (countResult.error) throw countResult.error;
        if (dataResult.error) throw dataResult.error;

        const { data: allAgents } = await supabase
          .from("agents")
          .select("id, first_name, last_name, unl_writing_number, gtl_writing_number");

        const { data: filterList } = await supabase
          .from("form_submissions")
          .select("agent_number, carrier, product_type, agency")
          .gte("app_submit_date", startDate)
          .lt("app_submit_date", endDate)
          .not("status", "in", "(duplicate,superseded)");

        const activeNumbers = new Set((filterList || []).map((r) => r.agent_number));

        const uniqueAgents = (allAgents || [])
          .filter((a) => activeNumbers.has(a.unl_writing_number) || activeNumbers.has(a.gtl_writing_number))
          .map((a) => {
            const nums = [a.unl_writing_number, a.gtl_writing_number].filter(Boolean);
            return { id: a.id, label: `${a.first_name} ${a.last_name} (${nums.join(", ")})` };
          })
          .sort((a, b) => a.label.localeCompare(b.label));

        const uniqueCarriers = Array.from(
          new Set((filterList || []).map((r) => r.carrier).filter(Boolean))
        )
          .sort()
          .map((name) => ({ name }));

        const uniqueProductTypes = Array.from(
          new Set((filterList || []).map((r: { product_type: string }) => r.product_type).filter(Boolean))
        )
          .sort()
          .map((name) => ({ name }));

        const uniqueAgencies = Array.from(
          new Set((filterList || []).map((r: { agency: string }) => r.agency).filter(Boolean))
        )
          .sort()
          .map((name) => ({ name }));

        return jsonResponse({
          policies: dataResult.data || [],
          totalCount: countResult.count || 0,
          agents: uniqueAgents,
          carriers: uniqueCarriers,
          productTypes: uniqueProductTypes,
          agencies: uniqueAgencies,
        });
      }

      case "export-policies": {
        const { startDate, endDate, agentFilter, carrierFilter, productTypeFilter, agencyFilter } = body;
        if (!startDate || !endDate) {
          return jsonResponse({ error: "Date range required" }, 400);
        }

        let exportAgentWritingNumbers: string[] = [];
        if (agentFilter) {
          const { data: agentRow } = await supabase
            .from("agents")
            .select("unl_writing_number, gtl_writing_number")
            .eq("id", agentFilter)
            .maybeSingle();
          if (agentRow) {
            if (agentRow.unl_writing_number) exportAgentWritingNumbers.push(agentRow.unl_writing_number);
            if (agentRow.gtl_writing_number) exportAgentWritingNumbers.push(agentRow.gtl_writing_number);
          }
        }

        let exportQuery = supabase
          .from("form_submissions")
          .select("*")
          .gte("app_submit_date", startDate)
          .lt("app_submit_date", endDate)
          .not("status", "in", "(duplicate,superseded)")
          .order("app_submit_date", { ascending: false })
          .limit(10000);

        if (agentFilter && exportAgentWritingNumbers.length > 0) {
          exportQuery = exportQuery.in("agent_number", exportAgentWritingNumbers);
        } else if (agentFilter) {
          exportQuery = exportQuery.eq("agent_number", "__NO_MATCH__");
        }

        if (carrierFilter) {
          exportQuery = exportQuery.eq("carrier", carrierFilter);
        }

        if (productTypeFilter) {
          exportQuery = exportQuery.eq("product_type", productTypeFilter);
        }

        if (agencyFilter) {
          exportQuery = exportQuery.eq("agency", agencyFilter);
        }

        const exportResult = await exportQuery;
        if (exportResult.error) throw exportResult.error;

        return jsonResponse({ policies: exportResult.data || [] });
      }

      case "export-leaderboard": {
        const { startDate, endDate, agencyFilter } = body;
        if (!startDate || !endDate) {
          return jsonResponse({ error: "Date range required" }, 400);
        }

        let lbQuery = supabase
          .from("form_submissions")
          .select("agent_number, agent_first_name, agent_last_name, agency, plan_premium")
          .gte("app_submit_date", startDate)
          .lt("app_submit_date", endDate)
          .not("status", "in", "(duplicate,superseded)");

        if (agencyFilter) {
          lbQuery = lbQuery.eq("agency", agencyFilter);
        }

        const lbResult = await lbQuery;
        if (lbResult.error) throw lbResult.error;

        const rows = lbResult.data || [];
        const agentMap: Record<string, { firstName: string; lastName: string; agentNumber: string; agency: string; count: number; totalAnnualizedPremium: number }> = {};
        for (const r of rows) {
          const key = r.agent_number || `${r.agent_first_name}_${r.agent_last_name}`;
          if (!agentMap[key]) {
            agentMap[key] = {
              firstName: r.agent_first_name,
              lastName: r.agent_last_name,
              agentNumber: r.agent_number || "",
              agency: r.agency || "",
              count: 0,
              totalAnnualizedPremium: 0,
            };
          }
          agentMap[key].count++;
          agentMap[key].totalAnnualizedPremium += (Number(r.plan_premium) || 0) * 12;
        }

        const leaderboard = Object.values(agentMap).sort((a, b) => b.count - a.count);

        const writingNums = leaderboard.map((a) => a.agentNumber).filter(Boolean);
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

        const enriched = leaderboard.map((a) => ({
          ...a,
          npn: npnMap[a.agentNumber] || "",
        }));

        return jsonResponse({ leaderboard: enriched });
      }

      case "delete-policies": {
        const { ids } = body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
          return jsonResponse({ error: "Policy IDs are required" }, 400);
        }

        const { error } = await supabase
          .from("form_submissions")
          .delete()
          .in("id", ids);

        if (error) throw error;

        return jsonResponse({ success: true, deletedCount: ids.length });
      }

      case "get-submissions": {
        const { data, error } = await supabase
          .from("form_submissions")
          .select("*")
          .order("created_at", { ascending: false });

        if (error) throw error;

        return jsonResponse({ submissions: data || [] });
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
        const { uploadId: finUploadId } = body;
        if (!finUploadId) return jsonResponse({ error: "Upload ID required" }, 400);

        const { data: finUpload, error: finFetchErr } = await supabase
          .from("source_uploads")
          .select("*")
          .eq("id", finUploadId)
          .maybeSingle();
        if (finFetchErr || !finUpload) return jsonResponse({ error: "Upload not found" }, 404);

        const finCarrier = finUpload.carrier;

        // Fetch all source_records in pages (bypass 1000-row default)
        const allSourceRecs: Array<{ mapped_data: Record<string, string> | null }> = [];
        let rangeStart = 0;
        const pageSize = 5000;
        while (true) {
          const { data: page } = await supabase
            .from("source_records")
            .select("mapped_data")
            .eq("source_upload_id", finUploadId)
            .eq("processing_status", "imported")
            .range(rangeStart, rangeStart + pageSize - 1);
          if (!page || page.length === 0) break;
          allSourceRecs.push(...page);
          if (page.length < pageSize) break;
          rangeStart += pageSize;
        }

        // --- Agent Sync ---
        let agentsAdded = 0;
        let agentsUpdated = 0;
        try {
          const agentMap = new Map<string, { name: string; agency: string }>();
          const agentDownlineCounts = new Map<string, { total: number; withDownline: number }>();
          for (const rec of allSourceRecs) {
            const md = rec.mapped_data;
            if (!md) continue;
            const code = (md["UNL Writing Number"] || md["Writing Agent Code"] || "").trim().toUpperCase();
            if (!code) continue;
            const downline = (md["Downline Agency"] || "").trim().replace(/\s+/g, " ");
            const counts = agentDownlineCounts.get(code) || { total: 0, withDownline: 0 };
            counts.total++;
            if (downline) counts.withDownline++;
            agentDownlineCounts.set(code, counts);
            if (agentMap.has(code)) continue;
            const name = (md["Writing Agent"] || md["Writing Agent Name"] || "").trim();
            agentMap.set(code, { name, agency: downline ? toProperCase(downline) : "" });
          }
          for (const [code, entry] of agentMap) {
            if (!entry.agency) {
              const counts = agentDownlineCounts.get(code);
              if (counts && counts.withDownline > 0) {
                for (const rec of allSourceRecs) {
                  const md = rec.mapped_data;
                  if (!md) continue;
                  const rc = (md["UNL Writing Number"] || md["Writing Agent Code"] || "").trim().toUpperCase();
                  if (rc !== code) continue;
                  const dl = (md["Downline Agency"] || "").trim().replace(/\s+/g, " ");
                  if (dl) { entry.agency = toProperCase(dl); break; }
                }
              }
              if (!entry.agency) entry.agency = "FYM";
            }
          }

          // Batch-fetch existing agents
          const allCodes = Array.from(agentMap.keys());
          const existingAgentsMap = new Map<string, { id: string; agency: string; agency_locked: boolean; source: string }>();
          for (let i = 0; i < allCodes.length; i += 200) {
            const batch = allCodes.slice(i, i + 200);
            const { data: existing } = await supabase
              .from("agents")
              .select("id, unl_writing_number, agency, agency_locked, source")
              .in("unl_writing_number", batch);
            for (const a of existing || []) {
              existingAgentsMap.set(a.unl_writing_number.toUpperCase(), a);
            }
          }

          // Check aliases for codes not found directly
          const missingCodes = allCodes.filter(c => !existingAgentsMap.has(c));
          if (missingCodes.length > 0) {
            for (let i = 0; i < missingCodes.length; i += 200) {
              const batch = missingCodes.slice(i, i + 200);
              const { data: aliasHits } = await supabase
                .from("agent_writing_numbers")
                .select("writing_number, agent_id")
                .in("writing_number", batch);
              if (aliasHits && aliasHits.length > 0) {
                const agentIds = [...new Set(aliasHits.map(h => h.agent_id))];
                const { data: aliasedAgents } = await supabase
                  .from("agents")
                  .select("id, unl_writing_number, agency, agency_locked, source")
                  .in("id", agentIds);
                for (const hit of aliasHits) {
                  const agent = (aliasedAgents || []).find(a => a.id === hit.agent_id);
                  if (agent) {
                    existingAgentsMap.set(hit.writing_number.toUpperCase(), agent);
                  }
                }
              }
            }
          }

          const agentsToInsert: Array<Record<string, unknown>> = [];
          for (const [code, { name, agency }] of agentMap) {
            const nameParts = name.split(/\s+/).filter(Boolean);
            if (nameParts.length === 0) continue;
            const firstName = toProperCase(nameParts[0]);
            const lastName = toProperCase(nameParts[nameParts.length - 1]);
            if (!firstName || !lastName) continue;

            const existing = existingAgentsMap.get(code);
            if (existing) {
              if (existing.source === "Contracting Portal") continue;
              if (existing.agency_locked) continue;
              if (agency && existing.agency !== agency) {
                await supabase
                  .from("agents")
                  .update({ agency, updated_at: new Date().toISOString() })
                  .eq("id", existing.id);
                agentsUpdated++;
              }
            } else {
              agentsToInsert.push({
                first_name: firstName,
                last_name: lastName,
                unl_writing_number: code,
                agency: agency || "FYM",
                source: "Data Source",
              });
            }
          }
          for (let i = 0; i < agentsToInsert.length; i += 200) {
            const batch = agentsToInsert.slice(i, i + 200);
            const { error: batchErr } = await supabase.from("agents").insert(batch);
            if (!batchErr) agentsAdded += batch.length;
          }
        } catch (_syncErr) {
          // best-effort
        }

        // --- Policy Sync (wipe-and-replace + supersede) ---
        let policiesSynced = 0;
        let recordsReplaced = 0;
        let recordsSuperseded = 0;
        let replacedSnapshot: Record<string, unknown>[] = [];
        let supersededSnapshot: Record<string, unknown>[] = [];
        try {
          const CONTRACT_STATUS: Record<string, string> = { A: "active", T: "terminated", P: "pending", S: "suspended" };
          const parseDateYMD = (d: string): string | null => {
            if (!d || d.length < 8) return null;
            return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
          };

          const { data: agentsList } = await supabase
            .from("agents")
            .select("unl_writing_number, agency")
            .range(0, 9999);
          const agencyLookup = new Map<string, string>();
          for (const a of agentsList || []) {
            if (a.unl_writing_number) agencyLookup.set(a.unl_writing_number.toUpperCase(), a.agency || "");
          }

          // Roster-based agency lookup (takes priority over legacy logic)
          const { data: rosterEntries } = await supabase
            .from("agency_rosters")
            .select("writing_number, agency_id, agencies:agency_id(name)")
            .eq("match_status", "confirmed")
            .eq("status", "active");
          const rosterAgencyLookup = new Map<string, string>();
          for (const r of rosterEntries || []) {
            if (r.writing_number && r.agencies) {
              rosterAgencyLookup.set(r.writing_number.toUpperCase(), (r.agencies as { name: string }).name);
            }
          }

          // --- Wipe previous upload's records ---
          // Find the previous upload for this source+carrier (now deactivated)
          const { data: prevUploadData } = await supabase
            .from("source_uploads")
            .select("id")
            .eq("data_source_id", finUpload.data_source_id)
            .eq("carrier", finCarrier)
            .eq("is_active", false)
            .neq("id", finUploadId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (prevUploadData) {
            // Snapshot the records being replaced (limit to essential fields for history)
            const prevRecords: Record<string, unknown>[] = [];
            let snapOffset = 0;
            while (true) {
              const { data: snapPage } = await supabase
                .from("form_submissions")
                .select("id, policy_number, agent_number, client_first_name, client_last_name, zip, plan_name, plan_premium, status, policy_effective_date")
                .eq("source_upload_id", prevUploadData.id)
                .range(snapOffset, snapOffset + 4999);
              if (!snapPage || snapPage.length === 0) break;
              prevRecords.push(...snapPage);
              if (snapPage.length < 5000) break;
              snapOffset += 5000;
            }
            replacedSnapshot = prevRecords;
            recordsReplaced = prevRecords.length;

            // Delete previous upload's form_submissions
            await supabase
              .from("form_submissions")
              .delete()
              .eq("source_upload_id", prevUploadData.id);
          }

          const policyRows: Array<Record<string, unknown>> = [];
          for (const rec of allSourceRecs) {
            const md = rec.mapped_data;
            if (!md) continue;
            const policyNumber = (md["Policy Number"] || "").trim();
            if (!policyNumber) continue;

            const agentCode = (md["UNL Writing Number"] || md["Writing Agent Code"] || "").trim().toUpperCase();
            const writingAgent = (md["Writing Agent"] || md["Writing Agent Name"] || "").trim();
            const agentParts = writingAgent.split(/\s+/).filter(Boolean);
            const agentFirst = agentParts.length > 0 ? toProperCase(agentParts[0]) : "";
            const agentLast = agentParts.length > 1 ? toProperCase(agentParts[agentParts.length - 1]) : agentFirst;

            const annualPremium = parseFloat(md["Annual Premium"] || "0");
            const monthlyPremium = isNaN(annualPremium) ? 0 : Math.round((annualPremium / 12) * 100) / 100;
            const planCode = (md["Plan Code"] || "").trim();
            const productType = planCode.toUpperCase().includes("HHC") ? "HHC" : "HI";
            const contractCode = (md["Contract Code"] || "").trim().toUpperCase();
            const status = CONTRACT_STATUS[contractCode] || "pending";
            const downlineAgency = (md["Downline Agency"] || "").trim().replace(/\s+/g, " ");
            // Roster takes priority > downline agency from data > agent lookup > FYM default
            const agency = rosterAgencyLookup.get(agentCode)
              || (downlineAgency ? toProperCase(downlineAgency) : (agencyLookup.get(agentCode) || "FYM"));

            policyRows.push({
              policy_number: policyNumber,
              agent_number: agentCode,
              agent_first_name: agentFirst,
              agent_last_name: agentLast,
              client_first_name: toProperCase(md["First Name"] || ""),
              client_last_name: toProperCase(md["Last Name"] || ""),
              phone: (md["Phone"] || "").trim(),
              email: "",
              address: "",
              city: "",
              state: (md["State"] || "").trim(),
              zip: (md["Zip"] || "").trim(),
              plan_name: planCode,
              plan_premium: monthlyPremium,
              policy_effective_date: parseDateYMD(md["Effective Date"] || ""),
              app_submit_date: parseDateYMD(md["Submit Date"] || ""),
              paid_to_date: parseDateYMD(md["Paid To Date"] || ""),
              status,
              carrier: finCarrier,
              product_type: productType,
              agency,
              billing_form: (md["Billing Form"] || "").trim() || null,
              billing_mode: (md["Billing Mode"] || "").trim() || null,
              contract_code: (md["Contract Code"] || "").trim() || null,
              source: "Data Source",
              source_upload_id: finUploadId,
            });
          }

          // Deduplicate by policy_number (keep last occurrence)
          const deduped = new Map<string, Record<string, unknown>>();
          for (const row of policyRows) {
            deduped.set(row.policy_number as string, row);
          }
          const uniquePolicies = Array.from(deduped.values());

          // Bulk upsert in batches of 500
          const upsertBatchSize = 500;
          for (let i = 0; i < uniquePolicies.length; i += upsertBatchSize) {
            const batch = uniquePolicies.slice(i, i + upsertBatchSize);
            const { error: upsertErr, count } = await supabase
              .from("form_submissions")
              .upsert(batch, { onConflict: "policy_number", count: "exact" });
            if (!upsertErr) policiesSynced += (count || batch.length);
          }

          // --- Supersede Intake Form/BoB records that now have matching Data Source records ---
          // Build a set of (agent_number, lower_first, lower_last, zip) from new data
          const dsKeys = new Set<string>();
          for (const row of uniquePolicies) {
            const firstWord = ((row.client_first_name as string) || "").toLowerCase().split(/\s+/)[0];
            const key = `${(row.agent_number as string || "").toUpperCase()}|${firstWord}|${(row.client_last_name as string || "").toLowerCase()}|${row.zip || ""}`;
            dsKeys.add(key);
          }

          // Find Intake Form/BoB records to supersede
          const formBobRecords: Array<{ id: string; agent_number: string; client_first_name: string; client_last_name: string; zip: string; [key: string]: unknown }> = [];
          let fbOffset = 0;
          while (true) {
            const { data: fbPage } = await supabase
              .from("form_submissions")
              .select("id, agent_number, client_first_name, client_last_name, zip, plan_name, status, source, policy_effective_date")
              .eq("source", "Intake Form")
              .not("status", "in", "(duplicate,superseded)")
              .range(fbOffset, fbOffset + 4999);
            if (!fbPage || fbPage.length === 0) break;
            formBobRecords.push(...(fbPage as typeof formBobRecords));
            if (fbPage.length < 5000) break;
            fbOffset += 5000;
          }

          const toSupersede: string[] = [];
          const supersededRecs: Record<string, unknown>[] = [];
          for (const rec of formBobRecords) {
            const firstWord = (rec.client_first_name || "").toLowerCase().split(/\s+/)[0];
            const key = `${(rec.agent_number || "").toUpperCase()}|${firstWord}|${(rec.client_last_name || "").toLowerCase()}|${rec.zip || ""}`;
            if (dsKeys.has(key)) {
              toSupersede.push(rec.id);
              supersededRecs.push(rec);
            }
          }

          // Mark as superseded in batches
          for (let i = 0; i < toSupersede.length; i += 200) {
            const batch = toSupersede.slice(i, i + 200);
            await supabase
              .from("form_submissions")
              .update({ status: "superseded", duplicate_flag: true })
              .in("id", batch);
          }
          recordsSuperseded = toSupersede.length;
          supersededSnapshot = supersededRecs;

        } catch (policySyncErr) {
          await supabase
            .from("source_uploads")
            .update({ status: "error" })
            .eq("id", finUploadId);
          return jsonResponse({
            error: `Policy sync failed: ${policySyncErr instanceof Error ? policySyncErr.message : "Unknown error"}`,
            agentsAdded,
            agentsUpdated,
            policiesSynced,
          }, 500);
        }

        await supabase
          .from("source_uploads")
          .update({ status: "complete" })
          .eq("id", finUploadId);

        // --- Log to upload_history_log ---
        try {
          await supabase.from("upload_history_log").insert({
            source_upload_id: finUploadId,
            source: "Data Source",
            action: "upload",
            carrier: finCarrier,
            filename: finUpload.filename,
            records_inserted: policiesSynced,
            records_replaced: recordsReplaced,
            records_superseded: recordsSuperseded,
            replaced_data: replacedSnapshot.length > 0 ? replacedSnapshot : null,
            superseded_data: supersededSnapshot.length > 0 ? supersededSnapshot : null,
            uploaded_by: session.email,
          });
        } catch (_logErr) {
          // best-effort logging
        }

        return jsonResponse({
          success: true,
          uploadId: finUploadId,
          agentsAdded,
          agentsUpdated,
          policiesSynced,
          recordsReplaced,
          recordsSuperseded,
        });
      }

      case "revert-source-upload": {
        const { uploadId: revertUploadId } = body;
        if (!revertUploadId) return jsonResponse({ error: "Upload ID required" }, 400);

        // Fetch the upload to revert
        const { data: revertUpload } = await supabase
          .from("source_uploads")
          .select("*")
          .eq("id", revertUploadId)
          .maybeSingle();
        if (!revertUpload) return jsonResponse({ error: "Upload not found" }, 404);
        if (!revertUpload.is_active) return jsonResponse({ error: "Can only revert the active upload" }, 400);

        // Delete form_submissions rows created by this upload
        const { count: removedCount } = await supabase
          .from("form_submissions")
          .delete({ count: "exact" })
          .eq("source_upload_id", revertUploadId);

        // Restore overwritten rows if any
        let restoredCount = 0;
        const overwritten = revertUpload.overwritten_data as Record<string, unknown>[] | null;
        if (overwritten && overwritten.length > 0) {
          const restoreBatchSize = 200;
          for (let i = 0; i < overwritten.length; i += restoreBatchSize) {
            const batch = overwritten.slice(i, i + restoreBatchSize);
            // Remove any fields that might conflict, then upsert by policy_number
            const cleanBatch = batch.map((row) => {
              const { id: _id, created_at: _ca, ...rest } = row as Record<string, unknown>;
              return { ...rest, source_upload_id: null };
            });
            const { error: restoreErr } = await supabase
              .from("form_submissions")
              .upsert(cleanBatch, { onConflict: "policy_number" });
            if (!restoreErr) restoredCount += batch.length;
          }
        }

        // Mark this upload as reverted
        await supabase
          .from("source_uploads")
          .update({ is_active: false, status: "reverted" })
          .eq("id", revertUploadId);

        // Re-activate the previous upload for this source+carrier
        const { data: prevUpload } = await supabase
          .from("source_uploads")
          .select("id")
          .eq("data_source_id", revertUpload.data_source_id)
          .eq("carrier", revertUpload.carrier)
          .eq("status", "complete")
          .neq("id", revertUploadId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (prevUpload) {
          await supabase
            .from("source_uploads")
            .update({ is_active: true })
            .eq("id", prevUpload.id);
        }

        return jsonResponse({
          success: true,
          removed: removedCount || 0,
          restored: restoredCount,
        });
      }

      case "resync-policies": {
        // Delegates to the sql-import-cron keyset sync (error-safe, resumable,
        // with completeness gate + reconciliation). The old offset loop here
        // treated a failed staging query as end-of-data and marked uploads
        // complete early.
        const { uploadId: rsUploadId } = body;
        if (!rsUploadId) return jsonResponse({ error: "Upload ID required" }, 400);

        const { data: rsUpload } = await supabase
          .from("source_uploads")
          .select("id, data_source_id")
          .eq("id", rsUploadId)
          .maybeSingle();
        if (!rsUpload) return jsonResponse({ error: "Upload not found" }, 404);

        const { count: rsStaged } = await supabase
          .from("source_records")
          .select("*", { count: "exact", head: true })
          .eq("source_upload_id", rsUploadId);
        if (!rsStaged) {
          return jsonResponse({ error: "No staged records remain for this upload. Run a fresh Import Data instead \u2014 Re-sync only reprocesses the staged snapshot; it does not pull from the source database." }, 400);
        }

        await supabase
          .from("source_uploads")
          .update({ status: "processing", resync_progress: { phase: "sync", synced: 0 } })
          .eq("id", rsUploadId);

        const rsFnUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/sql-import-cron`;
        const rsP = fetch(rsFnUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({ phase: "sync", sourceId: rsUpload.data_source_id, uploadId: rsUploadId }),
        }).catch(() => {});
        const rsRuntime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
        if (rsRuntime?.waitUntil) rsRuntime.waitUntil(rsP);

        // done:true keeps any stale cached frontend's polling loop from spinning;
        // the new UI polls get-import-progress instead.
        return jsonResponse({ success: true, started: true, done: true, total: rsStaged, policiesSynced: 0, nextOffset: 0 });
      }

      case "delete-source-upload": {
        const { uploadId: delUploadId } = body;
        if (!delUploadId) return jsonResponse({ error: "Upload ID required" }, 400);

        const { data: delUpload } = await supabase
          .from("source_uploads")
          .select("id")
          .eq("id", delUploadId)
          .maybeSingle();
        if (!delUpload) return jsonResponse({ error: "Upload not found" }, 404);

        // Delete form_submissions linked to this upload
        const { count: deletedPolicies } = await supabase
          .from("form_submissions")
          .delete({ count: "exact" })
          .eq("source_upload_id", delUploadId);

        // Delete source_records for this upload
        const { count: deletedRecords } = await supabase
          .from("source_records")
          .delete({ count: "exact" })
          .eq("source_upload_id", delUploadId);

        // Delete the upload itself
        await supabase
          .from("source_uploads")
          .delete()
          .eq("id", delUploadId);

        return jsonResponse({
          success: true,
          deletedPolicies: deletedPolicies || 0,
          deletedRecords: deletedRecords || 0,
        });
      }

      case "sync-policies-from-source": {
        // Re-sync all imported source records into form_submissions (for existing data)
        const { data: allUploads } = await supabase
          .from("source_uploads")
          .select("id, carrier")
          .eq("status", "complete");

        const CONTRACT_STATUS_SYNC: Record<string, string> = {
          A: "active",
          T: "terminated",
          P: "pending",
          S: "suspended",
        };

        const parseDateSync = (d: string): string | null => {
          if (!d || d.length < 8) return null;
          return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
        };

        const { data: agentsListSync } = await supabase
          .from("agents")
          .select("unl_writing_number, agency")
          .range(0, 9999);
        const agencyLookupSync = new Map<string, string>();
        for (const a of agentsListSync || []) {
          if (a.unl_writing_number) agencyLookupSync.set(a.unl_writing_number.toUpperCase(), a.agency || "");
        }

        // Roster-based agency lookup (takes priority)
        const { data: rosterEntriesSync } = await supabase
          .from("agency_rosters")
          .select("writing_number, agency_id, agencies:agency_id(name)")
          .eq("match_status", "confirmed")
          .eq("status", "active");
        const rosterAgencyLookupSync = new Map<string, string>();
        for (const r of rosterEntriesSync || []) {
          if (r.writing_number && r.agencies) {
            rosterAgencyLookupSync.set(r.writing_number.toUpperCase(), (r.agencies as { name: string }).name);
          }
        }

        let totalSynced = 0;

        for (const upl of allUploads || []) {
          const { data: recs } = await supabase
            .from("source_records")
            .select("mapped_data")
            .eq("source_upload_id", upl.id)
            .eq("processing_status", "imported");

          const rows: Array<Record<string, unknown>> = [];
          for (const rec of recs || []) {
            const md = normalizeKeys(rec.mapped_data as Record<string, string> | null);

            const policyNumber = (md["Policy Number"] || "").trim();
            if (!policyNumber) continue;

            const agentCode = (md["UNL Writing Number"] || md["Writing Agent Code"] || "").trim().toUpperCase();
            const writingAgent = (md["Writing Agent"] || md["Writing Agent Name"] || "").trim();
            const agentParts = writingAgent.split(/\s+/).filter(Boolean);
            const agentFirst = agentParts.length > 0 ? toProperCase(agentParts[0]) : "";
            const agentLast = agentParts.length > 1 ? toProperCase(agentParts[agentParts.length - 1]) : agentFirst;

            const annualPremium = parseFloat(md["Annual Premium"] || "0");
            const monthlyPremium = isNaN(annualPremium) ? 0 : Math.round((annualPremium / 12) * 100) / 100;

            const planCode = (md["Plan Code"] || "").trim();
            const productType = planCode.toUpperCase().includes("HHC") ? "HHC" : "HI";
            const contractCode = (md["Contract Code"] || "").trim().toUpperCase();
            const status = CONTRACT_STATUS_SYNC[contractCode] || "pending";
            const downlineAgencySync = (md["Downline Agency"] || "").trim().replace(/\s+/g, " ");
            const agency = rosterAgencyLookupSync.get(agentCode)
              || (downlineAgencySync ? toProperCase(downlineAgencySync) : (agencyLookupSync.get(agentCode) || "FYM"));

            rows.push({
              policy_number: policyNumber,
              agent_number: agentCode,
              agent_first_name: agentFirst,
              agent_last_name: agentLast,
              client_first_name: toProperCase(md["First Name"] || ""),
              client_last_name: toProperCase(md["Last Name"] || ""),
              phone: (md["Phone"] || "").trim(),
              email: "",
              address: "",
              city: "",
              state: (md["State"] || "").trim(),
              zip: (md["Zip"] || "").trim(),
              plan_name: planCode,
              plan_premium: monthlyPremium,
              policy_effective_date: parseDateSync(md["Effective Date"] || ""),
              app_submit_date: parseDateSync(md["Submit Date"] || ""),
              paid_to_date: parseDateSync(md["Paid To Date"] || ""),
              status,
              carrier: upl.carrier,
              product_type: productType,
              agency,
              billing_form: (md["Billing Form"] || "").trim() || null,
              billing_mode: (md["Billing Mode"] || "").trim() || null,
              contract_code: (md["Contract Code"] || "").trim() || null,
              source: "Data Source",
            });
          }

          // Deduplicate by policy_number
          const dedupedSync = new Map<string, Record<string, unknown>>();
          for (const row of rows) {
            dedupedSync.set(row.policy_number as string, row);
          }
          const uniqueRows = Array.from(dedupedSync.values());

          for (let i = 0; i < uniqueRows.length; i += 200) {
            const batch = uniqueRows.slice(i, i + 200);
            const { error: upsErr } = await supabase
              .from("form_submissions")
              .upsert(batch, { onConflict: "policy_number" });
            if (!upsErr) totalSynced += batch.length;
          }
        }

        return jsonResponse({ success: true, policiesSynced: totalSynced });
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
        const { agencyFilter, agencies, startDate, endDate, agentNumber } = body;

        let query = supabase
          .from("form_submissions")
          .select("billing_mode, contract_code")
          .not("billing_mode", "is", null)
          .not("contract_code", "is", null);

        if (agentNumber) {
          query = query.eq("agent_number", agentNumber);
        } else if (agencies && Array.isArray(agencies) && agencies.length > 0) {
          query = query.in("agency", agencies);
        } else if (agencyFilter) {
          query = query.eq("agency", agencyFilter);
        }

        if (startDate) query = query.gte("app_submit_date", startDate);
        if (endDate) query = query.lte("app_submit_date", endDate);

        const { data: rows, error: bmError } = await query;
        if (bmError) throw bmError;

        const modeMap: Record<string, Record<string, number>> = {};
        for (const row of rows || []) {
          const mode = row.billing_mode;
          const code = row.contract_code;
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

        // Insert roster entries
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
          total: entries.length,
          matched: matchedCount,
          created: createdCount,
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
          .select("id, email_domain, password, agency_id, session_duration_days")
          .eq("role", "agency_admin");

        if (credsErr) throw credsErr;

        const agencyIds = (creds || []).map((c: { agency_id: string }) => c.agency_id).filter(Boolean);
        const { data: agencyRows } = await supabase
          .from("agencies")
          .select("id, name, slug, zaps_enabled")
          .in("id", agencyIds);

        const agencyMap = Object.fromEntries(
          (agencyRows || []).map((a: { id: string; name: string; slug: string; zaps_enabled: boolean }) => [a.id, a])
        );

        const credentials = (creds || []).map((c: { id: string; email_domain: string; password: string; agency_id: string; session_duration_days: number }) => ({
          id: c.id,
          username: c.email_domain,
          password: c.password,
          agency_id: c.agency_id,
          agency_name: agencyMap[c.agency_id]?.name || "Unknown",
          agency_slug: agencyMap[c.agency_id]?.slug || "",
          zaps_enabled: agencyMap[c.agency_id]?.zaps_enabled ?? false,
          session_duration_days: c.session_duration_days,
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
          .update({ zaps_enabled: enabled })
          .eq("id", agencyId);

        if (zapErr) throw zapErr;
        return jsonResponse({ success: true, agencyId, zaps_enabled: enabled });
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
        const { sourceId: caiSourceId } = body;
        if (!caiSourceId) return jsonResponse({ error: "Source ID required" }, 400);

        const { data: caiMappings } = await supabase
          .from("column_mappings")
          .select("source_column, target_field")
          .eq("data_source_id", caiSourceId)
          .order("source_column");

        if (!caiMappings || caiMappings.length === 0) {
          return jsonResponse({ error: "No column mappings configured for this source" }, 400);
        }

        const snapshot = caiMappings.map((m: { source_column: string; target_field: string }) => ({
          source_column: m.source_column,
          target_field: m.target_field,
        }));

        const { error: caiErr } = await supabase
          .from("data_sources")
          .update({
            auto_cron_enabled: true,
            auto_cron_confirmed_at: new Date().toISOString(),
            auto_cron_confirmed_by: session.email,
            auto_cron_mapping_snapshot: snapshot,
          })
          .eq("id", caiSourceId);

        if (caiErr) throw caiErr;

        await supabase.from("upload_history_log").insert({
          action: "auto_import_confirmed",
          details: { source_id: caiSourceId, confirmed_by: session.email, mapping_count: snapshot.length },
        });

        return jsonResponse({ success: true, mappingCount: snapshot.length });
      }

      case "disable-auto-import": {
        const { sourceId: daiSourceId } = body;
        if (!daiSourceId) return jsonResponse({ error: "Source ID required" }, 400);

        const { error: daiErr } = await supabase
          .from("data_sources")
          .update({ auto_cron_enabled: false })
          .eq("id", daiSourceId);

        if (daiErr) throw daiErr;
        return jsonResponse({ success: true });
      }

      case "start-sql-import": {
        // Server-side import: creates the upload and hands off to the sql-import-cron
        // pipeline (keyset fetch + keyset sync) — the same path the scheduled imports use.
        const { sourceId: ssiSourceId, carrier: ssiCarrier } = body;
        if (!ssiSourceId) return jsonResponse({ error: "Source ID required" }, 400);

        const { data: ssiSource } = await supabase
          .from("data_sources")
          .select("*")
          .eq("id", ssiSourceId)
          .maybeSingle();
        if (!ssiSource) return jsonResponse({ error: "Data source not found" }, 404);
        if (!ssiSource.db_host || !ssiSource.db_table) {
          return jsonResponse({ error: "Database connection not configured" }, 400);
        }

        const ssiCarrierFinal = (ssiCarrier as string) || ssiSource.default_carrier || "UNL";

        await supabase
          .from("source_uploads")
          .update({ is_active: false })
          .eq("data_source_id", ssiSourceId)
          .eq("carrier", ssiCarrierFinal)
          .eq("is_active", true);

        const { data: ssiUpload, error: ssiErr } = await supabase
          .from("source_uploads")
          .insert({
            data_source_id: ssiSourceId,
            carrier: ssiCarrierFinal,
            filename: `db-import-${new Date().toISOString().slice(0, 10)}`,
            row_count: 0,
            status: "processing",
            uploaded_by: "admin-ui",
            is_active: true,
          })
          .select()
          .single();
        if (ssiErr || !ssiUpload) {
          return jsonResponse({ error: ssiErr?.message || "Failed to create upload" }, 500);
        }

        // Purge staging rows from prior uploads for this data source
        const { data: ssiOld } = await supabase
          .from("source_uploads")
          .select("id")
          .eq("data_source_id", ssiSourceId)
          .neq("id", ssiUpload.id);
        const ssiOldIds = (ssiOld || []).map((u: { id: string }) => u.id);
        for (let i = 0; i < ssiOldIds.length; i += 50) {
          await supabase
            .from("source_records")
            .delete()
            .in("source_upload_id", ssiOldIds.slice(i, i + 50));
        }

        const ssiFnUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/sql-import-cron`;
        const ssiP = fetch(ssiFnUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({ phase: "fetch", sourceId: ssiSourceId, uploadId: ssiUpload.id }),
        }).catch(() => {});
        const ssiRuntime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
        if (ssiRuntime?.waitUntil) ssiRuntime.waitUntil(ssiP);

        return jsonResponse({ success: true, uploadId: ssiUpload.id });
      }

      case "get-import-progress": {
        const { uploadId: gipUploadId } = body;
        if (!gipUploadId) return jsonResponse({ error: "Upload ID required" }, 400);
        const { data: gipUpload } = await supabase
          .from("source_uploads")
          .select("id, status, row_count, resync_progress")
          .eq("id", gipUploadId)
          .maybeSingle();
        if (!gipUpload) return jsonResponse({ error: "Upload not found" }, 404);
        return jsonResponse({ success: true, upload: gipUpload });
      }

      case "sql-import-count": {
        const { sourceId: sicSourceId } = body;
        if (!sicSourceId) return jsonResponse({ error: "Source ID required" }, 400);

        const { data: sicSource, error: sicErr } = await supabase
          .from("data_sources")
          .select("*")
          .eq("id", sicSourceId)
          .maybeSingle();
        if (sicErr) throw sicErr;
        if (!sicSource) return jsonResponse({ error: "Data source not found" }, 404);
        if (!sicSource.db_host || !sicSource.db_table) {
          return jsonResponse({ error: "Database connection not configured" }, 400);
        }

        const sicPassword = sicSource.db_password_secret_name
          ? resolveSecret(sicSource.db_password_secret_name)
          : "";

        try {
          const { default: postgres } = await import("npm:postgres@3.4.5");
          const sql = postgres({
            host: sicSource.db_host,
            port: sicSource.db_port || 5432,
            database: sicSource.db_name || "postgres",
            username: sicSource.db_user || "postgres",
            password: sicPassword,
            ssl: { ca: AKAMAI_CA_CERT },
            connect_timeout: 10,
            max: 1,
            idle_timeout: 5,
          });

          const schemaName = sicSource.db_schema || "public";
          const tableName = sicSource.db_table;

          // Use estimated count for large tables (fast), fall back to exact if estimate is 0
          let total = 0;
          try {
            const estResult = await sql.unsafe(
              `SELECT reltuples::bigint AS estimate FROM pg_class WHERE relname = $1`,
              [tableName]
            );
            total = parseInt(String(estResult[0]?.estimate ?? "0"), 10);
          } catch { /* ignore */ }
          if (total <= 0) {
            // Fallback: exact count with a timeout to avoid edge function death
            try {
              await sql.unsafe(`SET statement_timeout = '20s'`);
              const countResult = await sql.unsafe(
                `SELECT COUNT(*) as total FROM "${schemaName}"."${tableName}"`
              );
              total = parseInt(String(countResult[0]?.total ?? "0"), 10);
              await sql.unsafe(`RESET statement_timeout`);
            } catch {
              total = -1; // unknown
            }
          }

          const colResult = await sql`
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = ${schemaName} AND table_name = ${tableName}
            ORDER BY ordinal_position
          `;
          const columns = colResult.map((r: { column_name: string }) => r.column_name);

          const sampleResult = await sql.unsafe(
            `SELECT * FROM "${schemaName}"."${tableName}" LIMIT 5`
          );
          const sampleRows = sampleResult.map((row: Record<string, unknown>) => {
            const strRow: Record<string, string> = {};
            for (const [k, v] of Object.entries(row)) {
              strRow[k] = v == null ? "" : String(v);
            }
            return strRow;
          });

          await sql.end();
          return jsonResponse({ success: true, total, columns, sampleRows });
        } catch (connErr: unknown) {
          const msg = connErr instanceof Error ? connErr.message : "Connection failed";
          return jsonResponse({ error: msg }, 502);
        }
      }

      case "sql-import-batch": {
        const { sourceId: sibSourceId, offset: sibOffset, batchSize: sibBatchSize } = body;
        if (!sibSourceId) return jsonResponse({ error: "Source ID required" }, 400);

        const batchOffset = parseInt(sibOffset || "0", 10);
        const batchLimit = Math.min(parseInt(sibBatchSize || "1000", 10), 2000);

        const { data: sibSource, error: sibErr } = await supabase
          .from("data_sources")
          .select("*")
          .eq("id", sibSourceId)
          .maybeSingle();
        if (sibErr) throw sibErr;
        if (!sibSource) return jsonResponse({ error: "Data source not found" }, 404);
        if (!sibSource.db_host || !sibSource.db_table) {
          return jsonResponse({ error: "Database connection not configured" }, 400);
        }

        const sibPassword = sibSource.db_password_secret_name
          ? resolveSecret(sibSource.db_password_secret_name)
          : "";

        try {
          const { default: postgres } = await import("npm:postgres@3.4.5");
          const sql = postgres({
            host: sibSource.db_host,
            port: sibSource.db_port || 5432,
            database: sibSource.db_name || "postgres",
            username: sibSource.db_user || "postgres",
            password: sibPassword,
            ssl: { ca: AKAMAI_CA_CERT },
            connect_timeout: 30,
            max: 1,
            idle_timeout: 5,
          });

          const schemaName = sibSource.db_schema || "public";
          const tableName = sibSource.db_table;

          // Legacy path kept for stale cached frontends. Without ORDER BY,
          // LIMIT/OFFSET returns arbitrary rows per query — guaranteeing
          // duplicates and skips across batches.
          const sibColCheck = await sql`
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = ${schemaName} AND table_name = ${tableName} AND column_name = '_dlt_id'
          `;
          const sibOrderClause = sibColCheck.length > 0 ? `ORDER BY "_dlt_id"` : "";

          const result = await sql.unsafe(
            `SELECT * FROM "${schemaName}"."${tableName}" ${sibOrderClause} LIMIT $1 OFFSET $2`,
            [batchLimit, batchOffset]
          );

          const rows = result.map((row: Record<string, unknown>) => {
            const strRow: Record<string, string> = {};
            for (const [k, v] of Object.entries(row)) {
              strRow[k] = v == null ? "" : String(v);
            }
            return strRow;
          });

          await sql.end();
          return jsonResponse({
            success: true,
            rows,
            count: rows.length,
            offset: batchOffset,
            hasMore: rows.length === batchLimit,
          });
        } catch (connErr: unknown) {
          const msg = connErr instanceof Error ? connErr.message : "Connection failed";
          return jsonResponse({ error: msg }, 502);
        }
      }

      case "prune-source-records": {
        const { dryRun = true, retentionDays = 7 } = body;

        const cutoff = new Date(Date.now() - (retentionDays as number) * 24 * 60 * 60 * 1000).toISOString();

        // Find the most recent active+complete upload per data_source_id+carrier (always protected)
        const { data: allUploadsForPrune } = await supabase
          .from("source_uploads")
          .select("id, data_source_id, carrier, filename, status, is_active, row_count, created_at")
          .order("created_at", { ascending: false });

        const protectedIds = new Set<string>();
        const seenKeys = new Set<string>();
        for (const u of allUploadsForPrune || []) {
          const key = `${u.data_source_id}::${u.carrier}`;
          if (!seenKeys.has(key) && u.is_active && u.status === "complete") {
            protectedIds.add(u.id);
            seenKeys.add(key);
          }
        }

        // Candidates: older than cutoff, not the protected latest, not currently processing
        const candidates: Array<{
          uploadId: string; filename: string; carrier: string;
          completedAt: string; isActive: boolean; sourceRecordCount: number;
        }> = [];

        for (const u of allUploadsForPrune || []) {
          if (protectedIds.has(u.id)) continue;
          if (u.status === "processing") continue;
          if (new Date(u.created_at) >= new Date(cutoff)) continue;

          const { count } = await supabase
            .from("source_records")
            .select("id", { count: "exact", head: true })
            .eq("source_upload_id", u.id);

          candidates.push({
            uploadId: u.id,
            filename: u.filename,
            carrier: u.carrier,
            completedAt: u.created_at,
            isActive: u.is_active,
            sourceRecordCount: count || 0,
          });
        }

        const totalRowsWouldDelete = candidates.reduce((sum, c) => sum + c.sourceRecordCount, 0);
        const remainingUploads = (allUploadsForPrune || []).length - candidates.length;

        // Safety guards
        if (remainingUploads <= 0) {
          return jsonResponse({
            aborted: true,
            reason: "Pruning would leave zero uploads -- aborting",
            candidates,
            totalRowsWouldDelete,
          });
        }

        const { count: currentTotalRecords } = await supabase
          .from("source_records")
          .select("id", { count: "exact", head: true });

        if ((currentTotalRecords || 0) - totalRowsWouldDelete <= 0) {
          return jsonResponse({
            aborted: true,
            reason: "Pruning would leave zero source_records -- aborting",
            candidates,
            totalRowsWouldDelete,
          });
        }

        if (dryRun) {
          return jsonResponse({
            dryRun: true,
            retentionDays,
            cutoffDate: cutoff,
            candidates,
            totalRowsWouldDelete,
            remainingUploads,
            remainingRecords: (currentTotalRecords || 0) - totalRowsWouldDelete,
          });
        }

        // Actual deletion (same path as delete-source-upload)
        let totalDeletedPolicies = 0;
        let totalDeletedRecords = 0;
        let uploadsDeleted = 0;

        for (const candidate of candidates) {
          const { count: delPolicies } = await supabase
            .from("form_submissions")
            .delete({ count: "exact" })
            .eq("source_upload_id", candidate.uploadId);

          const { count: delRecords } = await supabase
            .from("source_records")
            .delete({ count: "exact" })
            .eq("source_upload_id", candidate.uploadId);

          await supabase
            .from("source_uploads")
            .delete()
            .eq("id", candidate.uploadId);

          totalDeletedPolicies += delPolicies || 0;
          totalDeletedRecords += delRecords || 0;
          uploadsDeleted++;
        }

        return jsonResponse({
          dryRun: false,
          uploadsDeleted,
          totalDeletedPolicies,
          totalDeletedRecords,
          remainingUploads,
        });
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
        // Policies for this manager's agency
        const { data: agencyPolicies, error: apErr } = await supabase
          .from("form_submissions")
          .select("id, policy_number, client_first_name, client_last_name, agent_first_name, agent_last_name, agent_number, product_type, carrier, plan_premium, status, paid_to_date, policy_effective_date, phone, email, contract_code")
          .eq("agency_id", session.agency_id);
        if (apErr) throw apErr;
        const policyIds = (agencyPolicies || []).map((p: { id: string }) => p.id);
        if (policyIds.length === 0) return jsonResponse({ worklist: [] });

        const [{ data: flags }, { data: disps }] = await Promise.all([
          supabase
            .from("at_risk_activities")
            .select("policy_id, kind, created_at")
            .eq("kind", "flag")
            .in("policy_id", policyIds),
          supabase
            .from("policy_dispositions")
            .select("policy_id, disposition, follow_up_at, set_at")
            .in("policy_id", policyIds),
        ]);
        const flaggedIds = new Set((flags || []).map((f: { policy_id: string }) => f.policy_id));
        const dispByPolicy = new Map(
          (disps || []).map((d: { policy_id: string }) => [d.policy_id, d])
        );
        const worklist = (agencyPolicies || [])
          .filter((p: { id: string }) => flaggedIds.has(p.id))
          .map((p: Record<string, unknown>) => shapeWorklistRow(p, dispByPolicy.get(p.id as string) || null));
        return jsonResponse({ worklist, agency_id: session.agency_id });
      }

      case "mgr-terminated-worklist": {
        if (session.role !== "manager") return jsonResponse({ error: "Forbidden" }, 403);
        // Recently-terminated policies for this manager's agency — the win-back
        // outreach lane. We only surface policies that fell off within the last
        // TERMINATED_WINDOW_DAYS so managers chase fresh, still-recoverable
        // business instead of a years-deep graveyard.
        //
        // NOTE (data gap): form_submissions has no true termination timestamp.
        // The UNL file is current-state only and created_at reflects ingestion
        // (all current rows backfilled this month), so it can't date a status
        // change. paid_to_date — the date coverage was last paid through — is
        // the best available proxy for "when it fell off". Proper fix is a
        // terminated_at captured in the ingestion pipeline (loop in Max); swap
        // the filter below to that column once it exists.
        const TERMINATED_WINDOW_DAYS = 45;
        const termCutoff = new Date(Date.now() - TERMINATED_WINDOW_DAYS * 86400000)
          .toISOString()
          .slice(0, 10);
        const { data: termPolicies, error: tpErr } = await supabase
          .from("form_submissions")
          .select("id, policy_number, client_first_name, client_last_name, agent_first_name, agent_last_name, agent_number, product_type, carrier, plan_premium, status, paid_to_date, policy_effective_date, phone, email, contract_code")
          .eq("agency_id", session.agency_id)
          .eq("status", "terminated")
          .gte("paid_to_date", termCutoff);
        if (tpErr) throw tpErr;
        const termIds = (termPolicies || []).map((p: { id: string }) => p.id);
        if (termIds.length === 0) return jsonResponse({ worklist: [], agency_id: session.agency_id });

        const { data: termDisps } = await supabase
          .from("policy_dispositions")
          .select("policy_id, disposition, follow_up_at, set_at")
          .in("policy_id", termIds);
        const termDispByPolicy = new Map(
          (termDisps || []).map((d: { policy_id: string }) => [d.policy_id, d])
        );
        const worklist = (termPolicies || []).map((p: Record<string, unknown>) =>
          shapeWorklistRow(p, termDispByPolicy.get(p.id as string) || null)
        );
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
        if (!["working", "secured", "lost", "follow_up"].includes(disposition)) {
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
            set_at: new Date().toISOString(),
          }, { onConflict: "policy_id" });
        if (dsErr) throw dsErr;
        return jsonResponse({ policy_id, disposition });
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
