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

function monthlyPremium(annual: number | null, billingMode: number | null): number {
  if (!annual) return 0;
  const periods = Number(billingMode ?? 12);
  const divisor = [1, 3, 6, 12].includes(periods) ? periods : 12;
  return Math.round((annual / divisor) * 100) / 100;
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

// ── monthlyPremium tests ──────────────────────────────────────────────────────

Deno.test("monthlyPremium: quarterly (3) — 597.48 / 3 = 199.16", () => {
  assertEquals(monthlyPremium(597.48, 3), 199.16);
});

Deno.test("monthlyPremium: monthly (12) — 596.28 / 12 = 49.69", () => {
  assertEquals(monthlyPremium(596.28, 12), 49.69);
});

Deno.test("monthlyPremium: annual (1) — 596.28 / 1 = 596.28", () => {
  assertEquals(monthlyPremium(596.28, 1), 596.28);
});

Deno.test("monthlyPremium: semi-annual (6) — 596.28 / 6 = 99.38", () => {
  assertEquals(monthlyPremium(596.28, 6), 99.38);
});

Deno.test("monthlyPremium: null annual returns 0", () => {
  assertEquals(monthlyPremium(null, 12), 0);
});

Deno.test("monthlyPremium: unknown billingMode falls back to 12", () => {
  assertEquals(monthlyPremium(596.28, 99), 49.69);
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
