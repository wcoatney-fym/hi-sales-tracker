import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey, X-Agent-Token",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400) {
  return jsonResponse({ error: message }, status);
}

function getDateRange(period: string): { start: string; end: string } {
  const now = new Date();
  if (period === "daily") {
    const start = now.toISOString().slice(0, 10);
    return { start, end: start };
  }
  if (period === "weekly") {
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now);
    monday.setDate(diff);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return {
      start: monday.toISOString().slice(0, 10),
      end: sunday.toISOString().slice(0, 10),
    };
  }
  if (period === "yearly") {
    const start = new Date(now.getFullYear(), 0, 1);
    const end = new Date(now.getFullYear(), 11, 31);
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    };
  }
  // monthly
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function getPeriodKey(period: string): string {
  const now = new Date();
  if (period === "daily") return now.toISOString().slice(0, 10);
  if (period === "weekly") {
    const jan1 = new Date(now.getFullYear(), 0, 1);
    const days = Math.floor(
      (now.getTime() - jan1.getTime()) / (24 * 60 * 60 * 1000)
    );
    const week = Math.ceil((days + jan1.getDay() + 1) / 7);
    return `${now.getFullYear()}-W${String(week).padStart(2, "0")}`;
  }
  if (period === "yearly") return `${now.getFullYear()}`;
  return now.toISOString().slice(0, 7);
}

function computeTier(totalPolicies: number): string {
  return totalPolicies >= 201 ? "Diamond" :
    totalPolicies >= 101 ? "Platinum" :
    totalPolicies >= 51 ? "Gold" :
    totalPolicies >= 26 ? "Silver" :
    totalPolicies >= 11 ? "Bronze" : "Rookie";
}

function isWorkDay(d: Date): boolean {
  const day = d.getDay();
  return day !== 0 && day !== 6;
}

function nextWorkDay(d: Date): Date {
  const n = new Date(d);
  do { n.setDate(n.getDate() + 1); } while (!isWorkDay(n));
  return n;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function computePolicyTokensWithStreak(policiesPerDay: Record<string, number>): { total: number; currentMultiplier: number } {
  const dates = Object.keys(policiesPerDay).sort();
  if (dates.length === 0) return { total: 0, currentMultiplier: 1 };

  const startDate = new Date(dates[0] + "T00:00:00");
  const endDate = new Date();
  let cursor = startDate;
  while (!isWorkDay(cursor)) cursor = nextWorkDay(cursor);

  let streak = 0;
  let total = 0;

  while (cursor <= endDate) {
    if (!isWorkDay(cursor)) { cursor.setDate(cursor.getDate() + 1); continue; }
    const ds = toDateStr(cursor);
    const count = policiesPerDay[ds] || 0;
    if (count > 0) {
      streak++;
      const multiplier = streak >= 2 ? Math.min(streak, 10) : 1;
      total += count * 10 * multiplier;
    } else {
      streak = 0;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  const currentMultiplier = streak >= 2 ? Math.min(streak, 10) : 1;
  return { total, currentMultiplier };
}

function computeTalkTimeTokensWithStreak(dailyMinutes: Record<string, number>): { total: number; currentMultiplier: number } {
  const THRESHOLD = 240;
  const dates = Object.keys(dailyMinutes).sort();
  if (dates.length === 0) return { total: 0, currentMultiplier: 1 };

  const startDate = new Date(dates[0] + "T00:00:00");
  const endDate = new Date();
  let cursor = startDate;
  while (!isWorkDay(cursor)) cursor = nextWorkDay(cursor);

  let streak = 0;
  let total = 0;

  while (cursor <= endDate) {
    if (!isWorkDay(cursor)) { cursor.setDate(cursor.getDate() + 1); continue; }
    const ds = toDateStr(cursor);
    const mins = dailyMinutes[ds] || 0;
    if (mins >= THRESHOLD) {
      streak++;
      const multiplier = streak >= 2 ? Math.min(streak, 10) : 1;
      total += mins * multiplier;
    } else {
      streak = 0;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  const currentMultiplier = streak >= 2 ? Math.min(streak, 10) : 1;
  return { total, currentMultiplier };
}

function prevDay(d: Date): Date {
  const p = new Date(d);
  p.setDate(p.getDate() - 1);
  return p;
}

function computeWorkDayStreak(saleDates: Set<string>): number {
  let cursor = new Date();
  if (isWorkDay(cursor) && !saleDates.has(toDateStr(cursor))) {
    cursor = prevDay(cursor);
  }
  while (!isWorkDay(cursor)) {
    cursor = prevDay(cursor);
  }

  let streak = 0;
  while (true) {
    while (!isWorkDay(cursor)) {
      cursor = prevDay(cursor);
    }
    if (saleDates.has(toDateStr(cursor))) {
      streak++;
      cursor = prevDay(cursor);
    } else {
      break;
    }
  }
  return streak;
}

function computeTalkTimeStreak(dailyMinutes: Record<string, number>): number {
  const THRESHOLD = 240;
  let cursor = new Date();

  if (isWorkDay(cursor) && (dailyMinutes[toDateStr(cursor)] || 0) < THRESHOLD) {
    cursor = prevDay(cursor);
  }
  while (!isWorkDay(cursor)) {
    cursor = prevDay(cursor);
  }

  let streak = 0;
  while (true) {
    while (!isWorkDay(cursor)) {
      cursor = prevDay(cursor);
    }
    if ((dailyMinutes[toDateStr(cursor)] || 0) >= THRESHOLD) {
      streak++;
      cursor = prevDay(cursor);
    } else {
      break;
    }
  }
  return streak;
}


// True when the token belongs to a session allowed to view this agency's data:
// an admin session scoped to the agency (global admins, with no agency_id, may
// view any — and are the only ones allowed when agencyId is null/overall), or
// an agent session whose agent belongs to the agency.
// deno-lint-ignore no-explicit-any
async function authorizeAgencyAccess(
  supabase: any,
  accessToken: string,
  agencyId: string | null,
): Promise<boolean> {
  if (!accessToken) return false;
  const nowIso = new Date().toISOString();
  const { data: adminSession } = await supabase
    .from("admin_sessions")
    .select("agency_id")
    .eq("token", accessToken)
    .gt("expires_at", nowIso)
    .maybeSingle();
  if (adminSession) {
    return !adminSession.agency_id || (agencyId !== null && adminSession.agency_id === agencyId);
  }
  if (!agencyId) return false;
  const { data: agentSession } = await supabase
    .from("agent_sessions")
    .select("agent_id")
    .eq("token", accessToken)
    .gt("expires_at", nowIso)
    .maybeSingle();
  if (agentSession) {
    const { data: sessionAgent } = await supabase
      .from("agents")
      .select("agency_id")
      .eq("id", agentSession.agent_id)
      .maybeSingle();
    return !!sessionAgent && sessionAgent.agency_id === agencyId;
  }
  return false;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "";

    if (action === "get-leaderboard") {
      const period = url.searchParams.get("period") || "weekly";
      const { start, end } = getDateRange(period);

      // Get all agent writing numbers (for matching Intake Form submissions)
      const { data: agencyAgents } = await supabase
        .from("agents")
        .select("unl_writing_number, agency")
        .not("agency", "is", null);
      const agencyAgentNumbers = new Set(
        (agencyAgents || []).map((a) => a.unl_writing_number).filter(Boolean)
      );
      const agentAgencyMap: Record<string, string> = {};
      for (const a of agencyAgents || []) {
        if (a.unl_writing_number) agentAgencyMap[a.unl_writing_number] = a.agency;
      }

      // Build alias resolution map: old_number -> canonical_number
      const { data: aliasRows } = await supabase
        .from("agent_writing_numbers")
        .select("writing_number, agent_id");
      const { data: canonicalAgents } = await supabase
        .from("agents")
        .select("id, unl_writing_number");
      const agentCanonicalMap: Record<string, string> = {};
      if (aliasRows && canonicalAgents) {
        const idToCanonical: Record<string, string> = {};
        for (const a of canonicalAgents) {
          if (a.unl_writing_number) idToCanonical[a.id] = a.unl_writing_number;
        }
        for (const row of aliasRows) {
          const canonical = idToCanonical[row.agent_id];
          if (canonical && row.writing_number !== canonical) {
            agentCanonicalMap[row.writing_number] = canonical;
          }
        }
      }
      const resolveNumber = (num: string) => agentCanonicalMap[num] || num;

      // Get all submissions in the period (agency-tagged)
      const { data: agencySubmissions } = await supabase
        .from("form_submissions")
        .select(
          "agent_first_name, agent_last_name, agent_number, client_first_name, client_last_name, carrier, plan_premium, app_submit_date, created_at, source, status, agency, policy_number"
        )
        .not("agency", "is", null)
        .gte("app_submit_date", start)
        .lte("app_submit_date", end);

      const { data: intakeSubmissions } = await supabase
        .from("form_submissions")
        .select(
          "agent_first_name, agent_last_name, agent_number, client_first_name, client_last_name, carrier, plan_premium, app_submit_date, created_at, source, status, agency, policy_number"
        )
        .eq("source", "Intake Form")
        .is("agency", null)
        .gte("app_submit_date", start)
        .lte("app_submit_date", end);

      // Combine, filtering intake submissions to known agents only
      const submissions = [
        ...(agencySubmissions || []),
        ...(intakeSubmissions || []).filter((s) => agencyAgentNumbers.has(resolveNumber(s.agent_number))),
      ].filter((s) => s.status !== "duplicate")
        // Policy-numbered rows first: a UNL row claims its client before the
        // intake-form twin of the same app is considered
        .sort((a, b) => (a.policy_number ? 0 : 1) - (b.policy_number ? 0 : 1));

      // Aggregate by agent, deduplicating by client name
      const agentMap: Record<string, {
        firstName: string;
        lastName: string;
        agentNumber: string;
        carrier: string;
        policies: number;
        commission: number;
        agencyName: string;
        clients: Set<string>;
        policyNumbers: Set<string>;
      }> = {};

      for (const s of submissions) {
        const resolved = resolveNumber(s.agent_number);
        const key = resolved || `${s.agent_first_name?.toLowerCase()}-${s.agent_last_name?.toLowerCase()}`;
        if (!agentMap[key]) {
          agentMap[key] = {
            firstName: s.agent_first_name || "",
            lastName: s.agent_last_name || "",
            agentNumber: resolved || "",
            carrier: s.carrier || "",
            policies: 0,
            commission: 0,
            agencyName: (s as any).agency || agentAgencyMap[resolved] || "",
            clients: new Set(),
            policyNumbers: new Set(),
          };
        }
        // Dedup: rows with a policy number are distinct policies (a client can
        // legitimately hold several); intake rows (no policy number yet) count
        // only if no other row already covered that client.
        const clientKey = `${(s.client_first_name || "").toLowerCase().trim()}-${(s.client_last_name || "").toLowerCase().trim()}`;
        const pn = ((s as { policy_number?: string }).policy_number || "").trim();
        if (pn) {
          if (!agentMap[key].policyNumbers.has(pn)) {
            agentMap[key].policyNumbers.add(pn);
            agentMap[key].clients.add(clientKey);
            agentMap[key].policies += 1;
            agentMap[key].commission += Number(s.plan_premium) || 0;
          }
        } else if (!agentMap[key].clients.has(clientKey)) {
          agentMap[key].clients.add(clientKey);
          agentMap[key].policies += 1;
          agentMap[key].commission += Number(s.plan_premium) || 0;
        }
      }

      // Sort by policies desc (strip internal clients set)
      const ranked = Object.values(agentMap)
        .map(({ clients: _clients, policyNumbers: _pns, ...rest }) => rest)
        .sort((a, b) => b.policies - a.policies);

      // Get profiles and badges for these agents
      const { data: agents } = await supabase.from("agents").select("id, first_name, last_name");
      const { data: profiles } = await supabase.from("leaderboard_profiles").select("*");
      const { data: agentBadges } = await supabase.from("agent_badges").select("agent_id, badge_slug, unlocked_at");
      const { data: tokenRows } = await supabase.from("agent_tokens").select("agent_id, tokens_total, talk_time_minutes");

      // Get weekly policies for policy club detection
      const weekRange = getDateRange("weekly");
      let weeklyPoliciesMap: Record<string, number> = {};
      if (period !== "weekly") {
        const { data: weekSubs } = await supabase
          .from("form_submissions")
          .select("agent_number, agent_first_name, agent_last_name, client_first_name, client_last_name")
          .not("agency", "is", null)
          .gte("app_submit_date", weekRange.start)
          .lte("app_submit_date", weekRange.end);
        const weekClients: Record<string, Set<string>> = {};
        for (const s of weekSubs || []) {
          const key = resolveNumber(s.agent_number) || `${(s.agent_first_name || "").toLowerCase()}-${(s.agent_last_name || "").toLowerCase()}`;
          if (!weekClients[key]) weekClients[key] = new Set();
          const ck = `${(s.client_first_name || "").toLowerCase().trim()}-${(s.client_last_name || "").toLowerCase().trim()}`;
          weekClients[key].add(ck);
        }
        for (const [k, v] of Object.entries(weekClients)) {
          weeklyPoliciesMap[k] = v.size;
        }
      }

      // Compute yearly AP for tier calculation (since Jan 1)
      const yearStart = `${new Date().getFullYear()}-01-01`;
      const { data: yearSubs } = await supabase
        .from("form_submissions")
        .select("agent_number, agent_first_name, agent_last_name, client_first_name, client_last_name, plan_premium, app_submit_date")
        .not("agency", "is", null)
        .gte("app_submit_date", yearStart);

      const yearlyAPMap: Record<string, number> = {};
      const yearlyPoliciesMap: Record<string, number> = {};
      const yearClients: Record<string, Set<string>> = {};
      const agentSaleDates: Record<string, Set<string>> = {};
      const agentPoliciesPerDay: Record<string, Record<string, number>> = {};
      for (const s of yearSubs || []) {
        const key = resolveNumber(s.agent_number) || `${(s.agent_first_name || "").toLowerCase()}-${(s.agent_last_name || "").toLowerCase()}`;
        if (!yearClients[key]) yearClients[key] = new Set();
        if (!agentSaleDates[key]) agentSaleDates[key] = new Set();
        if (!agentPoliciesPerDay[key]) agentPoliciesPerDay[key] = {};
        if (s.app_submit_date) agentSaleDates[key].add(s.app_submit_date);
        const ck = `${(s.client_first_name || "").toLowerCase().trim()}-${(s.client_last_name || "").toLowerCase().trim()}`;
        if (!yearClients[key].has(ck)) {
          yearClients[key].add(ck);
          yearlyAPMap[key] = (yearlyAPMap[key] || 0) + ((Number(s.plan_premium) || 0) * 12);
          yearlyPoliciesMap[key] = (yearlyPoliciesMap[key] || 0) + 1;
          if (s.app_submit_date) {
            agentPoliciesPerDay[key][s.app_submit_date] = (agentPoliciesPerDay[key][s.app_submit_date] || 0) + 1;
          }
        }
      }

      // Get previous period snapshots for rank change
      const periodKey = getPeriodKey(period);
      const { data: prevSnapshots } = await supabase
        .from("leaderboard_snapshots")
        .select("agent_id, rank")
        .eq("period_type", period)
        .eq("period_key", periodKey);

      const prevRankMap: Record<string, number> = {};
      for (const snap of prevSnapshots || []) {
        prevRankMap[snap.agent_id] = snap.rank;
      }

      const tokenMap: Record<string, { total: number; talkTime: number }> = {};
      for (const t of tokenRows || []) {
        tokenMap[t.agent_id] = { total: t.tokens_total, talkTime: t.talk_time_minutes };
      }

      // Fetch daily talk time logs for talk time streak computation
      const { data: talkTimeDailyRows } = await supabase
        .from("agent_talk_time_daily")
        .select("agent_id, date, minutes")
        .gte("date", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));

      const talkTimeDailyMap: Record<string, Record<string, number>> = {};
      for (const row of talkTimeDailyRows || []) {
        if (!talkTimeDailyMap[row.agent_id]) talkTimeDailyMap[row.agent_id] = {};
        talkTimeDailyMap[row.agent_id][row.date] = row.minutes;
      }

      // Build response
      const leaderboard = ranked.map((entry, idx) => {
        const rank = idx + 1;
        const agent = (agents || []).find(
          (a) =>
            a.first_name?.toLowerCase() === entry.firstName.toLowerCase() &&
            a.last_name?.toLowerCase() === entry.lastName.toLowerCase()
        );
        const agentId = agent?.id || null;
        const profile = (profiles || []).find((p) => p.agent_id === agentId);
        const badges = (agentBadges || [])
          .filter((b) => b.agent_id === agentId)
          .map((b) => b.badge_slug);
        const prevRank = agentId ? prevRankMap[agentId] : undefined;
        const rankChange =
          prevRank !== undefined ? prevRank - rank : 0;

        const agentKey = entry.agentNumber || `${entry.firstName.toLowerCase()}-${entry.lastName.toLowerCase()}`;
        const yearAP = yearlyAPMap[agentKey] || 0;
        const yearPolicies = yearlyPoliciesMap[agentKey] || 0;
        const annualPremium = Math.round(entry.commission * 12 * 100) / 100;

        // Streaks
        const salesStreak = computeWorkDayStreak(agentSaleDates[agentKey] || new Set());
        const talkTimeStreak = agentId ? computeTalkTimeStreak(talkTimeDailyMap[agentId] || {}) : 0;

        // Tokens: per-day streak-aware computation
        const policyTokens = computePolicyTokensWithStreak(agentPoliciesPerDay[agentKey] || {});
        const talkTimeTokens = agentId
          ? computeTalkTimeTokensWithStreak(talkTimeDailyMap[agentId] || {})
          : { total: 0, currentMultiplier: 1 };
        const totalTokens = policyTokens.total + talkTimeTokens.total;

        // Weekly policies for club detection
        const wp = period === "weekly" ? entry.policies : (weeklyPoliciesMap[agentKey] || 0);
        const policyClub = wp >= 15 ? "15" : wp >= 10 ? "10" : null;

        return {
          rank,
          agentId,
          firstName: entry.firstName,
          lastName: entry.lastName,
          agentNumber: entry.agentNumber,
          carrier: entry.carrier,
          agencyName: entry.agencyName || "",
          policies: entry.policies,
          commission: Math.round(entry.commission * 100) / 100,
          annualPremium,
          tokens: totalTokens,
          salesStreakMultiplier: policyTokens.currentMultiplier,
          talkTimeStreakMultiplier: talkTimeTokens.currentMultiplier,
          weeklyPolicies: wp,
          policyClub,
          xp: profile?.xp || 0,
          level: profile?.level || 1,
          tier: computeTier(yearPolicies),
          currentStreak: salesStreak,
          talkTimeStreak,
          totalPoliciesAllTime: profile?.total_policies_all_time || 0,
          badges,
          rankChange,
        };
      });

      // Detect battle mode pairs (within 2 policies of each other)
      const battles: Array<[number, number]> = [];
      for (let i = 0; i < leaderboard.length - 1; i++) {
        if (leaderboard[i].policies - leaderboard[i + 1].policies <= 2) {
          battles.push([leaderboard[i].rank, leaderboard[i + 1].rank]);
        }
      }

      // Period reset countdown
      const now = new Date();
      let resetTime: Date;
      if (period === "daily") {
        resetTime = new Date(now);
        resetTime.setDate(resetTime.getDate() + 1);
        resetTime.setHours(0, 0, 0, 0);
      } else if (period === "weekly") {
        const day = now.getDay();
        const daysUntilMonday = day === 0 ? 1 : 8 - day;
        resetTime = new Date(now);
        resetTime.setDate(resetTime.getDate() + daysUntilMonday);
        resetTime.setHours(0, 0, 0, 0);
      } else if (period === "yearly") {
        resetTime = new Date(now.getFullYear() + 1, 0, 1);
      } else {
        resetTime = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      }

      return jsonResponse({
        leaderboard,
        battles,
        resetTime: resetTime.toISOString(),
        period,
        periodKey,
      });
    }

    if (action === "get-agency-leaderboard") {
      const agencyId = url.searchParams.get("agency_id");
      if (!agencyId) return errorResponse("agency_id is required");
      const period = url.searchParams.get("period") || "weekly";
      const { start, end } = getDateRange(period);

      // Verify agency exists
      const { data: agencyRow } = await supabase
        .from("agencies")
        .select("id, name, slug")
        .eq("id", agencyId)
        .maybeSingle();
      if (!agencyRow) return errorResponse("Agency not found", 404);

      // Agency data requires an authorized session; the agency UUID alone is
      // not a credential.
      const accessToken = url.searchParams.get("token") || req.headers.get("X-Agent-Token") || "";
      if (!accessToken) return errorResponse("Authentication required", 401);
      if (!(await authorizeAgencyAccess(supabase, accessToken, agencyId))) {
        return errorResponse("Not authorized for this agency", 403);
      }

      // Build alias resolution map
      const { data: aliasRows2 } = await supabase
        .from("agent_writing_numbers")
        .select("writing_number, agent_id");
      const { data: canonicalAgents2 } = await supabase
        .from("agents")
        .select("id, unl_writing_number");
      const agentCanonicalMap2: Record<string, string> = {};
      if (aliasRows2 && canonicalAgents2) {
        const idToCanonical2: Record<string, string> = {};
        for (const a of canonicalAgents2) {
          if (a.unl_writing_number) idToCanonical2[a.id] = a.unl_writing_number;
        }
        for (const row of aliasRows2) {
          const canonical = idToCanonical2[row.agent_id];
          if (canonical && row.writing_number !== canonical) {
            agentCanonicalMap2[row.writing_number] = canonical;
          }
        }
      }
      const resolveNumber2 = (num: string) => agentCanonicalMap2[num] || num;

      // Get submissions for this agency in the period
      const { data: agencySubs } = await supabase
        .from("form_submissions")
        .select(
          "agent_first_name, agent_last_name, agent_number, client_first_name, client_last_name, carrier, plan_premium, app_submit_date, created_at, source, status, policy_number"
        )
        .eq("agency_id", agencyId)
        .gte("app_submit_date", start)
        .lte("app_submit_date", end);

      const submissions = (agencySubs || [])
        .filter((s) => s.status !== "duplicate")
        .sort((a, b) => (a.policy_number ? 0 : 1) - (b.policy_number ? 0 : 1));

      // Aggregate by agent, deduplicating by client name
      const agentMap: Record<string, {
        firstName: string;
        lastName: string;
        agentNumber: string;
        carrier: string;
        policies: number;
        commission: number;
        clients: Set<string>;
        policyNumbers: Set<string>;
      }> = {};

      for (const s of submissions) {
        const resolved2 = resolveNumber2(s.agent_number);
        const key = resolved2 || `${s.agent_first_name?.toLowerCase()}-${s.agent_last_name?.toLowerCase()}`;
        if (!agentMap[key]) {
          agentMap[key] = {
            firstName: s.agent_first_name || "",
            lastName: s.agent_last_name || "",
            agentNumber: resolved2 || "",
            carrier: s.carrier || "",
            policies: 0,
            commission: 0,
            clients: new Set(),
            policyNumbers: new Set(),
          };
        }
        // Dedup: rows with a policy number are distinct policies (a client can
        // legitimately hold several); intake rows (no policy number yet) count
        // only if no other row already covered that client.
        const clientKey = `${(s.client_first_name || "").toLowerCase().trim()}-${(s.client_last_name || "").toLowerCase().trim()}`;
        const pn = ((s as { policy_number?: string }).policy_number || "").trim();
        if (pn) {
          if (!agentMap[key].policyNumbers.has(pn)) {
            agentMap[key].policyNumbers.add(pn);
            agentMap[key].clients.add(clientKey);
            agentMap[key].policies += 1;
            agentMap[key].commission += Number(s.plan_premium) || 0;
          }
        } else if (!agentMap[key].clients.has(clientKey)) {
          agentMap[key].clients.add(clientKey);
          agentMap[key].policies += 1;
          agentMap[key].commission += Number(s.plan_premium) || 0;
        }
      }

      const ranked = Object.values(agentMap)
        .map(({ clients: _clients, policyNumbers: _pns, ...rest }) => rest)
        .sort((a, b) => b.policies - a.policies);

      // Get profiles and badges
      const { data: agents } = await supabase.from("agents").select("id, first_name, last_name").eq("agency_id", agencyId);
      const { data: profiles } = await supabase.from("leaderboard_profiles").select("*");
      const { data: agentBadges } = await supabase.from("agent_badges").select("agent_id, badge_slug, unlocked_at");
      const { data: tokenRows } = await supabase.from("agent_tokens").select("agent_id, tokens_total, talk_time_minutes");

      // Weekly policies for club detection
      const weekRange = getDateRange("weekly");
      let weeklyPoliciesMap: Record<string, number> = {};
      if (period !== "weekly") {
        const { data: weekSubs } = await supabase
          .from("form_submissions")
          .select("agent_number, agent_first_name, agent_last_name, client_first_name, client_last_name")
          .eq("agency_id", agencyId)
          .gte("app_submit_date", weekRange.start)
          .lte("app_submit_date", weekRange.end);
        const weekClients: Record<string, Set<string>> = {};
        for (const s of weekSubs || []) {
          const key = resolveNumber2(s.agent_number) || `${(s.agent_first_name || "").toLowerCase()}-${(s.agent_last_name || "").toLowerCase()}`;
          if (!weekClients[key]) weekClients[key] = new Set();
          const ck = `${(s.client_first_name || "").toLowerCase().trim()}-${(s.client_last_name || "").toLowerCase().trim()}`;
          weekClients[key].add(ck);
        }
        for (const [k, v] of Object.entries(weekClients)) {
          weeklyPoliciesMap[k] = v.size;
        }
      }

      // Yearly data for tier + tokens
      const yearStart = `${new Date().getFullYear()}-01-01`;
      const { data: yearSubs } = await supabase
        .from("form_submissions")
        .select("agent_number, agent_first_name, agent_last_name, client_first_name, client_last_name, plan_premium, app_submit_date")
        .eq("agency_id", agencyId)
        .gte("app_submit_date", yearStart);

      const yearlyPoliciesMap: Record<string, number> = {};
      const yearClients: Record<string, Set<string>> = {};
      const agentSaleDates: Record<string, Set<string>> = {};
      const agentPoliciesPerDay: Record<string, Record<string, number>> = {};
      for (const s of yearSubs || []) {
        const key = resolveNumber2(s.agent_number) || `${(s.agent_first_name || "").toLowerCase()}-${(s.agent_last_name || "").toLowerCase()}`;
        if (!yearClients[key]) yearClients[key] = new Set();
        if (!agentSaleDates[key]) agentSaleDates[key] = new Set();
        if (!agentPoliciesPerDay[key]) agentPoliciesPerDay[key] = {};
        if (s.app_submit_date) agentSaleDates[key].add(s.app_submit_date);
        const ck = `${(s.client_first_name || "").toLowerCase().trim()}-${(s.client_last_name || "").toLowerCase().trim()}`;
        if (!yearClients[key].has(ck)) {
          yearClients[key].add(ck);
          yearlyPoliciesMap[key] = (yearlyPoliciesMap[key] || 0) + 1;
          if (s.app_submit_date) {
            agentPoliciesPerDay[key][s.app_submit_date] = (agentPoliciesPerDay[key][s.app_submit_date] || 0) + 1;
          }
        }
      }

      // Rank change from snapshots
      const periodKey = getPeriodKey(period);
      const { data: prevSnapshots } = await supabase
        .from("leaderboard_snapshots")
        .select("agent_id, rank")
        .eq("period_type", period)
        .eq("period_key", periodKey);
      const prevRankMap: Record<string, number> = {};
      for (const snap of prevSnapshots || []) {
        prevRankMap[snap.agent_id] = snap.rank;
      }

      const tokenMap: Record<string, { total: number; talkTime: number }> = {};
      for (const t of tokenRows || []) {
        tokenMap[t.agent_id] = { total: t.tokens_total, talkTime: t.talk_time_minutes };
      }

      // Talk time daily
      const { data: talkTimeDailyRows } = await supabase
        .from("agent_talk_time_daily")
        .select("agent_id, date, minutes")
        .gte("date", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
      const talkTimeDailyMap: Record<string, Record<string, number>> = {};
      for (const row of talkTimeDailyRows || []) {
        if (!talkTimeDailyMap[row.agent_id]) talkTimeDailyMap[row.agent_id] = {};
        talkTimeDailyMap[row.agent_id][row.date] = row.minutes;
      }

      // Build leaderboard
      const leaderboard = ranked.map((entry, idx) => {
        const rank = idx + 1;
        const agent = (agents || []).find(
          (a) =>
            a.first_name?.toLowerCase() === entry.firstName.toLowerCase() &&
            a.last_name?.toLowerCase() === entry.lastName.toLowerCase()
        );
        const agentId2 = agent?.id || null;
        const profile = (profiles || []).find((p) => p.agent_id === agentId2);
        const badges = (agentBadges || [])
          .filter((b) => b.agent_id === agentId2)
          .map((b) => b.badge_slug);
        const prevRank = agentId2 ? prevRankMap[agentId2] : undefined;
        const rankChange = prevRank !== undefined ? prevRank - rank : 0;

        const agentKey = entry.agentNumber || `${entry.firstName.toLowerCase()}-${entry.lastName.toLowerCase()}`;
        const yearPolicies = yearlyPoliciesMap[agentKey] || 0;
        const annualPremium = Math.round(entry.commission * 12 * 100) / 100;

        const salesStreak = computeWorkDayStreak(agentSaleDates[agentKey] || new Set());
        const talkTimeStreak = agentId2 ? computeTalkTimeStreak(talkTimeDailyMap[agentId2] || {}) : 0;

        const policyTokens = computePolicyTokensWithStreak(agentPoliciesPerDay[agentKey] || {});
        const talkTimeTokens = agentId2
          ? computeTalkTimeTokensWithStreak(talkTimeDailyMap[agentId2] || {})
          : { total: 0, currentMultiplier: 1 };
        const totalTokens = policyTokens.total + talkTimeTokens.total;

        const wp = period === "weekly" ? entry.policies : (weeklyPoliciesMap[agentKey] || 0);
        const policyClub = wp >= 15 ? "15" : wp >= 10 ? "10" : null;

        return {
          rank,
          agentId: agentId2,
          firstName: entry.firstName,
          lastName: entry.lastName,
          agentNumber: entry.agentNumber,
          carrier: entry.carrier,
          policies: entry.policies,
          commission: Math.round(entry.commission * 100) / 100,
          annualPremium,
          tokens: totalTokens,
          salesStreakMultiplier: policyTokens.currentMultiplier,
          talkTimeStreakMultiplier: talkTimeTokens.currentMultiplier,
          weeklyPolicies: wp,
          policyClub,
          xp: profile?.xp || 0,
          level: profile?.level || 1,
          tier: computeTier(yearPolicies),
          currentStreak: salesStreak,
          talkTimeStreak,
          totalPoliciesAllTime: profile?.total_policies_all_time || 0,
          badges,
          rankChange,
        };
      });

      const battles: Array<[number, number]> = [];
      for (let i = 0; i < leaderboard.length - 1; i++) {
        if (leaderboard[i].policies - leaderboard[i + 1].policies <= 2) {
          battles.push([leaderboard[i].rank, leaderboard[i + 1].rank]);
        }
      }

      const now = new Date();
      let resetTime: Date;
      if (period === "daily") {
        resetTime = new Date(now);
        resetTime.setDate(resetTime.getDate() + 1);
        resetTime.setHours(0, 0, 0, 0);
      } else if (period === "weekly") {
        const day = now.getDay();
        const daysUntilMonday = day === 0 ? 1 : 8 - day;
        resetTime = new Date(now);
        resetTime.setDate(resetTime.getDate() + daysUntilMonday);
        resetTime.setHours(0, 0, 0, 0);
      } else if (period === "yearly") {
        resetTime = new Date(now.getFullYear() + 1, 0, 1);
      } else {
        resetTime = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      }

      return jsonResponse({
        leaderboard,
        battles,
        resetTime: resetTime.toISOString(),
        period,
        periodKey,
        agency: { id: agencyRow.id, name: agencyRow.name, slug: agencyRow.slug },
      });
    }

    if (action === "get-quality-metrics") {
      // Placement & persistency. agency_id scopes to one agency (admin scoped
      // to it, global admin, or agent in it); omitted = whole book, global
      // admins only.
      let qmAgencyId = url.searchParams.get("agency_id");
      const qmAgencyName = url.searchParams.get("agency_name");
      if (!qmAgencyId && qmAgencyName) {
        const { data: namedAgency } = await supabase
          .from("agencies")
          .select("id")
          .eq("name", qmAgencyName)
          .maybeSingle();
        if (!namedAgency) return errorResponse("Agency not found", 404);
        qmAgencyId = namedAgency.id;
      }
      const qmToken = url.searchParams.get("token") || req.headers.get("X-Agent-Token") || "";
      if (!qmToken) return errorResponse("Authentication required", 401);
      if (!(await authorizeAgencyAccess(supabase, qmToken, qmAgencyId))) {
        return errorResponse("Not authorized", 403);
      }
      const { data: qmData, error: qmError } = await supabase.rpc("get_quality_metrics", {
        p_agency_id: qmAgencyId || null,
      });
      if (qmError) return errorResponse(qmError.message, 500);
      return jsonResponse(qmData || { placement: [], persistency: [] });
    }

    if (action === "get-challenges") {
      const { data: challenges } = await supabase
        .from("challenges")
        .select("*")
        .eq("is_active", true)
        .gte("end_date", new Date().toISOString().slice(0, 10));

      // Compute team progress per challenge date range
      const enriched: unknown[] = [];
      for (const c of challenges || []) {
        if (c.type !== "team") {
          enriched.push(c);
          continue;
        }
        const { data: subs } = await supabase
          .from("form_submissions")
          .select("id, plan_premium")
          .in("agency", ["FYM", "Wisechoice Senior Advisors Llc"])
          .gte("app_submit_date", c.start_date)
          .lte("app_submit_date", c.end_date);

        const rows = subs || [];
        const isPremiumChallenge = c.title.toLowerCase().includes("premium") || c.title.toLowerCase().includes("revenue");
        const teamProgress = isPremiumChallenge
          ? rows.reduce((sum: number, r: { plan_premium: number }) => sum + (Number(r.plan_premium) || 0), 0)
          : rows.length;

        enriched.push({ ...c, teamProgress });
      }

      return jsonResponse({ challenges: enriched });
    }

    if (action === "get-badges") {
      const { data: allBadges } = await supabase
        .from("badges")
        .select("*")
        .order("created_at", { ascending: true });

      return jsonResponse({ badges: allBadges || [] });
    }

    if (action === "get-agent-stats") {
      const agentId = url.searchParams.get("agent_id");
      if (!agentId) return errorResponse("agent_id required");

      const { data: profile } = await supabase
        .from("leaderboard_profiles")
        .select("*")
        .eq("agent_id", agentId)
        .maybeSingle();

      const { data: badges } = await supabase
        .from("agent_badges")
        .select("badge_slug, unlocked_at")
        .eq("agent_id", agentId);

      // Get 7-day sparkline
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
      const { data: agent } = await supabase
        .from("agents")
        .select("first_name, last_name")
        .eq("id", agentId)
        .maybeSingle();

      let sparkline: Array<{ date: string; count: number }> = [];
      if (agent) {
        const { data: recentSubs } = await supabase
          .from("form_submissions")
          .select("app_submit_date")
          .ilike("agent_first_name", agent.first_name)
          .ilike("agent_last_name", agent.last_name)
          .gte("app_submit_date", sevenDaysAgo.toISOString().slice(0, 10));

        const dayMap: Record<string, number> = {};
        for (let i = 0; i < 7; i++) {
          const d = new Date(sevenDaysAgo);
          d.setDate(d.getDate() + i);
          dayMap[d.toISOString().slice(0, 10)] = 0;
        }
        for (const s of recentSubs || []) {
          if (s.app_submit_date && dayMap[s.app_submit_date] !== undefined) {
            dayMap[s.app_submit_date]++;
          }
        }
        sparkline = Object.entries(dayMap).map(([date, count]) => ({
          date,
          count,
        }));
      }

      // Compute dynamic tier and streak from yearly submissions
      let agentTier = "Rookie";
      let agentStreak = 0;
      if (agent) {
        const agentYearStart = `${new Date().getFullYear()}-01-01`;
        const { data: agentYearSubs } = await supabase
          .from("form_submissions")
          .select("client_first_name, client_last_name, plan_premium, app_submit_date, policy_number")
          .ilike("agent_first_name", agent.first_name)
          .ilike("agent_last_name", agent.last_name)
          .in("agency", ["FYM", "Wisechoice Senior Advisors Llc"])
          .gte("app_submit_date", agentYearStart);

        const clients = new Set<string>();
        const seenPolicyNumbers = new Set<string>();
        const saleDates = new Set<string>();
        let ap = 0;
        let policies = 0;
        const orderedSubs = (agentYearSubs || []).slice()
          .sort((a, b) => ((a as { policy_number?: string }).policy_number ? 0 : 1) - ((b as { policy_number?: string }).policy_number ? 0 : 1));
        for (const s of orderedSubs) {
          if (s.app_submit_date) saleDates.add(s.app_submit_date);
          const ck = `${(s.client_first_name || "").toLowerCase().trim()}-${(s.client_last_name || "").toLowerCase().trim()}`;
          const pn = ((s as { policy_number?: string }).policy_number || "").trim();
          if (pn) {
            if (!seenPolicyNumbers.has(pn)) {
              seenPolicyNumbers.add(pn);
              clients.add(ck);
              ap += (Number(s.plan_premium) || 0) * 12;
              policies += 1;
            }
          } else if (!clients.has(ck)) {
            clients.add(ck);
            ap += (Number(s.plan_premium) || 0) * 12;
            policies += 1;
          }
        }
        agentTier = computeTier(policies);
        agentStreak = computeWorkDayStreak(saleDates);
      }

      const profileData = profile
        ? { ...profile, tier: agentTier, current_streak: agentStreak }
        : { xp: 0, level: 1, tier: agentTier, current_streak: agentStreak, total_policies_all_time: 0 };

      return jsonResponse({
        profile: profileData,
        badges: badges || [],
        sparkline,
      });
    }

    if (action === "agent-login") {
      if (req.method !== "POST") return errorResponse("POST required", 405);
      const body = await req.json();
      const firstName = (body.firstName || "").trim();
      const lastName = (body.lastName || "").trim();
      const writingNumber = (body.writingNumber || "").trim();

      if (!firstName || !lastName || !writingNumber) {
        return errorResponse("First name, last name, and writing number are required");
      }

      const { data: agents } = await supabase
        .from("agents")
        .select("id, first_name, last_name, unl_writing_number, gtl_writing_number, agency_id")
        .ilike("first_name", firstName)
        .ilike("last_name", lastName);

      const matched = (agents || []).find((a) => {
        const unlMatch = a.unl_writing_number && a.unl_writing_number.toLowerCase() === writingNumber.toLowerCase();
        const gtlMatch = a.gtl_writing_number && a.gtl_writing_number.toLowerCase() === writingNumber.toLowerCase();
        return unlMatch || gtlMatch;
      });

      if (!matched) {
        return errorResponse("Invalid credentials. Please check your name and writing number.", 401);
      }

      // Resolve agency info
      let agencySlug: string | null = null;
      let agencyName: string | null = null;
      if (matched.agency_id) {
        const { data: agencyRow } = await supabase
          .from("agencies")
          .select("slug, name")
          .eq("id", matched.agency_id)
          .maybeSingle();
        if (agencyRow) {
          agencySlug = agencyRow.slug;
          agencyName = agencyRow.name;
        }
      }

      const token = crypto.randomUUID() + "-" + crypto.randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 90);

      await supabase.from("agent_sessions").insert({
        agent_id: matched.id,
        token,
        expires_at: expiresAt.toISOString(),
      });

      return jsonResponse({
        token,
        agent: {
          id: matched.id,
          firstName: matched.first_name,
          lastName: matched.last_name,
          agencyId: matched.agency_id,
          agencySlug,
          agencyName,
        },
        expiresAt: expiresAt.toISOString(),
      });
    }

    if (action === "agent-verify-session") {
      const authHeader = req.headers.get("X-Agent-Token") || "";
      if (!authHeader) return errorResponse("No session token", 401);

      const { data: session } = await supabase
        .from("agent_sessions")
        .select("agent_id, expires_at")
        .eq("token", authHeader)
        .maybeSingle();

      if (!session || new Date(session.expires_at) < new Date()) {
        if (session) {
          await supabase.from("agent_sessions").delete().eq("token", authHeader);
        }
        return errorResponse("Session expired", 401);
      }

      const { data: agent } = await supabase
        .from("agents")
        .select("id, first_name, last_name, agency_id")
        .eq("id", session.agent_id)
        .maybeSingle();

      if (!agent) return errorResponse("Agent not found", 404);

      let agencySlug: string | null = null;
      let agencyName: string | null = null;
      if (agent.agency_id) {
        const { data: agencyRow } = await supabase
          .from("agencies")
          .select("slug, name")
          .eq("id", agent.agency_id)
          .maybeSingle();
        if (agencyRow) {
          agencySlug = agencyRow.slug;
          agencyName = agencyRow.name;
        }
      }

      return jsonResponse({
        agent: {
          id: agent.id,
          firstName: agent.first_name,
          lastName: agent.last_name,
          agencyId: agent.agency_id,
          agencySlug,
          agencyName,
        },
      });
    }

    if (action === "agent-get-challenges") {
      const agentId = url.searchParams.get("agent_id");
      if (!agentId) return errorResponse("agent_id required");

      const { data: challenges } = await supabase
        .from("challenges")
        .select("*")
        .eq("is_active", true)
        .gte("end_date", new Date().toISOString().slice(0, 10));

      const { data: progress } = await supabase
        .from("challenge_progress")
        .select("challenge_id, current_value, completed, completed_at")
        .eq("agent_id", agentId);

      const progressMap: Record<string, { current_value: number; completed: boolean; completed_at: string | null }> = {};
      for (const p of progress || []) {
        progressMap[p.challenge_id] = p;
      }

      // Get agent name for personal progress computation
      const { data: agentRecord } = await supabase
        .from("agents")
        .select("first_name, last_name")
        .eq("id", agentId)
        .maybeSingle();

      const personalChallenges: unknown[] = [];
      const agencyChallenges: unknown[] = [];

      for (const c of challenges || []) {
        const isPremiumChallenge = c.title.toLowerCase().includes("premium") || c.title.toLowerCase().includes("revenue");

        if (c.type === "team") {
          // Compute team progress from submissions in the challenge's date range
          const { data: teamSubs } = await supabase
            .from("form_submissions")
            .select("id, plan_premium")
            .in("agency", ["FYM", "Wisechoice Senior Advisors Llc"])
            .gte("app_submit_date", c.start_date)
            .lte("app_submit_date", c.end_date);

          const rows = teamSubs || [];
          const teamProgress = isPremiumChallenge
            ? rows.reduce((sum: number, r: { plan_premium: number }) => sum + (Number(r.plan_premium) || 0), 0)
            : rows.length;

          agencyChallenges.push({
            ...c,
            agentProgress: 0,
            agentCompleted: false,
            agentCompletedAt: null,
            teamProgress,
          });
        } else {
          // Compute personal progress from agent's own submissions
          let agentProgress = progressMap[c.id]?.current_value || 0;
          const agentCompleted = progressMap[c.id]?.completed || false;
          const agentCompletedAt = progressMap[c.id]?.completed_at || null;

          // Live-compute progress from submissions if no manual progress recorded
          if (!agentProgress && agentRecord) {
            const { data: agentSubs } = await supabase
              .from("form_submissions")
              .select("id, plan_premium")
              .ilike("agent_first_name", agentRecord.first_name)
              .ilike("agent_last_name", agentRecord.last_name)
              .gte("app_submit_date", c.start_date)
              .lte("app_submit_date", c.end_date);

            const agentRows = agentSubs || [];
            agentProgress = isPremiumChallenge
              ? agentRows.reduce((sum: number, r: { plan_premium: number }) => sum + (Number(r.plan_premium) || 0), 0)
              : agentRows.length;
          }

          personalChallenges.push({
            ...c,
            agentProgress,
            agentCompleted,
            agentCompletedAt,
          });
        }
      }

      return jsonResponse({ personalChallenges, agencyChallenges });
    }

    if (action === "agent-logout") {
      const authHeader = req.headers.get("X-Agent-Token") || "";
      if (authHeader) {
        await supabase.from("agent_sessions").delete().eq("token", authHeader);
      }
      return jsonResponse({ success: true });
    }

    if (action === "get-active-promotion") {
      const { data } = await supabase
        .from("leaderboard_promotions")
        .select("id, title, goal, goal_tokens, incentive, start_date, end_date, period_type, sort_order")
        .eq("is_active", true)
        .gte("end_date", new Date().toISOString())
        .lte("start_date", new Date().toISOString())
        .order("period_type", { ascending: true })
        .order("sort_order", { ascending: true });
      return jsonResponse({ promotions: data || [] });
    }

    if (action === "agent-at-risk-policies") {
      const authHeader = req.headers.get("X-Agent-Token") || "";
      if (!authHeader) return errorResponse("No session token", 401);

      const { data: session } = await supabase
        .from("agent_sessions")
        .select("agent_id, expires_at")
        .eq("token", authHeader)
        .maybeSingle();

      if (!session || new Date(session.expires_at) < new Date()) {
        return errorResponse("Session expired", 401);
      }

      const { data: agent } = await supabase
        .from("agents")
        .select("id, unl_writing_number, gtl_writing_number")
        .eq("id", session.agent_id)
        .maybeSingle();

      if (!agent) return errorResponse("Agent not found", 404);

      const { data, error } = await supabase.rpc("get_agent_own_at_risk_policies", {
        p_unl_writing_number: agent.unl_writing_number || null,
        p_gtl_writing_number: agent.gtl_writing_number || null,
      });

      if (error) throw error;
      return jsonResponse({ policies: data || [] });
    }

    if (action === "agent-log-at-risk-activity") {
      const authHeader = req.headers.get("X-Agent-Token") || "";
      if (!authHeader) return errorResponse("No session token", 401);

      const { data: session } = await supabase
        .from("agent_sessions")
        .select("agent_id, expires_at")
        .eq("token", authHeader)
        .maybeSingle();

      if (!session || new Date(session.expires_at) < new Date()) {
        return errorResponse("Session expired", 401);
      }

      const body = await req.json();
      const { policyId, actionType, note: actNote } = body;
      if (!policyId || !actionType) {
        return errorResponse("policyId and actionType required", 400);
      }

      const { data, error } = await supabase
        .from("at_risk_activities")
        .insert({
          policy_id: policyId,
          agent_id: session.agent_id,
          action_type: actionType,
          note: actNote || "",
        })
        .select()
        .single();

      if (error) throw error;
      return jsonResponse(data);
    }

    if (action === "agent-dashboard-stats") {
      const authHeader = req.headers.get("X-Agent-Token") || "";
      if (!authHeader) return errorResponse("No session token", 401);

      const { data: session } = await supabase
        .from("agent_sessions")
        .select("agent_id, expires_at")
        .eq("token", authHeader)
        .maybeSingle();

      if (!session || new Date(session.expires_at) < new Date()) {
        return errorResponse("Session expired", 401);
      }

      const { data: agent } = await supabase
        .from("agents")
        .select("id, unl_writing_number, gtl_writing_number, agency")
        .eq("id", session.agent_id)
        .maybeSingle();

      if (!agent) return errorResponse("Agent not found", 404);

      const { data, error } = await supabase.rpc("get_agent_dashboard_stats", {
        p_unl_writing_number: agent.unl_writing_number || null,
        p_gtl_writing_number: agent.gtl_writing_number || null,
      });

      if (error) throw error;
      return jsonResponse(data);
    }

    if (action === "agent-production-history") {
      const authHeader = req.headers.get("X-Agent-Token") || "";
      if (!authHeader) return errorResponse("No session token", 401);

      const { data: session } = await supabase
        .from("agent_sessions")
        .select("agent_id, expires_at")
        .eq("token", authHeader)
        .maybeSingle();

      if (!session || new Date(session.expires_at) < new Date()) {
        return errorResponse("Session expired", 401);
      }

      const { data: agent } = await supabase
        .from("agents")
        .select("id, unl_writing_number, gtl_writing_number")
        .eq("id", session.agent_id)
        .maybeSingle();

      if (!agent) return errorResponse("Agent not found", 404);

      const { data, error } = await supabase.rpc("get_agent_production_history", {
        p_unl_writing_number: agent.unl_writing_number || null,
        p_gtl_writing_number: agent.gtl_writing_number || null,
      });

      if (error) throw error;
      return jsonResponse({ history: data || [] });
    }

    if (action === "agent-leaderboard-position") {
      const authHeader = req.headers.get("X-Agent-Token") || "";
      if (!authHeader) return errorResponse("No session token", 401);

      const { data: session } = await supabase
        .from("agent_sessions")
        .select("agent_id, expires_at")
        .eq("token", authHeader)
        .maybeSingle();

      if (!session || new Date(session.expires_at) < new Date()) {
        return errorResponse("Session expired", 401);
      }

      const { data: agent } = await supabase
        .from("agents")
        .select("id, agency")
        .eq("id", session.agent_id)
        .maybeSingle();

      if (!agent) return errorResponse("Agent not found", 404);

      const { data, error } = await supabase.rpc("get_agent_leaderboard_position", {
        p_agent_id: agent.id,
        p_agency: agent.agency || null,
      });

      if (error) throw error;
      return jsonResponse(data);
    }

    if (action === "agent-book-summary") {
      const authHeader = req.headers.get("X-Agent-Token") || "";
      if (!authHeader) return errorResponse("No session token", 401);

      const { data: session } = await supabase
        .from("agent_sessions")
        .select("agent_id, expires_at")
        .eq("token", authHeader)
        .maybeSingle();

      if (!session || new Date(session.expires_at) < new Date()) {
        return errorResponse("Session expired", 401);
      }

      const { data: agent } = await supabase
        .from("agents")
        .select("id, unl_writing_number, gtl_writing_number")
        .eq("id", session.agent_id)
        .maybeSingle();

      if (!agent) return errorResponse("Agent not found", 404);

      const page = parseInt(url.searchParams.get("page") || "1");
      const statusFilter = url.searchParams.get("status") || null;

      const { data, error } = await supabase.rpc("get_agent_book_summary", {
        p_unl_writing_number: agent.unl_writing_number || null,
        p_gtl_writing_number: agent.gtl_writing_number || null,
        p_status_filter: statusFilter,
        p_page: page,
        p_page_size: 20,
      });

      if (error) throw error;
      return jsonResponse(data);
    }


    if (action === "get-active-incentives") {
      const { data: promotions } = await supabase
        .from("leaderboard_promotions")
        .select("id, title, goal_tokens, incentive, start_date, end_date, period_type, sort_order")
        .eq("is_active", true)
        .gte("end_date", new Date().toISOString())
        .lte("start_date", new Date().toISOString())
        .order("period_type", { ascending: true })
        .order("sort_order", { ascending: true });

      const { data: tokenLeaders } = await supabase
        .from("agent_tokens")
        .select("agent_id, tokens_total")
        .order("tokens_total", { ascending: false })
        .limit(10);

      const { data: agentNames } = await supabase.from("agents").select("id, first_name, last_name");
      const nameMap: Record<string, string> = {};
      for (const a of agentNames || []) {
        nameMap[a.id] = `${a.first_name} ${a.last_name}`;
      }

      const standings = (tokenLeaders || []).slice(0, 3).map((t, i) => ({
        rank: i + 1,
        agentName: nameMap[t.agent_id] || "Unknown",
        tokens: t.tokens_total,
      }));

      return jsonResponse({ promotions: promotions || [], standings });
    }

    if (action === "agent-quality-snapshot") {
      const authHeader = req.headers.get("X-Agent-Token") || "";
      if (!authHeader) return errorResponse("No session token", 401);

      const { data: session } = await supabase
        .from("agent_sessions")
        .select("agent_id, expires_at")
        .eq("token", authHeader)
        .maybeSingle();

      if (!session || new Date(session.expires_at) < new Date()) {
        return errorResponse("Session expired", 401);
      }

      const { data: agent } = await supabase
        .from("agents")
        .select("id, unl_writing_number, gtl_writing_number")
        .eq("id", session.agent_id)
        .maybeSingle();

      if (!agent) return errorResponse("Agent not found", 404);

      const { data, error } = await supabase.rpc("get_agent_quality_snapshot", {
        p_unl_writing_number: agent.unl_writing_number || null,
        p_gtl_writing_number: agent.gtl_writing_number || null,
      });

      if (error) throw error;
      return jsonResponse(data);
    }

    if (action === "agent-get-goal") {
      const authHeader = req.headers.get("X-Agent-Token") || "";
      if (!authHeader) return errorResponse("No session token", 401);

      const { data: session } = await supabase
        .from("agent_sessions")
        .select("agent_id, expires_at")
        .eq("token", authHeader)
        .maybeSingle();

      if (!session || new Date(session.expires_at) < new Date()) {
        return errorResponse("Session expired", 401);
      }

      const { data: goal } = await supabase
        .from("wa_personal_goals")
        .select("monthly_ap_target, updated_at")
        .eq("agent_id", session.agent_id)
        .maybeSingle();

      return jsonResponse({ goal: goal || null });
    }

    if (action === "agent-save-goal") {
      const authHeader = req.headers.get("X-Agent-Token") || "";
      if (!authHeader) return errorResponse("No session token", 401);

      const { data: session } = await supabase
        .from("agent_sessions")
        .select("agent_id, expires_at")
        .eq("token", authHeader)
        .maybeSingle();

      if (!session || new Date(session.expires_at) < new Date()) {
        return errorResponse("Session expired", 401);
      }

      const body = await req.json();
      const target = parseFloat(body.monthly_ap_target);
      if (isNaN(target) || target < 0) {
        return errorResponse("Invalid monthly_ap_target", 400);
      }

      const { data, error } = await supabase
        .from("wa_personal_goals")
        .upsert({
          agent_id: session.agent_id,
          monthly_ap_target: target,
          updated_at: new Date().toISOString(),
        }, { onConflict: "agent_id" })
        .select()
        .maybeSingle();

      if (error) throw error;
      return jsonResponse({ goal: data });
    }

    if (action === "agent-update-attention-state") {
      const authHeader = req.headers.get("X-Agent-Token") || "";
      if (!authHeader) return errorResponse("No session token", 401);

      const { data: session } = await supabase
        .from("agent_sessions")
        .select("agent_id, expires_at")
        .eq("token", authHeader)
        .maybeSingle();

      if (!session || new Date(session.expires_at) < new Date()) {
        return errorResponse("Session expired", 401);
      }

      const body = await req.json();
      const { policyId, state } = body;
      if (!policyId || !["got_it", "working", "done"].includes(state)) {
        return errorResponse("policyId and valid state required", 400);
      }

      const { data, error } = await supabase
        .from("policy_attention_actions")
        .upsert({
          agent_id: session.agent_id,
          form_submission_id: policyId,
          state,
          updated_at: new Date().toISOString(),
        }, { onConflict: "agent_id,form_submission_id" })
        .select()
        .maybeSingle();

      if (error) throw error;
      return jsonResponse(data);
    }

    if (action === "agent-get-attention-states") {
      const authHeader = req.headers.get("X-Agent-Token") || "";
      if (!authHeader) return errorResponse("No session token", 401);

      const { data: session } = await supabase
        .from("agent_sessions")
        .select("agent_id, expires_at")
        .eq("token", authHeader)
        .maybeSingle();

      if (!session || new Date(session.expires_at) < new Date()) {
        return errorResponse("Session expired", 401);
      }

      const { data, error } = await supabase
        .from("policy_attention_actions")
        .select("form_submission_id, state, updated_at")
        .eq("agent_id", session.agent_id);

      if (error) throw error;
      return jsonResponse({ actions: data || [] });
    }

    if (action === "agent-onboarding-status") {
      const authHeader = req.headers.get("X-Agent-Token") || "";
      if (!authHeader) return errorResponse("No session token", 401);

      const { data: session } = await supabase
        .from("agent_sessions")
        .select("agent_id, expires_at")
        .eq("token", authHeader)
        .maybeSingle();

      if (!session || new Date(session.expires_at) < new Date()) {
        return errorResponse("Session expired", 401);
      }

      const { data: onboarding } = await supabase
        .from("agent_onboarding")
        .select("completed_at")
        .eq("agent_id", session.agent_id)
        .maybeSingle();

      return jsonResponse({
        completed: !!onboarding?.completed_at,
        completedAt: onboarding?.completed_at || null,
      });
    }

    if (action === "agent-complete-onboarding") {
      const authHeader = req.headers.get("X-Agent-Token") || "";
      if (!authHeader) return errorResponse("No session token", 401);

      const { data: session } = await supabase
        .from("agent_sessions")
        .select("agent_id, expires_at")
        .eq("token", authHeader)
        .maybeSingle();

      if (!session || new Date(session.expires_at) < new Date()) {
        return errorResponse("Session expired", 401);
      }

      const { error } = await supabase
        .from("agent_onboarding")
        .upsert({
          agent_id: session.agent_id,
          completed_at: new Date().toISOString(),
        }, { onConflict: "agent_id" });

      if (error) throw error;
      return jsonResponse({ success: true });
    }

    return errorResponse("Unknown action", 404);
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Internal server error",
      500
    );
  }
});
