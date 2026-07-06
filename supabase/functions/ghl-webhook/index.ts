import { createClient } from "npm:@supabase/supabase-js@2";

/*
  GHL -> tracker webhook (inbound half of the bidirectional sync).

  The at-risk pipeline is mirrored 1:1 in GHL. GHL posts here when something
  happens on its side that this system can't otherwise know:
    - a client replies with a keyword (SAVE -> responded, STOP -> manager_outreach)
    - a human MANUALLY moves/adds a contact in the GHL pipeline

  We update the policy's stage here. The tracker remains source of truth; these
  guardrails keep two-way sync sane:
    - LOOP KILL: the write is tagged sync_origin='ghl', so the outbound pusher
      (admin-api/ghl.ts) never echoes it straight back to GHL.
    - IDEMPOTENT: no-op when the stage already matches.
    - SAVED GATE: a manual GHL move to 'saved' lands as 'agent_saved_pending'
      so a manager still confirms it (SAVED_FROM_GHL_REQUIRES_APPROVAL). Flip to
      false to trust GHL's 'saved' directly. (Pending Charlie's a/b.)

  Canonical shared stages (match the GHL pipeline stage names/ids):
    new | responded | manager_outreach | agent_outreach |
    code_red | agent_saved_pending | saved | lost

  Auth: x-api-key header must match GHL_WEBHOOK_KEY (Supabase function secret).
*/

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey, x-api-key",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// a/b toggle (default b): manual GHL "saved" still needs manager approval here.
const SAVED_FROM_GHL_REQUIRES_APPROVAL = true;

const KEYWORD_STAGE: Record<string, string> = {
  SAVE: "responded",
  YES: "responded",
  HELP: "responded",
  STOP: "manager_outreach",
  CANCEL: "manager_outreach",
};

const CANONICAL_STAGES = new Set([
  "new",
  "responded",
  "manager_outreach",
  "agent_outreach",
  // Code Red is owned by GHL (day-35 timer + exemptions run there and post the
  // move here); mirrored into the tracker pipeline right before Pending.
  "code_red",
  "agent_saved_pending",
  "saved",
  "lost",
]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  try {
    const apiKey = req.headers.get("x-api-key");
    const expectedKey = Deno.env.get("GHL_WEBHOOK_KEY");
    if (!expectedKey || apiKey !== expectedKey) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const body = await req.json();
    const policyNumber = (body.policy_number || "").toString().trim();
    const phone = (body.phone || "").toString().trim();
    const email = (body.email || "").toString().trim().toLowerCase();
    const ghlContactId = (body.ghl_contact_id || body.contact_id || "").toString().trim();
    const keyword = (body.keyword || "").toString().trim().toUpperCase();
    const rawStage = (body.stage || "").toString().trim().toLowerCase();
    const note = (body.note || "").toString().slice(0, 280);

    let stage = rawStage || (keyword ? KEYWORD_STAGE[keyword] : "");
    if (!stage) {
      return jsonResponse({ error: "Provide a known keyword or stage" }, 400);
    }
    if (!CANONICAL_STAGES.has(stage)) {
      return jsonResponse({ error: `Unknown stage '${stage}'` }, 422);
    }
    // Saved gate: a manual GHL save still routes through manager approval here.
    if (stage === "saved" && SAVED_FROM_GHL_REQUIRES_APPROVAL) {
      stage = "agent_saved_pending";
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Identify the policy: policy_number (exact) > current at-risk by phone/email.
    let policy: { id: string; agency_id: string | null } | null = null;
    if (policyNumber) {
      const { data } = await supabase
        .from("form_submissions")
        .select("id, agency_id")
        .eq("policy_number", policyNumber)
        .maybeSingle();
      policy = data ?? null;
    } else if (phone || email) {
      const today = new Date().toISOString().slice(0, 10);
      let q = supabase
        .from("form_submissions")
        .select("id, agency_id, paid_to_date")
        .eq("status", "active")
        .eq("billing_form", "DIR")
        .lt("paid_to_date", today)
        .order("paid_to_date", { ascending: true })
        .limit(1);
      q = phone ? q.eq("phone", phone) : q.eq("email", email);
      const { data } = await q;
      policy = (data && data[0]) || null;
    } else {
      return jsonResponse({ error: "Provide policy_number, phone, or email" }, 400);
    }

    if (!policy) return jsonResponse({ error: "No matching policy found" }, 404);
    if (!policy.agency_id) return jsonResponse({ error: "Policy has no agency_id" }, 409);

    // Idempotency: skip if the stage already matches.
    const { data: existing } = await supabase
      .from("policy_dispositions")
      .select("disposition, ghl_contact_id")
      .eq("policy_id", policy.id)
      .maybeSingle();
    if (existing?.disposition === stage && (!ghlContactId || existing?.ghl_contact_id === ghlContactId)) {
      return jsonResponse({ ok: true, policy_id: policy.id, stage, unchanged: true });
    }

    const { error: upErr } = await supabase
      .from("policy_dispositions")
      .upsert(
        {
          policy_id: policy.id,
          agency_id: policy.agency_id,
          disposition: stage,
          note: note || `GHL: ${keyword || rawStage}`,
          sync_origin: "ghl", // loop kill: do not echo back to GHL
          ...(ghlContactId ? { ghl_contact_id: ghlContactId } : {}),
          set_at: new Date().toISOString(),
        },
        { onConflict: "policy_id" }
      );
    if (upErr) throw upErr;

    return jsonResponse({ ok: true, policy_id: policy.id, stage });
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Internal server error" },
      500
    );
  }
});
