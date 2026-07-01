import { assertEquals } from "jsr:@std/assert@1";
import {
  computeLifecycleEvents,
  deriveAtRisk,
  derivePlanType,
  evaluateAtRisk,
  type PolicyState,
  type PriorState,
} from "./lifecycle-evaluator.ts";

// ---- plan-type classification (validated against live plan_name values) ----

Deno.test("derivePlanType: HHC variants", () => {
  for (const n of ["UTHHC", "UTHHC OH", "UNHHC KY", "Home Health Care Shield with TCARE benefit", "Original Home Health Care Shield", "Short Term Home Health Care W/ TCare", "HHC"]) {
    assertEquals(derivePlanType(n), "HHC", n);
  }
});

Deno.test("derivePlanType: HI / HIP variants", () => {
  for (const n of ["UHIP2", "UGHIP", "UFHIP", "UNHIP", "UFGHI", "UNHIP IL", "Guaranteed Issue Hospital Indemnity Shield", "Hospital Indemnity Shield 2.0", "UNL GI HIP Shield"]) {
    assertEquals(derivePlanType(n), "HIP", n);
  }
});

Deno.test("derivePlanType: Dental/Vision variants", () => {
  for (const n of ["UDN24", "UDN24 PA", "UDN21", "Dental Shield 2.0"]) {
    assertEquals(derivePlanType(n), "DV", n);
  }
});

Deno.test("derivePlanType: Cancer", () => {
  assertEquals(derivePlanType("UNCAN"), "Cancer");
});

Deno.test("derivePlanType: Life / final expense", () => {
  assertEquals(derivePlanType("UNFEX"), "Life");
  assertEquals(derivePlanType("Optional Guaranteed Issue $5k Life policy offered on Hosp Indem Shield"), "Life");
});

Deno.test("derivePlanType: HHC wins over HI in a combo", () => {
  assertEquals(derivePlanType("HHC + HI"), "HHC");
});

Deno.test("derivePlanType: unknown / empty", () => {
  assertEquals(derivePlanType("Advantage Plus Elite"), "Unknown");
  assertEquals(derivePlanType(""), "Unknown");
  assertEquals(derivePlanType(null), "Unknown");
});

// Fixed "now" = 2026-06-30 for deterministic date math.
const NOW = Date.parse("2026-06-30T00:00:00Z");

function policy(overrides: Partial<PolicyState> = {}): PolicyState {
  return {
    policy_number: "POL1",
    contract_code: "A",
    billing_mode: "1",
    billing_form: "DIR",
    policy_effective_date: "2026-06-01", // 29 days ago
    paid_to_date: "2026-06-01",
    contract_reason: null,
    ...overrides,
  };
}

// ---- transitions ----

Deno.test("submission is DISABLED by default (owned by intake form)", () => {
  const evts = computeLifecycleEvents(policy({ contract_code: "P" }), undefined, NOW);
  assertEquals(evts.length, 0);
});

Deno.test("submission fires only when explicitly enabled (post UNL cutover)", () => {
  const evts = computeLifecycleEvents(
    policy({ contract_code: "P" }),
    undefined,
    NOW,
    { emitSubmission: true },
  );
  assertEquals(evts.map((e) => e.trigger), ["submission"]);
  assertEquals(evts[0].previous_contract_code, null);
});

Deno.test("submission does NOT re-fire when already P (even if enabled)", () => {
  const prior: PriorState = { contract_code: "P", at_risk_fired_at: null };
  const evts = computeLifecycleEvents(policy({ contract_code: "P" }), prior, NOW, { emitSubmission: true });
  assertEquals(evts.length, 0);
});

Deno.test("approved fires on P -> A", () => {
  const prior: PriorState = { contract_code: "P", at_risk_fired_at: null };
  const evts = computeLifecycleEvents(policy({ contract_code: "A" }), prior, NOW);
  assertEquals(evts.map((e) => e.trigger), ["approved"]);
});

Deno.test("approved does NOT fire on new A insert (no prior P)", () => {
  const evts = computeLifecycleEvents(policy({ contract_code: "A" }), undefined, NOW);
  assertEquals(evts.length, 0);
});

Deno.test("terminated fires on A -> T and carries contract_reason", () => {
  const prior: PriorState = { contract_code: "A", at_risk_fired_at: null };
  const evts = computeLifecycleEvents(
    policy({ contract_code: "T", contract_reason: "Lapsed" }),
    prior,
    NOW,
  );
  assertEquals(evts.map((e) => e.trigger), ["terminated"]);
  assertEquals(evts[0].contract_reason, "Lapsed");
});

Deno.test("no event when contract code is unchanged", () => {
  const prior: PriorState = { contract_code: "A", at_risk_fired_at: null };
  const evts = computeLifecycleEvents(policy({ contract_code: "A" }), prior, NOW);
  assertEquals(evts.length, 0);
});

// ---- at-risk derivation ----

// ---- at-risk derivation: active + DIR + paid_to_date < today ----

Deno.test("at-risk: active + DIR + paid_to_date in the past is at risk", () => {
  assertEquals(deriveAtRisk(policy({ paid_to_date: "2026-06-01" }), NOW), true);
});

Deno.test("at-risk: paid_to_date today is NOT at risk (must be strictly past)", () => {
  assertEquals(deriveAtRisk(policy({ paid_to_date: "2026-06-30" }), NOW), false);
});

Deno.test("at-risk: paid_to_date in the future is NOT at risk", () => {
  assertEquals(deriveAtRisk(policy({ paid_to_date: "2026-07-05" }), NOW), false);
});

Deno.test("at-risk: null paid_to_date is NOT at risk (not evaluable)", () => {
  assertEquals(deriveAtRisk(policy({ paid_to_date: null }), NOW), false);
});

Deno.test("at-risk: pending (P / submission status) never fires at-risk", () => {
  assertEquals(deriveAtRisk(policy({ contract_code: "P" }), NOW), false);
});

Deno.test("at-risk: terminated / suspended are out of scope", () => {
  assertEquals(deriveAtRisk(policy({ contract_code: "T" }), NOW), false);
  assertEquals(deriveAtRisk(policy({ contract_code: "S" }), NOW), false);
});

Deno.test("at-risk: billing_mode no longer matters (quarterly DIR past-due is at risk)", () => {
  assertEquals(deriveAtRisk(policy({ billing_mode: "3", paid_to_date: "2026-06-01" }), NOW), true);
});

Deno.test("at-risk: PAC (auto-draft) is out of scope", () => {
  assertEquals(deriveAtRisk(policy({ billing_form: "PAC" }), NOW), false);
});

Deno.test("at-risk: effective date is irrelevant now (old policy past-due still at risk)", () => {
  assertEquals(deriveAtRisk(policy({ policy_effective_date: "2026-03-01", paid_to_date: "2026-06-01" }), NOW), true);
});

// ---- at-risk flip-true / recovery ----

Deno.test("evaluateAtRisk fires + sets flag on flip-true", () => {
  const d = evaluateAtRisk(policy(), { contract_code: "A", at_risk_fired_at: null }, NOW);
  assertEquals(d.fire, true);
  assertEquals(d.setFlag, true);
  assertEquals(d.event?.trigger, "at risk");
  assertEquals(d.event?.risk_signal, "active-dir-paid-to-date-past-due");
});

Deno.test("evaluateAtRisk does NOT re-fire when already flagged", () => {
  const d = evaluateAtRisk(
    policy(),
    { contract_code: "A", at_risk_fired_at: "2026-06-15T00:00:00Z" },
    NOW,
  );
  assertEquals(d.fire, false);
  assertEquals(d.setFlag, false);
  assertEquals(d.clearFlag, false);
});

Deno.test("evaluateAtRisk clears flag when policy recovers", () => {
  const recovered = policy({ paid_to_date: "2026-07-10" });
  const d = evaluateAtRisk(
    recovered,
    { contract_code: "A", at_risk_fired_at: "2026-06-15T00:00:00Z" },
    NOW,
  );
  assertEquals(d.fire, false);
  assertEquals(d.clearFlag, true);
});
