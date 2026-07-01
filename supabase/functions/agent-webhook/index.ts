import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey, x-api-key",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function notEmpty(val: string | undefined | null): boolean {
  return typeof val === "string" && val.trim().length > 0;
}

function toProperCase(s: string): string {
  return s.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// Best-effort flag for a same-carrier writing-number conflict. Never throws so
// it can't break the roster sync. The newest number stays active; the old one
// is surfaced as an open audit issue for review.
// deno-lint-ignore no-explicit-any
async function flagWritingNumberConflict(supabase: any, params: {
  agentId: string; agencyId: string; name: string; carrier: string;
  oldNumber: string; newNumber: string;
}) {
  try {
    await supabase.from("audit_issues").insert({
      issue_type: "duplicate_writing_number",
      severity: "warning",
      title: `Duplicate ${params.carrier} writing number for ${params.name}`,
      description: `Two ${params.carrier} writing numbers were received for this agent. The newest (${params.newNumber}) is active in the roster; the previous (${params.oldNumber}) was replaced. Review which is correct.`,
      entity_ids: [params.agentId],
      metadata: {
        agency_id: params.agencyId,
        carrier: params.carrier,
        old_writing_number: params.oldNumber,
        new_writing_number: params.newNumber,
        source: "agent-webhook",
      },
      status: "open",
    });
  } catch (_e) {
    // flagging is advisory; ignore failures
  }
}

// Create/refresh the agent's confirmed roster membership as a SINGLE record per
// agent+agency (agency_rosters). Additional carriers live in
// agent_writing_numbers, so a two-carrier agent (UNL+GTL) has ONE roster record,
// not two. Rules (per product decision 2026-07-01):
//  - Contracting-portal writing numbers are authoritative live roster maintenance.
//  - One record per agent even across carriers.
//  - Only a SAME-carrier duplicate (two numbers for one carrier) is flagged; the
//    newest number stays active, the old one is flagged for review.
// deno-lint-ignore no-explicit-any
async function syncAgencyRoster(supabase: any, params: {
  agencyId: string; agencyName: string; agentId: string;
  firstName: string; lastName: string; npn: string;
  unlWritingNumber: string; gtlWritingNumber: string;
}): Promise<boolean> {
  const carriers: Array<[string, string]> = [];
  if (notEmpty(params.unlWritingNumber)) carriers.push(["UNL", params.unlWritingNumber.trim().toUpperCase()]);
  if (notEmpty(params.gtlWritingNumber)) carriers.push(["GTL", params.gtlWritingNumber.trim().toUpperCase()]);
  if (carriers.length === 0) return false;

  const name = `${toProperCase(params.firstName.trim())} ${toProperCase(params.lastName.trim())}`.trim();
  const baseFields = {
    agent_first_name: toProperCase(params.firstName.trim()),
    agent_last_name: toProperCase(params.lastName.trim()),
    npn: (params.npn || "").trim(),
    match_status: "confirmed",
    matched_agent_id: params.agentId,
    status: "active",
    terminated_at: null,
    updated_at: new Date().toISOString(),
  };

  // Single-record model: find the agent's existing active roster row (oldest wins
  // as the canonical record), or create one from the first incoming carrier.
  const { data: existingRosters } = await supabase
    .from("agency_rosters")
    .select("id, carrier, writing_number")
    .eq("agency_id", params.agencyId)
    .eq("matched_agent_id", params.agentId)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  let primary: { id: string; carrier: string; writing_number: string } | null =
    (existingRosters && existingRosters[0]) || null;

  if (!primary) {
    const [pc, pn] = carriers[0];
    const { data: created } = await supabase
      .from("agency_rosters")
      .insert({ agency_id: params.agencyId, carrier: pc, writing_number: pn, ...baseFields })
      .select("id, carrier, writing_number")
      .single();
    primary = created;
  } else {
    await supabase.from("agency_rosters").update(baseFields).eq("id", primary.id);
  }
  if (!primary) return false;

  for (const [carrier, number] of carriers) {
    if (carrier === primary.carrier) {
      if (primary.writing_number !== number) {
        await flagWritingNumberConflict(supabase, { agentId: params.agentId, agencyId: params.agencyId, name, carrier, oldNumber: primary.writing_number, newNumber: number });
        await supabase.from("agency_rosters").update({ writing_number: number, updated_at: new Date().toISOString() }).eq("id", primary.id);
        primary.writing_number = number;
      }
    } else {
      // Secondary carrier -> agent_writing_numbers (keeps one roster record).
      const { data: awnRows } = await supabase
        .from("agent_writing_numbers")
        .select("id, writing_number")
        .eq("agent_id", params.agentId)
        .eq("agency_id", params.agencyId)
        .eq("carrier_name", carrier);
      const existingAwn = awnRows && awnRows[0];
      if (!existingAwn) {
        await supabase.from("agent_writing_numbers").insert({ agent_id: params.agentId, agency_id: params.agencyId, carrier_name: carrier, writing_number: number });
      } else if (existingAwn.writing_number !== number) {
        await flagWritingNumberConflict(supabase, { agentId: params.agentId, agencyId: params.agencyId, name, carrier, oldNumber: existingAwn.writing_number, newNumber: number });
        await supabase.from("agent_writing_numbers").update({ writing_number: number }).eq("id", existingAwn.id);
      }
    }
  }

  await supabase
    .from("agents")
    .update({ agency_id: params.agencyId, agency: params.agencyName, agency_locked: true, updated_at: new Date().toISOString() })
    .eq("id", params.agentId);

  return true;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const apiKey = req.headers.get("x-api-key");
    const expectedKey = Deno.env.get("AGENT_WEBHOOK_KEY");

    if (!expectedKey || apiKey !== expectedKey) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const body = await req.json();
    const firstName = (body.first_name || "").trim();
    const lastName = (body.last_name || "").trim();
    const npn = (body.agent_npn || "").trim();
    const unlWritingNumber = (body.unl_writing_number || "").trim();
    const gtlWritingNumber = (body.gtl_writing_number || "").trim();
    const agencyName = (body.agency || "").trim();

    if (!firstName || !lastName) {
      return jsonResponse({ error: "first_name and last_name are required" }, 400);
    }

    if (!notEmpty(npn) && !notEmpty(unlWritingNumber) && !notEmpty(gtlWritingNumber)) {
      return jsonResponse(
        { error: "At least one identifier is required (agent_npn, unl_writing_number, or gtl_writing_number)" },
        400
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Resolve the agency (by name or slug, case-insensitive) so the agent can be
    // linked to it in the HIP portal directory. Without this the agent lands
    // unassigned and never shows under its agency.
    let agencyId: string | null = null;
    if (notEmpty(agencyName)) {
      const { data: agency } = await supabase
        .from("agencies")
        .select("id")
        .or(`name.ilike.${agencyName},slug.ilike.${agencyName}`)
        .maybeSingle();
      agencyId = agency?.id ?? null;
    }

    let existing: { id: string; first_name: string; last_name: string; npn: string; unl_writing_number: string; gtl_writing_number: string; agency_id: string | null; agency_locked: boolean } | null = null;

    if (notEmpty(npn)) {
      const { data } = await supabase
        .from("agents")
        .select("id, first_name, last_name, npn, unl_writing_number, gtl_writing_number, agency_id, agency_locked")
        .eq("npn", npn)
        .maybeSingle();
      existing = data;
    }

    if (!existing && notEmpty(unlWritingNumber)) {
      const { data } = await supabase
        .from("agents")
        .select("id, first_name, last_name, npn, unl_writing_number, gtl_writing_number, agency_id, agency_locked")
        .eq("unl_writing_number", unlWritingNumber)
        .maybeSingle();
      existing = data;
    }

    if (!existing && notEmpty(gtlWritingNumber)) {
      const { data } = await supabase
        .from("agents")
        .select("id, first_name, last_name, npn, unl_writing_number, gtl_writing_number, agency_id, agency_locked")
        .eq("gtl_writing_number", gtlWritingNumber)
        .maybeSingle();
      existing = data;
    }

    if (existing) {
      const updates: Record<string, string> = { updated_at: new Date().toISOString() };

      if (notEmpty(npn) && !notEmpty(existing.npn)) updates.npn = npn;
      if (notEmpty(unlWritingNumber) && !notEmpty(existing.unl_writing_number)) updates.unl_writing_number = unlWritingNumber;
      if (notEmpty(gtlWritingNumber) && !notEmpty(existing.gtl_writing_number)) updates.gtl_writing_number = gtlWritingNumber;
      if (notEmpty(firstName) && !notEmpty(existing.first_name)) updates.first_name = firstName;
      if (notEmpty(lastName) && !notEmpty(existing.last_name)) updates.last_name = lastName;

      // Backfill the agency link when it resolved and the row isn't locked or
      // already linked. Never override a locked or existing agency assignment.
      if (agencyId && !existing.agency_id && !existing.agency_locked) {
        updates.agency_id = agencyId;
        updates.agency = agencyName;
      }

      const { error } = await supabase
        .from("agents")
        .update(updates)
        .eq("id", existing.id);

      if (error) throw error;

      let rosterSynced = false;
      if (agencyId) {
        rosterSynced = await syncAgencyRoster(supabase, {
          agencyId, agencyName, agentId: existing.id,
          firstName: notEmpty(existing.first_name) ? existing.first_name : firstName,
          lastName: notEmpty(existing.last_name) ? existing.last_name : lastName,
          npn: notEmpty(npn) ? npn : existing.npn,
          unlWritingNumber, gtlWritingNumber,
        });
      }

      return jsonResponse({ success: true, action: "updated", agent_id: existing.id, roster_synced: rosterSynced });
    }

    const { data: inserted, error: insertError } = await supabase
      .from("agents")
      .insert({
        first_name: firstName,
        last_name: lastName,
        npn,
        unl_writing_number: unlWritingNumber,
        gtl_writing_number: gtlWritingNumber,
        agency: agencyId ? agencyName : null,
        agency_id: agencyId,
        source: "Contracting Portal",
      })
      .select("id")
      .single();

    if (insertError) throw insertError;

    let rosterSynced = false;
    if (agencyId) {
      rosterSynced = await syncAgencyRoster(supabase, {
        agencyId, agencyName, agentId: inserted.id,
        firstName, lastName, npn, unlWritingNumber, gtlWritingNumber,
      });
    }

    return jsonResponse({ success: true, action: "created", agent_id: inserted.id, roster_synced: rosterSynced });
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Internal server error" },
      500
    );
  }
});
