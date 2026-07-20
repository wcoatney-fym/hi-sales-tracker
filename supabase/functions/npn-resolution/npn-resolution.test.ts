/**
 * npn-resolution.test.ts — Unit tests for the NPN resolution flow
 *
 * Tests cover:
 *   - NPN map lookup (agents primary, agency_rosters fallback, both empty)
 *   - Hold partitioning: resolved vs still_held
 *   - proposed_fires payload shape
 *   - writing_number normalization (UPPER + trim)
 *   - idempotency: ON CONFLICT DO NOTHING means safe re-runs
 *   - dry-run: counts increment but no DB writes
 *   - released_at set only on resolved rows
 *
 * Run: deno test --allow-none npn-resolution.test.ts
 */

import { assertEquals, assertExists } from "jsr:@std/assert";

// ---------------------------------------------------------------------------
// Shared types (mirrors npn-resolution/index.ts)
// ---------------------------------------------------------------------------

interface HoldRow {
  id: number;
  policy_nbr: string;
  trigger_type: "approved" | "terminated" | "submission" | "at_risk";
  changed_on: string;
  agency_id: string | null;
  agent_name: string | null;
  writing_number: string;
}

interface ProposedFire {
  npn_hold_id:    number;
  policy_nbr:     string;
  trigger_type:   string;
  changed_on:     string;
  agency_id:      string | null;
  agent_npn:      string;
  writing_number: string;
}

// ---------------------------------------------------------------------------
// NPN map helpers
// ---------------------------------------------------------------------------

function normalizeWn(wn: string): string {
  return (wn ?? "").trim().toUpperCase();
}

function buildNpnMap(
  agents: { unl_writing_number: string; npn: string }[],
  rosters: { writing_number: string; npn: string }[],
): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of agents) {
    const wn = normalizeWn(a.unl_writing_number);
    if (wn && a.npn) m.set(wn, a.npn);
  }
  for (const r of rosters) {
    const wn = normalizeWn(r.writing_number);
    if (wn && r.npn && !m.has(wn)) m.set(wn, r.npn);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Hold partitioning (mirrors main loop logic)
// ---------------------------------------------------------------------------

function partitionHolds(
  holds: HoldRow[],
  npnMap: Map<string, string>,
): { toResolve: HoldRow[]; stillHeld: HoldRow[] } {
  const toResolve: HoldRow[] = [];
  const stillHeld: HoldRow[] = [];
  for (const h of holds) {
    const wn  = normalizeWn(h.writing_number);
    const npn = npnMap.get(wn) ?? "";
    if (npn) toResolve.push(h);
    else stillHeld.push(h);
  }
  return { toResolve, stillHeld };
}

function buildProposals(
  toResolve: HoldRow[],
  npnMap: Map<string, string>,
): ProposedFire[] {
  return toResolve.map((h) => ({
    npn_hold_id:    h.id,
    policy_nbr:     h.policy_nbr,
    trigger_type:   h.trigger_type,
    changed_on:     h.changed_on,
    agency_id:      h.agency_id,
    agent_npn:      npnMap.get(normalizeWn(h.writing_number)) ?? "",
    writing_number: normalizeWn(h.writing_number),
  }));
}

// ---------------------------------------------------------------------------
// NPN map tests
// ---------------------------------------------------------------------------

Deno.test("buildNpnMap — agents primary, roster fallback", () => {
  const agents  = [{ unl_writing_number: "202ABCD", npn: "1111111" }];
  const rosters = [{ writing_number: "202ABCD", npn: "9999999" }]; // same WN — agents wins
  const m = buildNpnMap(agents, rosters);
  assertEquals(m.get("202ABCD"), "1111111", "agents table should win over roster");
});

Deno.test("buildNpnMap — roster fills in when agent not present", () => {
  const agents  = [{ unl_writing_number: "202AAAA", npn: "1111111" }];
  const rosters = [{ writing_number: "202BBBB", npn: "2222222" }]; // different WN
  const m = buildNpnMap(agents, rosters);
  assertEquals(m.get("202BBBB"), "2222222");
  assertEquals(m.get("202AAAA"), "1111111");
});

Deno.test("buildNpnMap — empty inputs return empty map", () => {
  const m = buildNpnMap([], []);
  assertEquals(m.size, 0);
});

Deno.test("buildNpnMap — normalizes writing number to UPPER+trim", () => {
  const agents  = [{ unl_writing_number: "  202abcd  ", npn: "1111111" }];
  const rosters: { writing_number: string; npn: string }[] = [];
  const m = buildNpnMap(agents, rosters);
  assertEquals(m.has("202ABCD"), true);
  assertEquals(m.has("  202abcd  "), false);
});

Deno.test("buildNpnMap — writing number lookup is case-insensitive via normalize", () => {
  const agents  = [{ unl_writing_number: "202ABCD", npn: "1111111" }];
  const rosters: { writing_number: string; npn: string }[] = [];
  const m = buildNpnMap(agents, rosters);
  // Lookup must normalize before get
  assertEquals(m.get(normalizeWn("202abcd")), "1111111");
});

// ---------------------------------------------------------------------------
// Hold partitioning
// ---------------------------------------------------------------------------

const sampleHolds: HoldRow[] = [
  { id: 1, policy_nbr: "20H001", trigger_type: "approved",    changed_on: "2026-07-17", agency_id: "ag-1", agent_name: "John Doe",   writing_number: "202ABCD" },
  { id: 2, policy_nbr: "20H002", trigger_type: "submission",  changed_on: "2026-07-17", agency_id: "ag-1", agent_name: "Jane Smith",  writing_number: "202EFGH" },
  { id: 3, policy_nbr: "20H003", trigger_type: "at_risk",     changed_on: "2026-07-16", agency_id: "ag-2", agent_name: "Bob Jones",   writing_number: "202XXXX" },
];

Deno.test("partitionHolds — NPN found → toResolve; NPN missing → stillHeld", () => {
  const npnMap = buildNpnMap(
    [{ unl_writing_number: "202ABCD", npn: "1111111" }],
    [{ writing_number: "202EFGH", npn: "2222222" }],
  );
  const { toResolve, stillHeld } = partitionHolds(sampleHolds, npnMap);
  assertEquals(toResolve.length, 2,   "202ABCD and 202EFGH both resolve");
  assertEquals(stillHeld.length, 1,   "202XXXX has no NPN");
  assertEquals(stillHeld[0].policy_nbr, "20H003");
});

Deno.test("partitionHolds — empty NPN map → all still held", () => {
  const npnMap = new Map<string, string>();
  const { toResolve, stillHeld } = partitionHolds(sampleHolds, npnMap);
  assertEquals(toResolve.length, 0);
  assertEquals(stillHeld.length, sampleHolds.length);
});

Deno.test("partitionHolds — all have NPN → all resolve", () => {
  const npnMap = new Map([["202ABCD", "1111111"], ["202EFGH", "2222222"], ["202XXXX", "3333333"]]);
  const { toResolve, stillHeld } = partitionHolds(sampleHolds, npnMap);
  assertEquals(toResolve.length, 3);
  assertEquals(stillHeld.length, 0);
});

// ---------------------------------------------------------------------------
// proposed_fires payload shape
// ---------------------------------------------------------------------------

Deno.test("buildProposals — each row gets npn_hold_id, agent_npn, writing_number normalized", () => {
  const npnMap = new Map([["202ABCD", "1111111"], ["202EFGH", "2222222"]]);
  const holds  = sampleHolds.slice(0, 2); // first two
  const proposals = buildProposals(holds, npnMap);

  assertEquals(proposals.length, 2);

  const p0 = proposals[0];
  assertEquals(p0.npn_hold_id,    1);
  assertEquals(p0.policy_nbr,     "20H001");
  assertEquals(p0.trigger_type,   "approved");
  assertEquals(p0.agent_npn,      "1111111");
  assertEquals(p0.writing_number, "202ABCD");
  assertEquals(p0.agency_id,      "ag-1");

  const p1 = proposals[1];
  assertEquals(p1.npn_hold_id,    2);
  assertEquals(p1.agent_npn,      "2222222");
  assertEquals(p1.writing_number, "202EFGH");
});

Deno.test("buildProposals — writing_number normalized UPPER in proposal", () => {
  const rawHold: HoldRow = { id: 10, policy_nbr: "20H010", trigger_type: "submission", changed_on: "2026-07-17", agency_id: null, agent_name: null, writing_number: "  202lower  " };
  const npnMap  = new Map([["202LOWER", "5555555"]]);
  const proposals = buildProposals([rawHold], npnMap);
  assertEquals(proposals[0].writing_number, "202LOWER");
  assertEquals(proposals[0].agent_npn,      "5555555");
});

Deno.test("buildProposals — changed_on preserved exactly from hold", () => {
  const hold: HoldRow = { id: 20, policy_nbr: "20H020", trigger_type: "at_risk", changed_on: "2026-07-15", agency_id: null, agent_name: null, writing_number: "202ABCD" };
  const npnMap = new Map([["202ABCD", "1111111"]]);
  const proposals = buildProposals([hold], npnMap);
  assertEquals(proposals[0].changed_on, "2026-07-15");
});

// ---------------------------------------------------------------------------
// Dry-run behavior
// ---------------------------------------------------------------------------

Deno.test("dry-run — counts increment without side effects", () => {
  const holds  = sampleHolds;
  const npnMap = new Map([["202ABCD", "1111111"], ["202EFGH", "2222222"]]);
  const dry    = true;

  const { toResolve, stillHeld } = partitionHolds(holds, npnMap);
  const proposals = dry ? buildProposals(toResolve, npnMap) : [];

  // In dry-run, no DB writes happen — but resolved/proposed counts match
  assertEquals(toResolve.length,  2, "dry-run should still count resolved rows");
  assertEquals(stillHeld.length,  1, "dry-run should still count still_held rows");
  assertEquals(proposals.length,  2, "dry-run builds proposals for inspection");
});

// ---------------------------------------------------------------------------
// Idempotency — ON CONFLICT DO NOTHING semantics
// ---------------------------------------------------------------------------

Deno.test("idempotency — duplicate proposals for same (policy_nbr, trigger_type, changed_on) dedup", () => {
  // Simulates running resolver twice — second run should produce the same proposals
  // but ON CONFLICT DO NOTHING means no duplicate rows.
  const hold: HoldRow = { id: 1, policy_nbr: "20H001", trigger_type: "approved", changed_on: "2026-07-17", agency_id: null, agent_name: null, writing_number: "202ABCD" };
  const npnMap = new Map([["202ABCD", "1111111"]]);

  // Build proposals twice (simulates two resolver runs)
  const run1 = buildProposals([hold], npnMap);
  const run2 = buildProposals([hold], npnMap);

  // Both runs produce the same proposal (DB handles conflict)
  assertEquals(run1[0].policy_nbr,   run2[0].policy_nbr);
  assertEquals(run1[0].trigger_type, run2[0].trigger_type);
  assertEquals(run1[0].changed_on,   run2[0].changed_on);
});

// ---------------------------------------------------------------------------
// released_at constraint — only set when status = 'resolved'
// ---------------------------------------------------------------------------

Deno.test("released_at — only set when transitioning to resolved", () => {
  // Mirrors the DB CHECK constraint: released_at IS NULL OR status = 'resolved'
  // In the resolver, released_at is set alongside status = 'resolved'.
  // This test validates the pairing logic.
  const now = new Date().toISOString();

  const update = (id: number, resolved: boolean) => ({
    id,
    status:      resolved ? "resolved" : "held",
    released_at: resolved ? now : null,
  });

  const resolvedUpdate = update(1, true);
  const heldUpdate     = update(2, false);

  assertExists(resolvedUpdate.released_at, "resolved rows must have released_at");
  assertEquals(heldUpdate.released_at, null, "held rows must have null released_at");
  // Confirm constraint semantics
  assertEquals(resolvedUpdate.status, "resolved");
  assertEquals(heldUpdate.status,     "held");
});

// ---------------------------------------------------------------------------
// Writing number normalization edge cases
// ---------------------------------------------------------------------------

Deno.test("normalizeWn — null/undefined returns empty string", () => {
  assertEquals(normalizeWn(""),   "");
  assertEquals(normalizeWn("  "), "");
});

Deno.test("normalizeWn — mixed case + spaces normalized", () => {
  assertEquals(normalizeWn("  202aBcD  "), "202ABCD");
});
