/**
 * plan-mapping.test.ts — Unit tests for plan-mapping.ts
 *
 * Run with: deno test docs/migration-mockup/plan-mapping.test.ts
 *
 * Test categories:
 *   1. derivePlanType — 8 spec-required cases (Charlie 2026-07-17)
 *   2. derivePlanType — edge cases + order-dependency proofs
 *   3. PLAN_NAME_MAP — every code checked; known drift codes listed explicitly
 *   4. resolvePlanName — direct + state-suffix variants
 *   5. resolvePlan — combined lookup
 *
 * DRIFT NOTES (do not fix here — fix in canonical lifecycle-evaluator.ts):
 *   derivePlanType() is the canonical function from lifecycle-evaluator.ts.
 *   It operates on keyword patterns in the plan NAME string, not plan codes.
 *   When passed a raw plan_code (no name resolution), several codes return
 *   Unknown because the code string doesn't match any keyword pattern:
 *
 *   UCSIA / UCSIB / UCSIC → Unknown  (expected: Cancer)
 *     Pattern CANCER|UNCAN|\bCAN\b doesn't match "UCSIA"/"UCSIB"/"UCSIC".
 *     The code prefix "UCS" is not in the pattern. Passes correctly via name:
 *     "Original Cancer Individual Plan A" → Cancer ✅
 *
 *   UDV17 / UDV18 → Unknown  (expected: DV)
 *     Pattern DENTAL|VISION|\bDV\b|UDN|UDEN doesn't match "UDV17"/"UDV18".
 *     "UDV" prefix is not in the DV pattern (only UDN/UDEN are). Passes
 *     correctly via name: "Dental Vision" → DV ✅
 *
 *   UNFEL → Unknown  (expected: Life)
 *     Pattern LIFE|FINAL EXPENSE|\bFEX\b|UNFEX doesn't match "UNFEL".
 *     UNFEL ≠ UNFEX. Passes correctly via name:
 *     "Final Expense Shield - Life" → Life ✅
 *
 *   UIHHC → HHC via code ✅ but → Unknown via name ("Caregiver Shield")
 *     Pattern HHC|HOME HEALTH doesn't match "Caregiver Shield". Code matches
 *     HHC substring directly. Name-based resolution is incomplete for this code.
 *
 *   ROOT CAUSE: derivePlanType() was designed to receive the plan *name* from
 *   form_submissions (e.g. "Home Health Care Shield with TCARE benefit"), not
 *   the raw plan_code from Max's DB. Now that Max's DB is the source, the
 *   function needs updating to handle raw codes — or a pre-resolution step
 *   (resolvePlanName → derivePlanType) should be the standard call pattern.
 *
 *   RECOMMENDED FIX (for lifecycle-evaluator.ts, not here):
 *     Add UCS[ABC], UDV, UNFEL to their respective regex branches, OR
 *     accept that the function requires a resolved name and enforce that
 *     resolvePlan() is always called rather than derivePlanType() directly.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  derivePlanType,
  planCodeToType,
  resolvePlan,
  resolvePlanName,
  PLAN_NAME_MAP,
  type PlanType,
} from "./plan-mapping.ts";

// ---------------------------------------------------------------------------
// 1. Spec-required assertions (Charlie 2026-07-17)
//    These all pass — the 8 spec codes work correctly with derivePlanType().
// ---------------------------------------------------------------------------

Deno.test("spec: UTHHC → HHC", () => {
  assertEquals(derivePlanType("UTHHC"), "HHC");
});

Deno.test("spec: UTHHC evaluated before HI — HHC branch fires before HIP", () => {
  // Proves order: HHC branch is checked before HIP.
  assertEquals(derivePlanType("UTHHC"), "HHC");
  assertEquals(derivePlanType("Home Health Care Shield with TCARE benefit"), "HHC");
  // Combined: HHC wins over HIP substring
  assertEquals(derivePlanType("HHC HIP"), "HHC");
  assertEquals(derivePlanType("Home Health Care Hospital Indemnity"), "HHC");
});

Deno.test("spec: UHIP2 → HIP", () => {
  assertEquals(derivePlanType("UHIP2"), "HIP");
});

Deno.test("spec: UGHIP → HIP", () => {
  assertEquals(derivePlanType("UGHIP"), "HIP");
});

Deno.test("spec: UFGHI → HIP", () => {
  assertEquals(derivePlanType("UFGHI"), "HIP");
});

Deno.test("spec: UDN24 → DV", () => {
  assertEquals(derivePlanType("UDN24"), "DV");
});

Deno.test("spec: UNCAN → Cancer", () => {
  assertEquals(derivePlanType("UNCAN"), "Cancer");
});

Deno.test("spec: UNFEX → Life", () => {
  assertEquals(derivePlanType("UNFEX"), "Life");
});

Deno.test("spec: unmapped code → Unknown", () => {
  assertEquals(derivePlanType("XXXXXXX"), "Unknown");
  assertEquals(derivePlanType(""), "Unknown");
  assertEquals(derivePlanType(null), "Unknown");
});

// ---------------------------------------------------------------------------
// 2. Edge cases + order-dependency proofs
// ---------------------------------------------------------------------------

Deno.test("order: Cancer before Life — UNCAN doesn't bleed into Life", () => {
  assertEquals(derivePlanType("UNCAN"), "Cancer");
});

Deno.test("order: Life before HIP — UNFEX classed as Life not HIP (life rider on HI base)", () => {
  assertEquals(derivePlanType("UNFEX"), "Life");
  assertEquals(derivePlanType("Optional GI $5k Life on Hosp Indem Shield"), "Life");
});

Deno.test("order: HHC before HIP — Home Health wins if combined", () => {
  assertEquals(derivePlanType("HHC HIP"), "HHC");
  assertEquals(derivePlanType("Home Health Care Hospital Indemnity"), "HHC");
});

Deno.test("order: DV before HIP — UDN codes resolve as DV not HIP", () => {
  // UDN prefix IS in the DV pattern; these pass.
  assertEquals(derivePlanType("UDN21"), "DV");
  assertEquals(derivePlanType("UDN24"), "DV");
  // NOTE: UDV17/UDV18 are NOT matched by the DV pattern — see DRIFT NOTES above.
  // They are tested separately below under known-drift codes.
});

Deno.test("case-insensitive: lowercase codes", () => {
  assertEquals(derivePlanType("uthhc"), "HHC");
  assertEquals(derivePlanType("uhip2"), "HIP");
  assertEquals(derivePlanType("uncan"), "Cancer");
  assertEquals(derivePlanType("unfex"), "Life");
  assertEquals(derivePlanType("udn24"), "DV");
});

// State-suffix codes that DO match in derivePlanType():
Deno.test("state-suffix: UTHHC OH → HHC", () => {
  assertEquals(derivePlanType("UTHHC OH"), "HHC");
});
Deno.test("state-suffix: UHIP2 MI → HIP", () => {
  assertEquals(derivePlanType("UHIP2 MI"), "HIP");
});
Deno.test("state-suffix: UNHIP IL → HIP", () => {
  assertEquals(derivePlanType("UNHIP IL"), "HIP");
});
Deno.test("state-suffix: UNHHC KY → HHC", () => {
  assertEquals(derivePlanType("UNHHC KY"), "HHC");
});
Deno.test("state-suffix: UDN24 PA → DV", () => {
  assertEquals(derivePlanType("UDN24 PA"), "DV");
});

// UNFEL TX: UNFEL is a known-drift code → Unknown via derivePlanType (see DRIFT NOTES).
// Via plan name it resolves correctly.
Deno.test("state-suffix: UNFEL TX → Unknown via code (DRIFT — see notes), Life via name", () => {
  assertEquals(derivePlanType("UNFEL TX"), "Unknown"); // canonical behavior
  assertEquals(derivePlanType("Final Expense Shield - Life"), "Life"); // via resolved name ✅
});

Deno.test("planCodeToType: delegates to derivePlanType", () => {
  assertEquals(planCodeToType("UTHHC"), "HHC");
  assertEquals(planCodeToType("UHIP2"), "HIP");
  assertEquals(planCodeToType(null), "Unknown");
});

// ---------------------------------------------------------------------------
// 3. PLAN_NAME_MAP coverage — known-drift codes explicitly asserted
//
//    Per the spec: "if any don't resolve, list them in the PR, don't fix silently."
//    These tests assert the *canonical* behavior (Unknown) and document the drift.
//    The fix belongs in lifecycle-evaluator.ts, not here.
// ---------------------------------------------------------------------------

// Codes that resolve correctly via code string:
const RESOLVES_CORRECTLY: Array<[string, PlanType]> = [
  ["UHIP2",  "HIP"],
  ["UNHIP",  "HIP"],
  ["UGHIP",  "HIP"],
  ["UFHIP",  "HIP"],
  ["UFGHI",  "HIP"],
  ["UTHHC",  "HHC"],
  ["UNHHC",  "HHC"],
  ["UIHHC",  "HHC"],  // HHC substring in code ✅ (but name "Caregiver Shield" is also drift — see below)
  ["UNCAN",  "Cancer"],
  ["UDN21",  "DV"],
  ["UDN24",  "DV"],
  ["UNFEX",  "Life"],
];

for (const [code, expected] of RESOLVES_CORRECTLY) {
  Deno.test(`lookup: ${code} → ${expected} via code (correct)`, () => {
    assertEquals(derivePlanType(code), expected);
  });
}

// Known-drift codes: canonical function returns Unknown for the raw code.
// These MUST be resolved via resolvePlanName() before calling derivePlanType().
const DRIFT_CODES: Array<[string, PlanType, string]> = [
  ["UCSIA", "Unknown", "Cancer"],  // UCS prefix not in Cancer pattern
  ["UCSIB", "Unknown", "Cancer"],
  ["UCSIC", "Unknown", "Cancer"],
  ["UDV17", "Unknown", "DV"],      // UDV prefix not in DV pattern (only UDN/UDEN)
  ["UDV18", "Unknown", "DV"],
  ["UNFEL", "Unknown", "Life"],    // UNFEL ≠ UNFEX; not in Life pattern
];

for (const [code, canonicalResult, expectedIfFixed] of DRIFT_CODES) {
  Deno.test(`DRIFT: ${code} → ${canonicalResult} via code (expected ${expectedIfFixed} — fix in lifecycle-evaluator.ts)`, () => {
    // Asserting canonical behavior, not desired behavior.
    // Fix: add ${code} pattern to derivePlanType() in lifecycle-evaluator.ts.
    assertEquals(
      derivePlanType(code),
      canonicalResult,
      `${code} should return ${canonicalResult} from canonical derivePlanType() — desired is ${expectedIfFixed}, requires fix in lifecycle-evaluator.ts`,
    );
  });
}

// Additional drift: UIHHC code → HHC ✅ but name "Caregiver Shield" → Unknown
Deno.test("DRIFT: UIHHC name 'Caregiver Shield' → Unknown (HHC/HOME HEALTH not in name)", () => {
  assertEquals(derivePlanType("Caregiver Shield"), "Unknown");
  // Correct path: use the code, not the name
  assertEquals(derivePlanType("UIHHC"), "HHC"); // code works fine
});

// Verify drift codes resolve correctly via their plan names (name-based path works)
Deno.test("drift codes resolve correctly via plan name (name-based path is safe)", () => {
  assertEquals(derivePlanType("Original Cancer Individual Plan A"), "Cancer"); // UCSIA
  assertEquals(derivePlanType("Original Cancer Individual Plan B"), "Cancer"); // UCSIB
  assertEquals(derivePlanType("Original Cancer Individual Plan C"), "Cancer"); // UCSIC
  assertEquals(derivePlanType("Dental Vision"), "DV");                         // UDV17/18
  assertEquals(derivePlanType("Final Expense Shield - Life"), "Life");          // UNFEL
});

// ---------------------------------------------------------------------------
// 4. resolvePlanName
// ---------------------------------------------------------------------------

Deno.test("resolvePlanName: direct match", () => {
  assertEquals(resolvePlanName("UTHHC"), "Home Health Care Shield with TCARE benefit");
  assertEquals(resolvePlanName("UHIP2"), "Hospital Indemnity Shield 2.0");
  assertEquals(resolvePlanName("UNCAN"), "Cancer Shield 2.0");
  assertEquals(resolvePlanName("UNFEX"), "Optional GI $5k Life on Hosp Indem Shield");
  assertEquals(resolvePlanName("UDN24"), "Dental Shield 2.0 w/ waiting period waiver");
  assertEquals(resolvePlanName("UCSIA"), "Original Cancer Individual Plan A");
  assertEquals(resolvePlanName("UNFEL"), "Final Expense Shield - Life");
  assertEquals(resolvePlanName("UDV17"), "Dental Vision");
  assertEquals(resolvePlanName("UDV18"), "Dental Vision");
});

Deno.test("resolvePlanName: state-suffix variant strips suffix", () => {
  assertEquals(resolvePlanName("UTHHC OH"), "Home Health Care Shield with TCARE benefit");
  assertEquals(resolvePlanName("UHIP2 MI"), "Hospital Indemnity Shield 2.0");
  assertEquals(resolvePlanName("UNHHC KY"), "Original Home Health Care Shield");
  assertEquals(resolvePlanName("UDN24 PA"), "Dental Shield 2.0 w/ waiting period waiver");
  assertEquals(resolvePlanName("UNFEL TX"), "Final Expense Shield - Life");
  assertEquals(resolvePlanName("UNFEX TX"), "Optional GI $5k Life on Hosp Indem Shield");
});

Deno.test("resolvePlanName: null / empty → null", () => {
  assertEquals(resolvePlanName(null), null);
  assertEquals(resolvePlanName(""), null);
});

Deno.test("resolvePlanName: unmapped code → null", () => {
  assertEquals(resolvePlanName("XXXXXXX"), null);
});

Deno.test("resolvePlanName: case-insensitive", () => {
  assertEquals(resolvePlanName("uthhc"), "Home Health Care Shield with TCARE benefit");
  assertEquals(resolvePlanName("uhip2"), "Hospital Indemnity Shield 2.0");
});

// ---------------------------------------------------------------------------
// 5. resolvePlan — combined
// ---------------------------------------------------------------------------

Deno.test("resolvePlan: UTHHC → name + HHC", () => {
  assertEquals(resolvePlan("UTHHC"), {
    planName: "Home Health Care Shield with TCARE benefit",
    planType: "HHC",
  });
});

Deno.test("resolvePlan: UHIP2 → name + HIP", () => {
  assertEquals(resolvePlan("UHIP2"), {
    planName: "Hospital Indemnity Shield 2.0",
    planType: "HIP",
  });
});

Deno.test("resolvePlan: UNCAN → name + Cancer", () => {
  assertEquals(resolvePlan("UNCAN"), {
    planName: "Cancer Shield 2.0",
    planType: "Cancer",
  });
});

Deno.test("resolvePlan: UNFEX → name + Life", () => {
  assertEquals(resolvePlan("UNFEX"), {
    planName: "Optional GI $5k Life on Hosp Indem Shield",
    planType: "Life",
  });
});

Deno.test("resolvePlan: UTHHC OH (state suffix) → name + HHC", () => {
  assertEquals(resolvePlan("UTHHC OH"), {
    planName: "Home Health Care Shield with TCARE benefit",
    planType: "HHC",
  });
});

// Drift codes via resolvePlan — planType uses derivePlanType(code), so drift shows here too.
// The note: callers should use resolvePlanName() + derivePlanType(name) for drift codes.
Deno.test("resolvePlan: UCSIA → name resolved, planType = Unknown (DRIFT)", () => {
  assertEquals(resolvePlan("UCSIA"), {
    planName: "Original Cancer Individual Plan A",
    planType: "Unknown", // drift — fix in lifecycle-evaluator.ts
  });
});

Deno.test("resolvePlan: UNFEL → name resolved, planType = Unknown (DRIFT)", () => {
  assertEquals(resolvePlan("UNFEL"), {
    planName: "Final Expense Shield - Life",
    planType: "Unknown", // drift — fix in lifecycle-evaluator.ts
  });
});

Deno.test("resolvePlan: UDV17 → name resolved, planType = Unknown (DRIFT)", () => {
  assertEquals(resolvePlan("UDV17"), {
    planName: "Dental Vision",
    planType: "Unknown", // drift — fix in lifecycle-evaluator.ts
  });
});

Deno.test("resolvePlan: unmapped code → null name + Unknown type", () => {
  assertEquals(resolvePlan("XXXXXXX"), {
    planName: null,
    planType: "Unknown",
  });
});

Deno.test("resolvePlan: null → null name + Unknown type", () => {
  assertEquals(resolvePlan(null), {
    planName: null,
    planType: "Unknown",
  });
});
