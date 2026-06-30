import { createClient } from "npm:@supabase/supabase-js@2";

/*
  GHL → tracker webhook for the at-risk pipeline.

  The at-risk pipeline is mirrored as a GHL pipeline with the SAME stage
  vocabulary, so automations can run throughout the process. GHL posts here when
  a client replies with a keyword or when a GHL automation advances an
  opportunity stage; we update the policy's disposition so the manager board and
  GHL stay in lockstep.

  Canonical shared stages (must match the GHL pipeline stage names/ids):
    new | responded | manager_outreach | agent_outreach |
    agent_saved_pending | saved | lost

  GHL is allowed to SET only a safe subset. Manager-gated outcomes are not
  GHL-settable:
    - `saved` requires manager approval (mgr-approve-save) — never set by GHL.
    - `agent_saved_pending` is set by the agent app.
    - `agent_outreach` (warm handoff) is a manager action that notifies the
      agent + starts the SLA — kept a manual action, not a raw GHL stage write.
  GHL-settable: responded, manager_outreach, lost.

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

// keyword → canonical stage
const KEYWORD_STAGE: Record<string, string> = {
  SAVE: "responded",
  YES: "responded",
  HELP: "responded",
  STOP: "manager_outreach",
  CANCEL: "manager_outreach",
};

// Stages GHL is permitted to set directly (see header note).
const GHL_SETTABLE = new Set(["responded", "manager_outreach", "lost"]);

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
    const keyword = (body.keyword || "").toString().trim().toUpperCase();
    const rawStage = (body.stage || "").toString().trim().toLowerCase();
    const note = (body.note || "").toString().slice(0, 280);

    // Resolve the target stage: explicit stage wins, else map the keyword.
    const stage = rawStage || (keyword ? KEYWORD_STAGE[keyword] : "");
    if (!stage) {
      return jsonResponse({ error: "Provide a known keyword or stage" }, 400);
    }
    if (!GHL_SETTABLE.has(stage)) {
      return jsonResponse(
        { error: `Stage '${stage}' is not GHL-settable (manager/agent-gated)` },
        422
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Identify the policy. Prefer policy_number (exact). Otherwise match the
    // contact's currently at-risk policy (active + DIR + past due).
    let policy:
      | { id: string; agency_id: string | null; status: string; billing_form: string | null }
      | null = null;

    if (policyNumber) {
      const { data } = await supabase
        .from("form_submissions")
        .select("id, agency_id, status, billing_form")
        .eq("policy_number", policyNumber)
        .maybeSingle();
      policy = data ?? null;
    } else if (phone || email) {
      const today = new Date().toISOString().slice(0, 10);
      let q = supabase
        .from("form_submissions")
        .select("id, agency_id, status, billing_form, paid_to_date")
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

    if (!policy) {
      return jsonResponse({ error: "No matching policy found" }, 404);
    }
    if (!policy.agency_id) {
      return jsonResponse({ error: "Policy has no agency_id; cannot route" }, 409);
    }

    const { error: upErr } = await supabase
      .from("policy_dispositions")
      .upsert(
        {
          policy_id: policy.id,
          agency_id: policy.agency_id,
          disposition: stage,
          note: note || `GHL: ${keyword || stage}`,
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
