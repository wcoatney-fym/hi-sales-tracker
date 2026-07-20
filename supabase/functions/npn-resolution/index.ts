import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// npn-resolution — scans npn_holds WHERE status = 'held', re-checks the live
// NPN map (agents + agency_rosters), flips resolved rows to status='resolved',
// and inserts them into proposed_fires for human review before GHL push.
//
// Design (from docs/migration-mockup/npn-gate.ts):
//   1. Load NPN map from agents + agency_rosters (same as lifecycle-direct)
//   2. Page through npn_holds WHERE status = 'held'
//   3. For each hold: check npnMap.get(writing_number)
//   4. Resolved (NPN found): update npn_holds.status = 'resolved', set released_at
//   5. Insert into proposed_fires (ON CONFLICT DO NOTHING — safe to re-run)
//   6. Return counts: scanned, resolved, proposed, still_held
//
// Trigger: cron (daily, after lifecycle-direct) or manual POST.
// Auth: CONFIRMATION_TOKEN header (same as lifecycle-direct).
// Best-effort: individual row failures don't crash the run.

const CONFIRMATION_TOKEN = Deno.env.get("ACTIVITY_TRACKER_SECRET_KEY") ?? "";

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

  const url    = new URL(req.url);
  const dry    = url.searchParams.get("dry") === "true";
  const writingNumberFilter = url.searchParams.get("writing_number")?.trim().toUpperCase() ?? null;

  // ── Supabase client ───────────────────────────────────────────────────────
  const supabase = createClient(
    Deno.env.get("ACTIVITY_TRACKER_SUPABASE_URL")!,
    Deno.env.get("ACTIVITY_TRACKER_SERVICE_ROLE_KEY")!,
  );

  // ── 1. Build NPN map (agents primary, agency_rosters fallback) ────────────
  const npnMap = new Map<string, string>(); // writing_number → npn
  {
    const AN = 1000; let anOff = 0;
    while (true) {
      const { data: ar, error: arErr } = await supabase
        .from("agents")
        .select("unl_writing_number, npn")
        .not("npn", "is", null)
        .neq("npn", "")
        .range(anOff, anOff + AN - 1);
      if (arErr) { console.error(`[npn-resolution] agents read failed: ${arErr.message}`); break; }
      for (const a of ar ?? []) {
        const wn = ((a.unl_writing_number as string) ?? "").trim().toUpperCase();
        if (wn && a.npn) npnMap.set(wn, a.npn as string);
      }
      if (!ar || ar.length < AN) break;
      anOff += AN;
    }
    const { data: rr } = await supabase
      .from("agency_rosters")
      .select("writing_number, npn")
      .eq("status", "active")
      .not("npn", "is", null)
      .neq("npn", "");
    for (const r of rr ?? []) {
      const wn = ((r.writing_number as string) ?? "").trim().toUpperCase();
      if (wn && r.npn && !npnMap.has(wn)) npnMap.set(wn, r.npn as string);
    }
  }
  console.log(`[npn-resolution] NPN map loaded: ${npnMap.size} entries`);

  // ── 2. Page through npn_holds WHERE status = 'held' ──────────────────────
  const PAGE = 1000;
  let offset = 0;
  let scanned = 0;
  let resolved = 0;
  let proposed = 0;
  let stillHeld = 0;

  while (true) {
    let q = supabase
      .from("npn_holds")
      .select("id, policy_nbr, trigger_type, changed_on, agency_id, agent_name, writing_number")
      .eq("status", "held")
      .range(offset, offset + PAGE - 1);
    if (writingNumberFilter) {
      q = q.eq("writing_number", writingNumberFilter);
    }
    const { data: holds, error: fetchErr } = await q;
    if (fetchErr) {
      console.error(`[npn-resolution] npn_holds page failed: ${fetchErr.message}`);
      break;
    }
    if (!holds || holds.length === 0) break;
    scanned += holds.length;

    // Partition: resolved (NPN now found) vs still held
    const toResolve: typeof holds = [];
    for (const h of holds) {
      const wn  = ((h.writing_number as string) ?? "").trim().toUpperCase();
      const npn = npnMap.get(wn) ?? "";
      if (npn) {
        toResolve.push(h);
      } else {
        stillHeld++;
      }
    }

    if (toResolve.length > 0 && !dry) {
      const now = new Date().toISOString();
      const resolveIds = toResolve.map((h) => h.id as number);

      // Flip to resolved
      const { error: upErr } = await supabase
        .from("npn_holds")
        .update({ status: "resolved", released_at: now })
        .in("id", resolveIds);
      if (upErr) {
        console.error(`[npn-resolution] npn_holds update failed: ${upErr.message}`);
      } else {
        resolved += toResolve.length;
      }

      // Insert proposed_fires (ON CONFLICT DO NOTHING — safe to re-run)
      const proposals = toResolve.map((h) => ({
        npn_hold_id:    h.id as number,
        policy_nbr:     h.policy_nbr as string,
        trigger_type:   h.trigger_type as string,
        changed_on:     h.changed_on as string,
        agency_id:      (h.agency_id as string) ?? null,
        agent_npn:      npnMap.get(((h.writing_number as string) ?? "").trim().toUpperCase()) ?? "",
        writing_number: ((h.writing_number as string) ?? "").trim().toUpperCase(),
      }));
      const { error: propErr } = await supabase
        .from("proposed_fires")
        .upsert(proposals, { onConflict: "policy_nbr,trigger_type,changed_on", ignoreDuplicates: true });
      if (propErr) {
        console.error(`[npn-resolution] proposed_fires write failed: ${propErr.message}`);
      } else {
        proposed += proposals.length;
      }
    } else if (toResolve.length > 0 && dry) {
      console.log(`[npn-resolution:dry-run] would resolve ${toResolve.length} holds and propose ${toResolve.length} fires`);
      resolved += toResolve.length;
      proposed += toResolve.length;
    }

    if (holds.length < PAGE) break;
    offset += PAGE;
  }

  console.log(`[npn-resolution] done — scanned=${scanned} resolved=${resolved} proposed=${proposed} still_held=${stillHeld} dry=${dry}`);

  return new Response(
    JSON.stringify({ ok: true, dry, scanned, resolved, proposed, still_held: stillHeld }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
