/**
 * Unit tests for lifecycle-direct helper functions.
 * Run with: deno test supabase/functions/lifecycle-direct/index.test.ts
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// ── Inline the helpers under test (mirrors index.ts exactly) ─────────────────

function usDate(d: unknown): string {
  if (d === null || d === undefined || d === "") return "";
  const dt = d instanceof Date ? d : new Date(String(d));
  if (isNaN(dt.getTime())) return "";
  const mm   = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd   = String(dt.getUTCDate()).padStart(2, "0");
  const yyyy = String(dt.getUTCFullYear());
  return `${mm}/${dd}/${yyyy}`;
}

// billing_mode = months per payment period
// per_payment = annual x (mode / 12)
function perPaymentPremium(annual: number | null, billingMode: number | null): number {
  if (!annual) return 0;
  const mode = Number(billingMode ?? 1);
  const months = [1, 3, 6, 12].includes(mode) ? mode : 1;
  return Math.round(annual * (months / 12) * 100) / 100;
}

function titleCase(s: string): string {
  return s.split(/\s+/).filter(Boolean).map((w) => {
    const upper = w.toUpperCase();
    if (upper === w && w.length <= 3) return upper;
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(" ");
}

// ── usDate tests ──────────────────────────────────────────────────────────────

Deno.test("usDate: ISO string YYYY-MM-DD", () => {
  assertEquals(usDate("2026-07-14"), "07/14/2026");
});

Deno.test("usDate: Postgres Date object", () => {
  assertEquals(usDate(new Date("2026-06-25T00:00:00.000Z")), "06/25/2026");
});

Deno.test("usDate: null returns empty string", () => {
  assertEquals(usDate(null), "");
});

Deno.test("usDate: undefined returns empty string", () => {
  assertEquals(usDate(undefined), "");
});

Deno.test("usDate: invalid string returns empty string", () => {
  assertEquals(usDate("not-a-date"), "");
});

// ── perPaymentPremium tests ───────────────────────────────────────────────────
// Rule: per_payment = annual x (mode / 12)
// mode = months per payment period (1=monthly, 3=quarterly, 6=semi-annual, 12=annual)

Deno.test("perPaymentPremium: mode 1 (monthly) - Clarareesa Peay: 712 x 1/12 = 59.33", () => {
  assertEquals(perPaymentPremium(712, 1), 59.33);
});

Deno.test("perPaymentPremium: mode 3 (quarterly) - Karen Cauthen: 597.54 x 3/12 = 149.39", () => {
  assertEquals(perPaymentPremium(597.54, 3), 149.39);
});

Deno.test("perPaymentPremium: mode 6 (semi-annual) - 372.90 x 6/12 = 186.45", () => {
  assertEquals(perPaymentPremium(372.90, 6), 186.45);
});

Deno.test("perPaymentPremium: mode 12 (annual) - Jeffrey Garrett: 164 x 12/12 = 164", () => {
  assertEquals(perPaymentPremium(164, 12), 164);
});

Deno.test("perPaymentPremium: null annual returns 0", () => {
  assertEquals(perPaymentPremium(null, 3), 0);
});

Deno.test("perPaymentPremium: unknown billingMode falls back to mode 1 (monthly)", () => {
  assertEquals(perPaymentPremium(712, 99), 59.33);
});

// ── titleCase tests ───────────────────────────────────────────────────────────

Deno.test("titleCase: all-caps abbreviation DH preserved", () => {
  assertEquals(titleCase("DH INSURANCE GROUP"), "DH Insurance Group");
});

Deno.test("titleCase: LLC preserved", () => {
  assertEquals(titleCase("BWL INSURANCE II LLC"), "BWL Insurance II LLC");
});

Deno.test("titleCase: normal name", () => {
  assertEquals(titleCase("KAREN CAUTHEN"), "Karen Cauthen");
});

Deno.test("titleCase: mixed case input", () => {
  assertEquals(titleCase("ANTONIO NOVIELLI"), "Antonio Novielli");
});
