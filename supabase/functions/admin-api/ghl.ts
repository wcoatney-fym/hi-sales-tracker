// Outbound stage sync: tracker -> GHL.
//
// When a policy's stage changes here, mirror it into the matching GHL pipeline
// stage so GHL automations fire. One-way push from this side; the inbound
// direction (GHL -> tracker) lives in the ghl-webhook function.
//
// DORMANT BY DEFAULT: if the GHL env/config isn't present, every call is a safe
// no-op, so this can ship and sit inert until Chris hands over the pipeline.
//
// Go-live config (Supabase function secrets / env):
//   GHL_API_KEY        - Private Integration token (Bearer)
//   GHL_API_BASE       - optional, defaults to https://services.leadconnectorhq.com
//   GHL_PIPELINE_ID    - the mirrored at-risk pipeline id
//   GHL_STAGE_MAP      - JSON: { "<our_stage>": "<ghl_stage_id>", ... }
//
// NOTE: the exact GHL opportunity-stage update endpoint/shape is pending
// confirmation from Chris (LeadConnector v2). The request is isolated in
// pushOpportunityStage() so it's a one-spot change once confirmed.

interface GhlConfig {
  apiKey: string;
  apiBase: string;
  pipelineId: string;
  stageMap: Record<string, string>;
}

function loadGhlConfig(): GhlConfig | null {
  const apiKey = Deno.env.get("GHL_API_KEY");
  const pipelineId = Deno.env.get("GHL_PIPELINE_ID");
  const rawMap = Deno.env.get("GHL_STAGE_MAP");
  if (!apiKey || !pipelineId || !rawMap) return null; // dormant
  let stageMap: Record<string, string>;
  try {
    stageMap = JSON.parse(rawMap);
  } catch {
    return null;
  }
  return {
    apiKey,
    apiBase: Deno.env.get("GHL_API_BASE") || "https://services.leadconnectorhq.com",
    pipelineId,
    stageMap,
  };
}

// Best-effort push of a single opportunity's stage. Returns true on success.
// Pending Chris's confirmation of the exact endpoint; isolated here on purpose.
async function pushOpportunityStage(
  cfg: GhlConfig,
  ghlContactId: string,
  ghlStageId: string
): Promise<boolean> {
  try {
    // TODO(GHL): confirm endpoint/payload with Chris. Placeholder uses the
    // LeadConnector v2 opportunities update shape.
    const res = await fetch(`${cfg.apiBase}/opportunities/${ghlContactId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
        Version: "2021-07-28",
      },
      body: JSON.stringify({ pipelineId: cfg.pipelineId, pipelineStageId: ghlStageId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Public entry point. Call after a tracker-originated stage change.
// `origin` guards the loop: GHL-originated changes are never pushed back.
// deno-lint-ignore no-explicit-any
export async function syncStageToGhl(
  supabase: any,
  policyId: string,
  stage: string,
  origin: "tracker" | "ghl"
): Promise<void> {
  if (origin === "ghl") return; // loop kill: came from GHL, don't echo back
  const cfg = loadGhlConfig();
  if (!cfg) return; // dormant until configured

  const ghlStageId = cfg.stageMap[stage];
  if (!ghlStageId) return; // stage not mapped (e.g. 'new')

  const { data: disp } = await supabase
    .from("policy_dispositions")
    .select("ghl_contact_id, ghl_synced_stage")
    .eq("policy_id", policyId)
    .maybeSingle();

  const contactId = disp?.ghl_contact_id;
  if (!contactId) return; // no linked GHL opportunity yet
  if (disp?.ghl_synced_stage === stage) return; // idempotent: GHL already there

  const ok = await pushOpportunityStage(cfg, contactId, ghlStageId);
  if (ok) {
    await supabase
      .from("policy_dispositions")
      .update({ ghl_synced_stage: stage, ghl_synced_at: new Date().toISOString() })
      .eq("policy_id", policyId);
  }
}
