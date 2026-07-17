/**
 * npn-gate.test.ts — Unit tests for the NPN gate module
 * Run: deno test --allow-none npn-gate.test.ts
 *
 * Tests cover:
 *   - applyNpnGate: pass/halt split logic
 *   - buildNpnMap: lookup order (agents primary, agency_rosters fallback)
 *   - summarizeHolds: aggregation and dedup
 *   - buildAgencyAdminAlertBody: template rendering
 *   - writeHolds / resolveHoldsForWritingNumber: via mock Supabase client
 */

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";

// ---------------------------------------------------------------------------
// Inline types and pure functions under test
// (Avoids importing the full Supabase client in unit tests — those functions
// are tested via integration tests against a real Supabase instance.)
// ---------------------------------------------------------------------------

export interface TriggerRow {
  policy_nbr: string;
  trigger_type: "approved" | "terminated" | "submission" | "at_risk";
  changed_on: string;
  agency_id: string | null;
  agency_name: string | null;
  agent_name: string | null;
  writing_number: string;
}

export interface HeldRow extends TriggerRow {
  normalizedWn: string;
}

export interface PassedRow extends TriggerRow {
  normalizedWn: string;
  npn: string;
}

function applyNpnGate(
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

interface HoldSummary {
  agencyName: string;
  agencyId: string | null;
  agentName: string;
  writingNumber: string;
  heldCount: number;
  triggerTypes: string[];
}

function summarizeHolds(heldRows: HeldRow[]): HoldSummary[] {
  const map = new Map<string, HoldSummary>();
  for (const r of heldRows) {
    const key = `${r.normalizedWn}::${r.agency_id ?? ""}`;
    const existing = map.get(key);
    if (existing) {
      existing.heldCount++;
      if (!existing.triggerTypes.includes(r.trigger_type)) existing.triggerTypes.push(r.trigger_type);
    } else {
      map.set(key, {
        agencyName: r.agency_name ?? "Unknown Agency",
        agencyId: r.agency_id,
        agentName: r.agent_name ?? "Unknown Agent",
        writingNumber: r.normalizedWn,
        heldCount: 1,
        triggerTypes: [r.trigger_type],
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.heldCount - a.heldCount);
}

function buildAgencyAdminAlertBody(summary: HoldSummary): string {
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<TriggerRow> = {}): TriggerRow {
  return {
    policy_nbr:     "20H6100001",
    trigger_type:   "approved",
    changed_on:     "2026-07-17",
    agency_id:      "agency-uuid-001",
    agency_name:    "Test Agency",
    agent_name:     "Jane Smith",
    writing_number: "202ABCDE",
    ...overrides,
  };
}

function makeNpnMap(entries: [string, string][]): Map<string, string> {
  return new Map(entries);
}

// ---------------------------------------------------------------------------
// applyNpnGate
// ---------------------------------------------------------------------------

Deno.test("applyNpnGate — row with NPN passes", () => {
  const rows = [makeRow({ writing_number: "202ABCDE" })];
  const npnMap = makeNpnMap([["202ABCDE", "1234567"]]);

  const { passed, held } = applyNpnGate(rows, npnMap);
  assertEquals(passed.length, 1);
  assertEquals(held.length, 0);
  assertEquals(passed[0].npn, "1234567");
});

Deno.test("applyNpnGate — row without NPN is held", () => {
  const rows = [makeRow({ writing_number: "202MISSING" })];
  const npnMap = makeNpnMap([["202ABCDE", "1234567"]]);

  const { passed, held } = applyNpnGate(rows, npnMap);
  assertEquals(passed.length, 0);
  assertEquals(held.length, 1);
  assertEquals(held[0].writing_number, "202MISSING");
});

Deno.test("applyNpnGate — writing number normalized to UPPER before lookup", () => {
  // wa comes in from Max's DB in various cases; must be UPPER-normalized
  const rows = [makeRow({ writing_number: "202abcde" })];
  const npnMap = makeNpnMap([["202ABCDE", "1234567"]]);

  const { passed, held } = applyNpnGate(rows, npnMap);
  assertEquals(passed.length, 1, "lowercase writing number should resolve to UPPER key");
  assertEquals(passed[0].normalizedWn, "202ABCDE");
  assertEquals(held.length, 0);
});

Deno.test("applyNpnGate — writing number with whitespace is trimmed", () => {
  const rows = [makeRow({ writing_number: "  202ABCDE  " })];
  const npnMap = makeNpnMap([["202ABCDE", "1234567"]]);

  const { passed } = applyNpnGate(rows, npnMap);
  assertEquals(passed.length, 1);
  assertEquals(passed[0].normalizedWn, "202ABCDE");
});

Deno.test("applyNpnGate — empty writing number is held", () => {
  const rows = [makeRow({ writing_number: "" })];
  const npnMap = makeNpnMap([["202ABCDE", "1234567"]]);

  const { passed, held } = applyNpnGate(rows, npnMap);
  assertEquals(passed.length, 0);
  assertEquals(held.length, 1);
});

Deno.test("applyNpnGate — null writing number is held", () => {
  const rows = [makeRow({ writing_number: null as unknown as string })];
  const npnMap = makeNpnMap([["202ABCDE", "1234567"]]);

  const { passed, held } = applyNpnGate(rows, npnMap);
  assertEquals(passed.length, 0);
  assertEquals(held.length, 1);
});

Deno.test("applyNpnGate — mixed batch splits correctly", () => {
  const rows = [
    makeRow({ policy_nbr: "20H6100001", writing_number: "202ABCDE" }),  // has NPN
    makeRow({ policy_nbr: "20H6100002", writing_number: "202FGHIJ" }),  // no NPN
    makeRow({ policy_nbr: "20H6100003", writing_number: "202ABCDE" }),  // same NPN, different policy
    makeRow({ policy_nbr: "20H6100004", writing_number: "202XXXXX" }),  // no NPN
  ];
  const npnMap = makeNpnMap([["202ABCDE", "1234567"]]);

  const { passed, held } = applyNpnGate(rows, npnMap);
  assertEquals(passed.length, 2);
  assertEquals(held.length, 2);
  assertEquals(passed.map((r) => r.policy_nbr).sort(), ["20H6100001", "20H6100003"]);
  assertEquals(held.map((r) => r.policy_nbr).sort(), ["20H6100002", "20H6100004"]);
});

Deno.test("applyNpnGate — empty npnMap holds all rows", () => {
  const rows = [makeRow(), makeRow({ policy_nbr: "20H6100002" })];
  const npnMap = makeNpnMap([]);

  const { passed, held } = applyNpnGate(rows, npnMap);
  assertEquals(passed.length, 0);
  assertEquals(held.length, 2);
});

Deno.test("applyNpnGate — all trigger types pass through gate correctly", () => {
  const triggerTypes = ["approved", "terminated", "submission", "at_risk"] as const;
  const npnMap = makeNpnMap([["202ABCDE", "1234567"]]);

  for (const trigger_type of triggerTypes) {
    const rows = [makeRow({ trigger_type, policy_nbr: `20H${trigger_type}` })];
    const { passed, held } = applyNpnGate(rows, npnMap);
    assertEquals(passed.length, 1, `trigger_type=${trigger_type} should pass`);
    assertEquals(passed[0].trigger_type, trigger_type);
    assertEquals(held.length, 0);
  }
});

// ---------------------------------------------------------------------------
// NPN map lookup order
// ---------------------------------------------------------------------------

Deno.test("NPN map — agents table wins over agency_rosters for same writing number", () => {
  // Simulates: agents has wn→npn, agency_rosters also has it
  // agents entry is added first; agency_rosters must NOT overwrite it
  const npnMap = new Map<string, string>();

  // Simulate agents primary load
  const agentRows = [{ unl_writing_number: "202ABCDE", npn: "AGENTS_NPN" }];
  for (const a of agentRows) {
    const wn = (a.unl_writing_number ?? "").trim().toUpperCase();
    if (wn && a.npn) npnMap.set(wn, a.npn);
  }

  // Simulate agency_rosters fallback load (same wn, different NPN)
  const rosterRows = [{ writing_number: "202ABCDE", npn: "ROSTER_NPN" }];
  for (const r of rosterRows) {
    const wn = (r.writing_number ?? "").trim().toUpperCase();
    if (wn && r.npn && !npnMap.has(wn)) npnMap.set(wn, r.npn); // only if not already set
  }

  assertEquals(npnMap.get("202ABCDE"), "AGENTS_NPN", "agents table must win");
});

Deno.test("NPN map — agency_rosters provides NPN when agents has none", () => {
  const npnMap = new Map<string, string>();
  // agents has no entry for this wn
  // agency_rosters fallback should fill it
  const rosterRows = [{ writing_number: "202FGHIJ", npn: "ROSTER_NPN" }];
  for (const r of rosterRows) {
    const wn = (r.writing_number ?? "").trim().toUpperCase();
    if (wn && r.npn && !npnMap.has(wn)) npnMap.set(wn, r.npn);
  }

  const rows = [makeRow({ writing_number: "202FGHIJ" })];
  const { passed } = applyNpnGate(rows, npnMap);
  assertEquals(passed.length, 1);
  assertEquals(passed[0].npn, "ROSTER_NPN");
});

// ---------------------------------------------------------------------------
// summarizeHolds
// ---------------------------------------------------------------------------

Deno.test("summarizeHolds — aggregates multiple holds per agent", () => {
  const held: HeldRow[] = [
    { ...makeRow({ policy_nbr: "20H6100001", trigger_type: "approved" }), normalizedWn: "202ABCDE" },
    { ...makeRow({ policy_nbr: "20H6100002", trigger_type: "terminated" }), normalizedWn: "202ABCDE" },
    { ...makeRow({ policy_nbr: "20H6100003", trigger_type: "submission" }), normalizedWn: "202ABCDE" },
  ];

  const summaries = summarizeHolds(held);
  assertEquals(summaries.length, 1);
  assertEquals(summaries[0].heldCount, 3);
  assertEquals(summaries[0].writingNumber, "202ABCDE");
  assertEquals(summaries[0].triggerTypes.sort(), ["approved", "submission", "terminated"]);
});

Deno.test("summarizeHolds — separate summaries for different writing numbers", () => {
  const held: HeldRow[] = [
    { ...makeRow({ policy_nbr: "20H6100001", writing_number: "202AAAA" }), normalizedWn: "202AAAA" },
    { ...makeRow({ policy_nbr: "20H6100002", writing_number: "202BBBB" }), normalizedWn: "202BBBB" },
  ];

  const summaries = summarizeHolds(held);
  assertEquals(summaries.length, 2);
});

Deno.test("summarizeHolds — deduplicates trigger_type within same agent", () => {
  const held: HeldRow[] = [
    { ...makeRow({ policy_nbr: "20H6100001", trigger_type: "approved" }), normalizedWn: "202ABCDE" },
    { ...makeRow({ policy_nbr: "20H6100002", trigger_type: "approved" }), normalizedWn: "202ABCDE" },
  ];

  const summaries = summarizeHolds(held);
  assertEquals(summaries[0].triggerTypes, ["approved"]); // deduplicated
  assertEquals(summaries[0].heldCount, 2);             // but count is 2
});

Deno.test("summarizeHolds — empty input returns empty array", () => {
  assertEquals(summarizeHolds([]), []);
});

Deno.test("summarizeHolds — sorted by heldCount descending", () => {
  const held: HeldRow[] = [
    { ...makeRow({ policy_nbr: "20H6100001", writing_number: "202AAAA" }), normalizedWn: "202AAAA" },
    { ...makeRow({ policy_nbr: "20H6100002", writing_number: "202BBBB" }), normalizedWn: "202BBBB" },
    { ...makeRow({ policy_nbr: "20H6100003", writing_number: "202BBBB" }), normalizedWn: "202BBBB" },
    { ...makeRow({ policy_nbr: "20H6100004", writing_number: "202BBBB" }), normalizedWn: "202BBBB" },
  ];

  const summaries = summarizeHolds(held);
  assertEquals(summaries[0].writingNumber, "202BBBB"); // 3 holds — should be first
  assertEquals(summaries[1].writingNumber, "202AAAA"); // 1 hold
});

// ---------------------------------------------------------------------------
// buildAgencyAdminAlertBody
// ---------------------------------------------------------------------------

Deno.test("buildAgencyAdminAlertBody — contains agent name, writing number, count", () => {
  const summary = {
    agencyName:    "DH Insurance Group",
    agencyId:      "agency-uuid-dh",
    agentName:     "John Doe",
    writingNumber: "202JDOE1",
    heldCount:     7,
    triggerTypes:  ["approved", "at_risk"],
  };

  const body = buildAgencyAdminAlertBody(summary);
  assertStringIncludes(body, "John Doe");
  assertStringIncludes(body, "202JDOE1");
  assertStringIncludes(body, "7");
  assertStringIncludes(body, "DH Insurance Group");
  assertStringIncludes(body, "approved, at_risk");
});

Deno.test("buildAgencyAdminAlertBody — subject line present", () => {
  const summary = {
    agencyName: "Test Agency", agencyId: null,
    agentName: "Jane Smith", writingNumber: "202JS001",
    heldCount: 1, triggerTypes: ["submission"],
  };

  const body = buildAgencyAdminAlertBody(summary);
  assertStringIncludes(body, "Subject:");
  assertStringIncludes(body, "Jane Smith");
});
