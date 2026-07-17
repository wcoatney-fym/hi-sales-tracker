/**
 * agency-map.test.ts — Unit tests for titleCase + resolveAgencyName
 *
 * Run: deno test supabase/functions/_shared/agency-map.test.ts
 */

import { assertEquals } from "jsr:@std/assert";
import { titleCase, resolveAgencyName, type AgencyMap } from "./agency-map.ts";

// ---------------------------------------------------------------------------
// titleCase
// ---------------------------------------------------------------------------

Deno.test("titleCase — basic all-caps", () => {
  assertEquals(titleCase("GUARDIAN BENEFITS INC"), "Guardian Benefits Inc");
});

Deno.test("titleCase — abbreviation preservation (LLC, DH, II)", () => {
  assertEquals(titleCase("DH INSURANCE GROUP LLC"), "DH Insurance Group LLC");
});

Deno.test("titleCase — mixed case normalizes correctly", () => {
  assertEquals(titleCase("american senior health and life LLC"), "American Senior Health And Life LLC");
});

Deno.test("titleCase — single word", () => {
  assertEquals(titleCase("HIGHLAND"), "Highland");
});

Deno.test("titleCase — already title case is stable", () => {
  assertEquals(titleCase("Providence Group"), "Providence Group");
});

Deno.test("titleCase — empty string", () => {
  assertEquals(titleCase(""), "");
});

Deno.test("titleCase — extra whitespace is trimmed/collapsed", () => {
  assertEquals(titleCase("  GUIDE TO INSURE   LLC  "), "Guide To Insure LLC");
});

Deno.test("titleCase — short all-caps token at start", () => {
  assertEquals(titleCase("DH INSURANCE"), "DH Insurance");
});

Deno.test("titleCase — III suffix preserved", () => {
  assertEquals(titleCase("JOHN SMITH III"), "John Smith III");
});

Deno.test("titleCase — period in abbreviation (INC.)", () => {
  // INC not in KEEP_CAPS (reads fine as Inc); period reattached after title-case
  assertEquals(titleCase("STEEL CITY FINANCIAL SERVICES INC."), "Steel City Financial Services Inc.");
});

// ---------------------------------------------------------------------------
// resolveAgencyName — primary path (writing number match)
// ---------------------------------------------------------------------------

function makeMap(entries: Array<[string, string]>): AgencyMap {
  return new Map(entries);
}

Deno.test("resolveAgencyName — primary: wa matches map", () => {
  const map = makeMap([["202LAX00", "Guardian Benefits Inc"]]);
  assertEquals(
    resolveAgencyName(map, "202LAX00", "GUARDIAN BENEFITS INC"),
    "Guardian Benefits Inc",
  );
});

Deno.test("resolveAgencyName — primary: wa normalized UPPER-trim", () => {
  const map = makeMap([["202LAX00", "Guardian Benefits Inc"]]);
  assertEquals(
    resolveAgencyName(map, "  202lax00  ", "GUARDIAN BENEFITS INC"),
    "Guardian Benefits Inc",
  );
});

Deno.test("resolveAgencyName — primary: returns canonical over ga_name even if ga_name differs", () => {
  const map = makeMap([["202ABC00", "DH Insurance Group"]]);
  assertEquals(
    resolveAgencyName(map, "202ABC00", "DH INSURANCE GROUP LLC"),
    "DH Insurance Group",
  );
});

// ---------------------------------------------------------------------------
// resolveAgencyName — fallback path (no writing number match)
// ---------------------------------------------------------------------------

Deno.test("resolveAgencyName — fallback: no wa match → titleCase(ga_name)", () => {
  const map = makeMap([]);
  // AND/LIFE are not in KEEP_CAPS, so they title-case; LLC is preserved
  assertEquals(
    resolveAgencyName(map, "202XYZ99", "AMERICAN SENIOR HEALTH AND LIFE LLC"),
    "American Senior Health And Life LLC",
  );
});

Deno.test("resolveAgencyName — fallback: null wa → titleCase(ga_name)", () => {
  const map = makeMap([["202LAX00", "Guardian Benefits Inc"]]);
  assertEquals(
    resolveAgencyName(map, null, "HIGHLAND HEALTH DIRECT  LLC"),
    "Highland Health Direct LLC",
  );
});

Deno.test("resolveAgencyName — fallback: empty wa → titleCase(ga_name)", () => {
  const map = makeMap([["202LAX00", "Guardian Benefits Inc"]]);
  assertEquals(
    resolveAgencyName(map, "", "MEDICARE HEALTH ADVISORS"),
    "Medicare Health Advisors",
  );
});

Deno.test("resolveAgencyName — both null → empty string", () => {
  const map = makeMap([]);
  assertEquals(resolveAgencyName(map, null, null), "");
});

Deno.test("resolveAgencyName — fallback preserves LLC abbreviation", () => {
  const map = makeMap([]);
  assertEquals(
    resolveAgencyName(map, "NOMATCH", "GUIDE TO INSURE  LLC"),
    "Guide To Insure LLC", // TO title-cases; LLC stays caps
  );
});

Deno.test("resolveAgencyName — fallback normalizes trailing whitespace in ga_name", () => {
  const map = makeMap([]);
  assertEquals(
    resolveAgencyName(map, "NOMATCH", "SILVER CARE ADVISORS  LLC  "),
    "Silver Care Advisors LLC",
  );
});
