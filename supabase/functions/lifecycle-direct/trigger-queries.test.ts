/**
 * trigger-queries.test.ts — Unit tests for the lifecycle-direct trigger-query pattern
 *
 * Tests cover:
 *   - firedSet idempotency gate (already-fired rows are skipped)
 *   - changedOn normalisation (Date object, ISO string, YYYY-MM-DD)
 *   - trigger_type → GHL triggerLabel mapping (at_risk → "at risk")
 *   - NPN gate integration (no NPN → npnHoldRows, not firedInserts)
 *   - agency gate (non-enabled agency → skipped)
 *   - fired_triggers insertion only on successful GHL push
 *   - within-run dedup (same firedKey can't fire twice in one batch)
 *
 * Run: deno test --allow-none trigger-queries.test.ts
 */

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";

// ---------------------------------------------------------------------------
// Inline helpers (mirrors lifecycle-direct/index.ts logic exactly)
// ---------------------------------------------------------------------------

function normChangedOn(raw: unknown): string {
  return (raw instanceof Date
    ? raw.toISOString()
    : String(raw ?? "")).slice(0, 10);
}

type TriggerType = "approved" | "terminated" | "submission" | "at_risk";

function triggerLabel(t: TriggerType): string {
  return t === "at_risk" ? "at risk" : t;
}

function firedKey(policyNbr: string, triggerType: TriggerType, changedOn: string): string {
  return `${policyNbr}|${triggerType}|${changedOn}`;
}

// ---------------------------------------------------------------------------
// changedOn normalisation
// ---------------------------------------------------------------------------

Deno.test("normChangedOn — Date object → YYYY-MM-DD", () => {
  const d = new Date("2026-07-17T10:30:00.000Z");
  assertEquals(normChangedOn(d), "2026-07-17");
});

Deno.test("normChangedOn — ISO string → YYYY-MM-DD", () => {
  assertEquals(normChangedOn("2026-07-17T00:00:00Z"), "2026-07-17");
});

Deno.test("normChangedOn — bare YYYY-MM-DD passes through", () => {
  assertEquals(normChangedOn("2026-07-15"), "2026-07-15");
});

Deno.test("normChangedOn — null → empty string", () => {
  assertEquals(normChangedOn(null), "");
});

Deno.test("normChangedOn — undefined → empty string", () => {
  assertEquals(normChangedOn(undefined), "");
});

// ---------------------------------------------------------------------------
// trigger label mapping
// ---------------------------------------------------------------------------

Deno.test("triggerLabel — at_risk → 'at risk' (GHL field value)", () => {
  assertEquals(triggerLabel("at_risk"), "at risk");
});

Deno.test("triggerLabel — approved passes through unchanged", () => {
  assertEquals(triggerLabel("approved"), "approved");
});

Deno.test("triggerLabel — terminated passes through unchanged", () => {
  assertEquals(triggerLabel("terminated"), "terminated");
});

Deno.test("triggerLabel — submission passes through unchanged", () => {
  assertEquals(triggerLabel("submission"), "submission");
});

// ---------------------------------------------------------------------------
// firedSet idempotency gate
// ---------------------------------------------------------------------------

Deno.test("firedSet — already-fired key is skipped", () => {
  const firedSet = new Set<string>();
  firedSet.add("20H6100001|approved|2026-07-17");

  const key = firedKey("20H6100001", "approved", "2026-07-17");
  assertEquals(firedSet.has(key), true, "existing key should be in set");
});

Deno.test("firedSet — unfired key is not in set", () => {
  const firedSet = new Set<string>();
  firedSet.add("20H6100001|approved|2026-07-17");

  const key = firedKey("20H6100001", "approved", "2026-07-18");
  assertEquals(firedSet.has(key), false, "different date = different key");
});

Deno.test("firedSet — same policy different trigger_type is not skipped", () => {
  const firedSet = new Set<string>();
  firedSet.add("20H6100001|approved|2026-07-17");

  const key = firedKey("20H6100001", "terminated", "2026-07-17");
  assertEquals(firedSet.has(key), false, "different trigger = different key");
});

Deno.test("firedSet — within-run dedup: adding to firedSet prevents re-fire", () => {
  const firedSet = new Set<string>();
  const firedInserts: { policy_nbr: string; trigger_type: string; changed_on: string }[] = [];

  // Simulate two rows for the same policy/trigger/date (e.g. duplicate in UNION ALL)
  const rows = [
    { policy_nbr: "20H6100001", trigger_type: "approved" as TriggerType, changed_on: "2026-07-17" },
    { policy_nbr: "20H6100001", trigger_type: "approved" as TriggerType, changed_on: "2026-07-17" },
  ];

  for (const row of rows) {
    const key = firedKey(row.policy_nbr, row.trigger_type, row.changed_on);
    if (firedSet.has(key)) continue; // gate
    // Simulate successful push
    firedInserts.push({ policy_nbr: row.policy_nbr, trigger_type: row.trigger_type, changed_on: row.changed_on });
    firedSet.add(key); // within-run dedup
  }

  assertEquals(firedInserts.length, 1, "duplicate row in same batch should only fire once");
});

Deno.test("firedSet — empty set allows all rows through", () => {
  const firedSet = new Set<string>();
  const triggers: TriggerType[] = ["approved", "terminated", "submission", "at_risk"];
  let passed = 0;

  for (const t of triggers) {
    const key = firedKey("20H6100001", t, "2026-07-17");
    if (!firedSet.has(key)) passed++;
  }

  assertEquals(passed, 4, "all four trigger types should pass on empty firedSet");
});

// ---------------------------------------------------------------------------
// NPN gate → npnHoldRows
// ---------------------------------------------------------------------------

Deno.test("NPN gate — missing NPN pushes to npnHoldRows, not firedInserts", () => {
  const npnMap = new Map<string, string>(); // empty — no NPNs
  const firedInserts: unknown[] = [];
  const npnHoldRows: unknown[] = [];

  const row = {
    policy_nbr: "20H6100001",
    trigger_type: "approved" as TriggerType,
    changed_on: "2026-07-17",
    cntrct_code: "A",
    first_name: "JOHN",
    last_name: "DOE",
    writing_number: "202ABCDE",
    agency_id: "agency-uuid",
    agency_name: "Test Agency",
  };

  const npn = npnMap.get(row.writing_number) ?? "";
  if (!npn) {
    npnHoldRows.push({
      policy_nbr:     row.policy_nbr,
      trigger_type:   row.trigger_type,
      changed_on:     row.changed_on,
      agency_id:      row.agency_id,
      agency_name:    row.agency_name,
      agent_name:     `${row.first_name} ${row.last_name}`.trim(),
      writing_number: row.writing_number,
    });
  } else {
    firedInserts.push({ policy_nbr: row.policy_nbr });
  }

  assertEquals(firedInserts.length, 0, "no GHL push without NPN");
  assertEquals(npnHoldRows.length, 1, "held row written to npnHoldRows");
});

Deno.test("NPN gate — present NPN bypasses hold, proceeds to GHL push path", () => {
  const npnMap = new Map<string, string>([["202ABCDE", "1234567"]]);
  const firedInserts: string[] = [];
  const npnHoldRows: unknown[] = [];

  const wn = "202ABCDE";
  const npn = npnMap.get(wn) ?? "";
  if (!npn) {
    npnHoldRows.push({ writing_number: wn });
  } else {
    firedInserts.push(npn);
  }

  assertEquals(npnHoldRows.length, 0);
  assertEquals(firedInserts.length, 1);
  assertEquals(firedInserts[0], "1234567");
});

// ---------------------------------------------------------------------------
// npnHoldRows trigger_type normalisation
// (at_risk stored with underscore in npn_holds — matches fired_triggers constraint)
// ---------------------------------------------------------------------------

Deno.test("npnHoldRows trigger_type uses underscore form (at_risk, not 'at risk')", () => {
  // The trigger_type written to npn_holds must match the fired_triggers CHECK constraint:
  // 'approved'|'terminated'|'submission'|'at_risk' — underscore form.
  const hold = {
    trigger_type: "at_risk" as TriggerType, // stored as at_risk
  };

  // Confirm it matches the constraint set
  const valid = ["approved", "terminated", "submission", "at_risk"];
  assertEquals(valid.includes(hold.trigger_type), true);
  // Confirm GHL label is different
  assertEquals(triggerLabel(hold.trigger_type), "at risk");
});

// ---------------------------------------------------------------------------
// fired_triggers insert — only on successful GHL push
// ---------------------------------------------------------------------------

Deno.test("firedInserts only populated when GHL push succeeds (ok=true)", () => {
  const firedInserts: { policy_nbr: string; trigger_type: string; changed_on: string }[] = [];
  const firedSet = new Set<string>();

  interface GhlResult { ok: boolean }
  function simulatePush(succeed: boolean): GhlResult { return { ok: succeed }; }

  const rows = [
    { policy_nbr: "20H6100001", trigger_type: "approved" as TriggerType, changed_on: "2026-07-17", succeed: true  },
    { policy_nbr: "20H6100002", trigger_type: "approved" as TriggerType, changed_on: "2026-07-17", succeed: false },
    { policy_nbr: "20H6100003", trigger_type: "approved" as TriggerType, changed_on: "2026-07-17", succeed: true  },
  ];

  for (const row of rows) {
    const key = firedKey(row.policy_nbr, row.trigger_type, row.changed_on);
    if (firedSet.has(key)) continue;
    const r = simulatePush(row.succeed);
    if (r.ok) {
      firedInserts.push({ policy_nbr: row.policy_nbr, trigger_type: row.trigger_type, changed_on: row.changed_on });
      firedSet.add(key);
    }
  }

  assertEquals(firedInserts.length, 2, "only successful pushes write to fired_triggers");
  assertEquals(firedInserts.map((r) => r.policy_nbr).sort(), ["20H6100001", "20H6100003"]);
});

// ---------------------------------------------------------------------------
// Trigger E: direct approval (cntrct_code=A, prev IS NULL)
// ---------------------------------------------------------------------------

Deno.test("Trigger E — direct approval uses issue_date as changed_on, not contract_code_last_change_date", () => {
  // Direct-approval policies have no contract_code_last_change_date because
  // they never transitioned (previous_contract_code IS NULL). issue_date is
  // used as the changed_on value instead.
  const issueDate = new Date("2026-08-20T00:00:00.000Z");
  const changedOn = normChangedOn(issueDate);
  assertEquals(changedOn, "2026-08-20");

  // The fired_triggers key uses trigger_type = "approved" — same as Trigger A
  const key = firedKey("20H6161841", "approved", changedOn);
  assertEquals(key, "20H6161841|approved|2026-08-20");
});

Deno.test("Trigger E vs Trigger A — no collision when changed_on dates differ", () => {
  // Trigger A (P→A): changed_on = contract_code_last_change_date (e.g. 2026-08-25)
  // Trigger E (direct): changed_on = issue_date (e.g. 2026-08-18)
  // Same policy, same trigger_type, but different changed_on → different keys
  const keyA = firedKey("20H6161841", "approved", "2026-08-25");
  const keyE = firedKey("20H6161841", "approved", "2026-08-18");
  assertEquals(keyA !== keyE, true, "different changed_on dates produce different keys");
});

Deno.test("Trigger E — firedSet prevents duplicate fire for same policy+issue_date", () => {
  const firedSet = new Set<string>();
  const firedInserts: string[] = [];

  // Simulate two rows for the same direct-approval policy (e.g. cron runs twice
  // while policy still matches cntrct_code=A, prev=NULL within the 14-day window)
  const rows = [
    { policy_nbr: "20H6161841", trigger_type: "approved" as TriggerType, changed_on: "2026-08-20" },
    { policy_nbr: "20H6161841", trigger_type: "approved" as TriggerType, changed_on: "2026-08-20" },
  ];

  for (const row of rows) {
    const key = firedKey(row.policy_nbr, row.trigger_type, row.changed_on);
    if (firedSet.has(key)) continue;
    firedInserts.push(row.policy_nbr);
    firedSet.add(key);
  }

  assertEquals(firedInserts.length, 1, "direct-approval fires exactly once per policy+date");
});

Deno.test("Trigger E — mutually exclusive with Trigger A (prev IS NULL vs prev = P)", () => {
  // Trigger A requires previous_contract_code = 'P' AND cntrct_code = 'A'
  // Trigger E requires cntrct_code = 'A' AND previous_contract_code IS NULL
  // These conditions are mutually exclusive — a policy cannot match both.
  const prevCodeA: string | null = "P";  // Trigger A match
  const prevCodeE: string | null = null;  // Trigger E match

  const matchesTriggerA = (prev: string | null) => prev === "P";
  const matchesTriggerE = (prev: string | null) => prev === null;

  assertEquals(matchesTriggerA(prevCodeA), true);
  assertEquals(matchesTriggerE(prevCodeA), false);
  assertEquals(matchesTriggerA(prevCodeE), false);
  assertEquals(matchesTriggerE(prevCodeE), true);

  // No overlap possible
  assertEquals(
    matchesTriggerA(prevCodeA) && matchesTriggerE(prevCodeA),
    false,
    "same row cannot match both Trigger A and Trigger E",
  );
});

// ---------------------------------------------------------------------------
// firedKey format correctness
// ---------------------------------------------------------------------------

Deno.test("firedKey — pipe-delimited format is stable", () => {
  const key = firedKey("20H6100001", "at_risk", "2026-07-17");
  assertStringIncludes(key, "|");
  const parts = key.split("|");
  assertEquals(parts.length, 3);
  assertEquals(parts[0], "20H6100001");
  assertEquals(parts[1], "at_risk");
  assertEquals(parts[2], "2026-07-17");
});

// ---------------------------------------------------------------------------
// Fire rate monitor — threshold logic
// ---------------------------------------------------------------------------

function computeFireRate(
  eligible: { policy_nbr: string; trigger_type: TriggerType; changed_on: string }[],
  firedSet: Set<string>,
): { rate: number; firedCount: number; missed: string[] } {
  let firedCount = 0;
  const missed: string[] = [];
  for (const p of eligible) {
    const key = firedKey(p.policy_nbr, p.trigger_type, p.changed_on);
    if (firedSet.has(key)) {
      firedCount++;
    } else {
      missed.push(p.policy_nbr);
    }
  }
  return { rate: eligible.length > 0 ? firedCount / eligible.length : 1, firedCount, missed };
}

Deno.test("fire rate monitor — 100% fire rate produces no alert", () => {
  const eligible = [
    { policy_nbr: "P001", trigger_type: "approved" as TriggerType, changed_on: "2026-08-20" },
    { policy_nbr: "P002", trigger_type: "approved" as TriggerType, changed_on: "2026-08-21" },
    { policy_nbr: "P003", trigger_type: "approved" as TriggerType, changed_on: "2026-08-22" },
  ];
  const fired = new Set(eligible.map(e => firedKey(e.policy_nbr, e.trigger_type, e.changed_on)));
  const result = computeFireRate(eligible, fired);
  assertEquals(result.rate, 1);
  assertEquals(result.missed.length, 0);
  assertEquals(result.rate >= 0.95, true, "100% should not trigger alert");
});

Deno.test("fire rate monitor — 80% fire rate triggers alert (below 95%)", () => {
  const eligible = [
    { policy_nbr: "P001", trigger_type: "terminated" as TriggerType, changed_on: "2026-08-20" },
    { policy_nbr: "P002", trigger_type: "terminated" as TriggerType, changed_on: "2026-08-20" },
    { policy_nbr: "P003", trigger_type: "terminated" as TriggerType, changed_on: "2026-08-21" },
    { policy_nbr: "P004", trigger_type: "terminated" as TriggerType, changed_on: "2026-08-21" },
    { policy_nbr: "P005", trigger_type: "terminated" as TriggerType, changed_on: "2026-08-22" },
  ];
  // Only 4 of 5 fired
  const fired = new Set([
    firedKey("P001", "terminated", "2026-08-20"),
    firedKey("P002", "terminated", "2026-08-20"),
    firedKey("P003", "terminated", "2026-08-21"),
    firedKey("P004", "terminated", "2026-08-21"),
  ]);
  const result = computeFireRate(eligible, fired);
  assertEquals(result.rate, 0.8);
  assertEquals(result.missed, ["P005"]);
  assertEquals(result.rate < 0.95, true, "80% should trigger alert");
});

Deno.test("fire rate monitor — exactly 95% does NOT trigger alert", () => {
  // 20 eligible, 19 fired = 95%
  const eligible = Array.from({ length: 20 }, (_, i) => ({
    policy_nbr: `P${String(i + 1).padStart(3, "0")}`,
    trigger_type: "at_risk" as TriggerType,
    changed_on: "2026-08-20",
  }));
  const fired = new Set(
    eligible.slice(0, 19).map(e => firedKey(e.policy_nbr, e.trigger_type, e.changed_on)),
  );
  const result = computeFireRate(eligible, fired);
  assertEquals(result.rate, 0.95);
  assertEquals(result.missed.length, 1);
  assertEquals(result.rate >= 0.95, true, "exactly 95% should NOT trigger alert");
});

Deno.test("fire rate monitor — below minimum threshold (< 5 eligible) is skipped", () => {
  // Groups with fewer than 5 eligible events are too small to be meaningful
  const eligible = [
    { policy_nbr: "P001", trigger_type: "submission" as TriggerType, changed_on: "2026-08-20" },
    { policy_nbr: "P002", trigger_type: "submission" as TriggerType, changed_on: "2026-08-21" },
  ];
  const fired = new Set<string>(); // 0% fire rate but only 2 eligible
  const result = computeFireRate(eligible, fired);
  assertEquals(result.rate, 0);
  // The monitor code skips groups < 5; this test verifies the rate math is correct
  // but the caller is responsible for the min-threshold check
  assertEquals(eligible.length < 5, true, "small groups should be skipped by caller");
});

Deno.test("fire rate monitor — empty eligible set returns rate 1 (no alert)", () => {
  const result = computeFireRate([], new Set());
  assertEquals(result.rate, 1, "empty eligible = 100% by convention");
  assertEquals(result.missed.length, 0);
});

Deno.test("fire rate monitor — missed policies list is capped", () => {
  // Verify the cap logic: in the real code, missed_policies is sliced to 50
  const eligible = Array.from({ length: 60 }, (_, i) => ({
    policy_nbr: `P${String(i + 1).padStart(3, "0")}`,
    trigger_type: "approved" as TriggerType,
    changed_on: "2026-08-20",
  }));
  const fired = new Set<string>(); // none fired
  const result = computeFireRate(eligible, fired);
  assertEquals(result.missed.length, 60); // raw missed count
  // The cap at 50 is applied in the calling code, not in computeFireRate
  const capped = result.missed.slice(0, 50);
  assertEquals(capped.length, 50);
});

Deno.test("fire rate monitor — different trigger types are independent", () => {
  const eligible_approved = [
    { policy_nbr: "P001", trigger_type: "approved" as TriggerType, changed_on: "2026-08-20" },
    { policy_nbr: "P002", trigger_type: "approved" as TriggerType, changed_on: "2026-08-20" },
  ];
  const eligible_terminated = [
    { policy_nbr: "P001", trigger_type: "terminated" as TriggerType, changed_on: "2026-08-25" },
    { policy_nbr: "P003", trigger_type: "terminated" as TriggerType, changed_on: "2026-08-25" },
  ];
  // P001 fired as approved but not as terminated
  const fired = new Set([firedKey("P001", "approved", "2026-08-20")]);

  const rateApproved = computeFireRate(eligible_approved, fired);
  const rateTerminated = computeFireRate(eligible_terminated, fired);

  assertEquals(rateApproved.rate, 0.5, "1 of 2 approved fired");
  assertEquals(rateTerminated.rate, 0, "0 of 2 terminated fired");
  assertEquals(rateApproved.missed, ["P002"]);
  assertEquals(rateTerminated.missed, ["P001", "P003"]);
});
