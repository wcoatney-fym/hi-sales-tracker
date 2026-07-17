/**
 * npn-gate.ts — NPN gate module (migration mockup)
 * Sits in front of every GHL payload fire.
 * NOT deployed — mockup spec only.
 *
 * =============================================================================
 * CODEBASE VERIFICATION (2026-07-17, lifecycle-direct/index.ts L401–763)
 * =============================================================================
 *
 * Lookup order (mirrors live code exactly):
 *   1. agents table        → agents.unl_writing_number (UPPER trim) → agents.npn
 *   2. agency_rosters table → agency_rosters.writing_number (UPPER trim) → agency_rosters.npn
 *      filter: status = 'active', npn IS NOT NULL, npn != ''
 *
 * Input key: wa from typed.unl_fym_policy_latest_load (UNL writing number)
 *   Normalized: (wa ?? '').trim().toUpperCase()
 *
 * NPN present = non-null, non-empty string from either source.
 * Name-based lookup is NOT used — writing number is the sole join key.
 *
 * NPN coverage today:
 *   Full coverage: FYM-direct, DH Insurance
 *   Partial/none:  all other agencies (~95 of 97)
 *   High hold volumes for non-FYM/DH agencies = correct behavior, not a bug.
 * =============================================================================
 */

import { SupabaseClient } from "jsr:@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TriggerRow {
  policy_nbr: string;
  trigger_type: "approved" | "terminated" | "submission" | "at_risk";
  changed_on: string;          // ISO date string
  agency_id: string | null;
  agency_name: string | null;  // ga_name from Max's DB
  agent_name: string | null;   // wa_name from Max's DB
  writing_number: string;      // wa from Max's DB, will be normalized
}

export interface GateResult {
  passed: TriggerRow[];        // NPN found — attach npn and proceed to GHL push
  held: HeldRow[];             // NPN missing — write to npn_holds, do not push
}

export interface HeldRow extends TriggerRow {
  normalizedWn: string;
}

export interface PassedRow extends TriggerRow {
  normalizedWn: string;
  npn: string;
}

// ---------------------------------------------------------------------------
// NPN lookup — mirrors lifecycle-direct/index.ts NPN map construction
// ---------------------------------------------------------------------------

/**
 * Build a writing-number → NPN map from Supabase.
 * Primary:  agents.unl_writing_number → agents.npn
 * Fallback: agency_rosters.writing_number → agency_rosters.npn
 *
 * Keys are normalized UPPER-trim strings.
 * Agents table wins if both sources have a value for the same writing number.
 */
export async function buildNpnMap(
  supabase: SupabaseClient,
): Promise<Map<string, string>> {
  const npnMap = new Map<string, string>();

  // Primary: agents table
  const { data: agentRows } = await supabase
    .from("agents")
    .select("unl_writing_number, npn")
    .not("npn", "is", null)
    .neq("npn", "");

  for (const a of agentRows ?? []) {
    const wn = ((a.unl_writing_number as string) ?? "").trim().toUpperCase();
    if (wn && a.npn) npnMap.set(wn, a.npn as string);
  }

  // Fallback: agency_rosters table
  const { data: rosterRows } = await supabase
    .from("agency_rosters")
    .select("writing_number, npn")
    .eq("status", "active")
    .not("npn", "is", null)
    .neq("npn", "");

  for (const r of rosterRows ?? []) {
    const wn = ((r.writing_number as string) ?? "").trim().toUpperCase();
    if (wn && r.npn && !npnMap.has(wn)) {
      npnMap.set(wn, r.npn as string);
    }
  }

  return npnMap;
}

// ---------------------------------------------------------------------------
// Gate function
// ---------------------------------------------------------------------------

/**
 * Run every trigger row through the NPN gate.
 * Returns passed rows (with npn attached) and held rows (NPN missing).
 *
 * HALT rule: no NPN = no API push, ever, no exceptions.
 * Held rows are written to npn_holds by the caller (not here — keeps this pure).
 */
export function applyNpnGate(
  rows: TriggerRow[],
  npnMap: Map<string, string>,
): { passed: PassedRow[]; held: HeldRow[] } {
  const passed: PassedRow[] = [];
  const held: HeldRow[] = [];

  for (const row of rows) {
    const normalizedWn = (row.writing_number ?? "").trim().toUpperCase();
    const npn = normalizedWn ? npnMap.get(normalizedWn) : undefined;

    if (npn) {
      passed.push({ ...row, normalizedWn, npn });
    } else {
      held.push({ ...row, normalizedWn });
    }
  }

  return { passed, held };
}

// ---------------------------------------------------------------------------
// Persistence — write holds and proposed_fires
// ---------------------------------------------------------------------------

/**
 * Write held rows to npn_holds.
 * Uses ON CONFLICT DO NOTHING — safe to call on retry; won't double-insert.
 */
export async function writeHolds(
  supabase: SupabaseClient,
  heldRows: HeldRow[],
): Promise<void> {
  if (heldRows.length === 0) return;

  const inserts = heldRows.map((r) => ({
    policy_nbr:     r.policy_nbr,
    trigger_type:   r.trigger_type,
    changed_on:     r.changed_on,
    agency_id:      r.agency_id,
    agency_name:    r.agency_name,
    agent_name:     r.agent_name,
    writing_number: r.normalizedWn,
    status:         "held",
  }));

  const { error } = await supabase
    .from("npn_holds")
    .upsert(inserts, { onConflict: "policy_nbr,trigger_type,changed_on", ignoreDuplicates: true });

  if (error) throw new Error(`npn_holds write failed: ${error.message}`);
}

/**
 * Resolution flow — called when a new NPN appears on the roster for a writing number.
 *
 * 1. Find all held rows for this writing_number.
 * 2. Flip status → 'resolved', set released_at.
 * 3. Insert into proposed_fires with the NPN attached.
 * 4. DO NOT fire GHL. proposed_fires requires human approval (approved_at).
 *
 * NOTE: auto-fire-on-resolve is the intended end state.
 *       The approved_at gate is explicitly present for the mockup phase only.
 *       At go-live: remove the proposed_fires hop and push directly.
 */
export async function resolveHoldsForWritingNumber(
  supabase: SupabaseClient,
  writingNumber: string,
  npn: string,
): Promise<{ resolved: number; proposed: number }> {
  const normalizedWn = writingNumber.trim().toUpperCase();

  // Find all held rows for this writing number
  const { data: holds, error: fetchErr } = await supabase
    .from("npn_holds")
    .select("id, policy_nbr, trigger_type, changed_on, agency_id")
    .eq("writing_number", normalizedWn)
    .eq("status", "held");

  if (fetchErr) throw new Error(`npn_holds fetch failed: ${fetchErr.message}`);
  if (!holds || holds.length === 0) return { resolved: 0, proposed: 0 };

  const now = new Date().toISOString();
  const holdIds = holds.map((h) => h.id as number);

  // Flip holds to resolved
  const { error: updateErr } = await supabase
    .from("npn_holds")
    .update({ status: "resolved", released_at: now })
    .in("id", holdIds);

  if (updateErr) throw new Error(`npn_holds update failed: ${updateErr.message}`);

  // Insert into proposed_fires — no auto-fire, approved_at required
  const proposals = holds.map((h) => ({
    npn_hold_id:    h.id,
    policy_nbr:     h.policy_nbr as string,
    trigger_type:   h.trigger_type as string,
    changed_on:     h.changed_on as string,
    agency_id:      h.agency_id as string | null,
    agent_npn:      npn,
    writing_number: normalizedWn,
  }));

  const { error: propErr } = await supabase
    .from("proposed_fires")
    .upsert(proposals, { onConflict: "policy_nbr,trigger_type,changed_on", ignoreDuplicates: true });

  if (propErr) throw new Error(`proposed_fires write failed: ${propErr.message}`);

  return { resolved: holds.length, proposed: proposals.length };
}

// ---------------------------------------------------------------------------
// Alerting — DRY-RUN ONLY in mockup phase
// Generates alert content and logs it. Sends nothing.
// See: docs/migration-mockup/templates/npn-hold-alert-agency-admin.md
//      for the agency-admin template (client-facing, human-gated until go-live).
// ---------------------------------------------------------------------------

export interface HoldSummary {
  agencyName: string;
  agencyId: string | null;
  agentName: string;
  writingNumber: string;
  heldCount: number;
  triggerTypes: string[];
}

/**
 * Aggregate held rows into per-agent summaries for alerting.
 */
export function summarizeHolds(heldRows: HeldRow[]): HoldSummary[] {
  const map = new Map<string, HoldSummary>();

  for (const r of heldRows) {
    const key = `${r.normalizedWn}::${r.agency_id ?? ""}`;
    const existing = map.get(key);
    if (existing) {
      existing.heldCount++;
      if (!existing.triggerTypes.includes(r.trigger_type)) {
        existing.triggerTypes.push(r.trigger_type);
      }
    } else {
      map.set(key, {
        agencyName:    r.agency_name ?? "Unknown Agency",
        agencyId:      r.agency_id,
        agentName:     r.agent_name ?? "Unknown Agent",
        writingNumber: r.normalizedWn,
        heldCount:     1,
        triggerTypes:  [r.trigger_type],
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => b.heldCount - a.heldCount);
}

/**
 * DRY-RUN alert — FYM admin.
 * Logs the alert content only. Sends nothing.
 * Real send path: Slack/Resend, human-gated.
 */
export function dryRunFymAdminAlert(summaries: HoldSummary[]): void {
  const totalHeld = summaries.reduce((n, s) => n + s.heldCount, 0);

  const lines = [
    `[DRY-RUN] NPN Hold Alert — FYM Admin`,
    `Total held rows: ${totalHeld}`,
    `Affected agents: ${summaries.length}`,
    ``,
    ...summaries.map(
      (s) =>
        `  Agency: ${s.agencyName} | Agent: ${s.agentName} (${s.writingNumber}) | Held: ${s.heldCount} | Triggers: ${s.triggerTypes.join(", ")}`,
    ),
  ];

  console.log(lines.join("\n"));
}

/**
 * DRY-RUN alert — agency admin.
 * Logs the alert content only. Sends nothing.
 *
 * ⚠️  AGENCY-ADMIN SENDS ARE CLIENT-FACING AND HUMAN-GATED.
 * Do NOT enable send path without explicit go-live approval.
 * See template: docs/migration-mockup/templates/npn-hold-alert-agency-admin.md
 */
export function dryRunAgencyAdminAlert(summary: HoldSummary): void {
  const body = buildAgencyAdminAlertBody(summary);
  console.log(`[DRY-RUN] Agency Admin Alert (NOT SENT — client-facing, human-gated):`);
  console.log(body);
}

/**
 * Builds the agency-admin alert body.
 * Extracted so it can be tested and templated independently of send logic.
 */
export function buildAgencyAdminAlertBody(summary: HoldSummary): string {
  return [
    `Subject: Action needed — agent NPN missing for ${summary.agentName}`,
    ``,
    `Hi ${summary.agencyName} team,`,
    ``,
    `We're holding ${summary.heldCount} policy notification(s) for agent ${summary.agentName} (writing number: ${summary.writingNumber}) because their National Producer Number (NPN) is not on file.`,
    ``,
    `To release these notifications, please add the NPN for ${summary.agentName} to your agency roster.`,
    ``,
    `Affected trigger types: ${summary.triggerTypes.join(", ")}`,
    ``,
    `Once added, the held notifications will be reviewed and released by the FYM team.`,
  ].join("\n");
}
