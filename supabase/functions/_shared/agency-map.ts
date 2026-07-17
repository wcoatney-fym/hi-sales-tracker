/**
 * agency-map.ts — Agency name resolution for GHL payloads.
 *
 * Problem:
 *   Max's DB (typed.unl_fym_policy_latest_load) stores `ga_name` as ALL-CAPS
 *   display strings (e.g. "GUARDIAN BENEFITS INC"). The tracker's `agencies`
 *   table uses Title Case canonical names (e.g. "Guardian Benefits Inc").
 *   Direct string comparison of ga_name → agencies.name fails for every row.
 *
 * Solution:
 *   Join on writing number, not name:
 *     wa (from Max's DB, UPPER-trim normalized)
 *       → agency_writing_numbers.writing_number
 *       → agencies.id → agencies.name   ← Title Case canonical
 *       → contact.ancillary_agency__sorting
 *
 *   If no writing-number match exists, fall back to titleCase(ga_name) so the
 *   value is at least consistently cased rather than ALL-CAPS in GHL.
 *
 * Usage:
 *   const agencyMap = await buildAgencyMap(supabase);
 *   const agencyName = resolveAgencyName(agencyMap, row.wa, row.ga_name);
 *
 * Build once per cron run at startup, alongside the NPN map. Cheap — the
 * agency_writing_numbers table is small.
 */

// deno-lint-ignore-file no-explicit-any
// Using `any` for the SupabaseClient type so this module can be imported
// without the full Supabase package in test environments.
type SupabaseClient = any;

// ---------------------------------------------------------------------------
// titleCase — shared utility
// Converts ALL-CAPS or mixed-case strings to Title Case.
// Preserves short all-caps tokens (≤3 chars) as-is: LLC, DH, II, III, etc.
// ---------------------------------------------------------------------------
// Known all-caps abbreviations that must be preserved exactly as-is.
// Short common words (AND, TO, OF, THE, IN, AT, etc.) are NOT in this list
// — they get title-cased like everything else.
// Known all-caps abbreviations that must be preserved exactly as-is.
// Rule: only true acronyms/initials that would look wrong title-cased.
// "INC", "CO" are excluded — they read fine as "Inc", "Co".
const KEEP_CAPS = new Set([
  "LLC", "LLP", "DBA", "PC", "PLC", "PLLC",
  "II", "III", "IV",
  "DH", "FYM", "UNL", "USA", "US",
]);

export function titleCase(s: string): string {
  if (!s) return "";
  return s
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      // Strip trailing period to check the root (e.g. "INC." → check "INC")
      const bare = w.replace(/\.$/, "").toUpperCase();
      if (KEEP_CAPS.has(bare)) {
        // Reattach any trailing period ("INC." stays "INC.")
        return bare + (w.endsWith(".") ? "." : "");
      }
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

// ---------------------------------------------------------------------------
// AgencyMap — keyed by UPPER-trim writing number → canonical agency name
// ---------------------------------------------------------------------------
export type AgencyMap = Map<string, string>; // writing_number_upper → agencies.name

/**
 * Build the agency map from Supabase.
 *
 * Joins agency_writing_numbers → agencies to produce:
 *   writing_number (UPPER-trim) → agencies.name (Title Case, canonical)
 *
 * Handles the ALL-CAPS / Title-Case mismatch by always using agencies.name
 * from the tracker (canonical source of truth) rather than ga_name from
 * Max's DB.
 *
 * Logs a warning if any writing_number maps to an agency with a null/empty
 * name (signals a data gap in the tracker, not a code bug).
 */
export async function buildAgencyMap(
  supabase: SupabaseClient,
): Promise<AgencyMap> {
  const map: AgencyMap = new Map();

  // Fetch all agency_writing_numbers with joined agency name in one query.
  // PostgREST foreign-key embed: agency_writing_numbers.agency_id → agencies.id
  const { data, error } = await supabase
    .from("agency_writing_numbers")
    .select("writing_number, agencies(name)");

  if (error) {
    console.error("[agency-map] agency_writing_numbers fetch failed:", error.message);
    return map;
  }

  let missing = 0;
  for (const row of data ?? []) {
    const wn = ((row.writing_number as string) ?? "").trim().toUpperCase();
    if (!wn) continue;

    // PostgREST returns the joined row as an object (or null if no FK match).
    const agencyData = row.agencies as { name: string } | null;
    const name = (agencyData?.name ?? "").trim();

    if (!name) {
      missing++;
      continue; // skip — no usable name; resolver will fall back to ga_name
    }

    map.set(wn, name);
  }

  if (missing > 0) {
    console.warn(
      `[agency-map] ${missing} writing_number(s) in agency_writing_numbers have no agencies.name — check for orphaned rows`,
    );
  }

  console.log(`[agency-map] built: ${map.size} writing-number → agency-name mappings`);
  return map;
}

// ---------------------------------------------------------------------------
// resolveAgencyName
// Primary:  wa (writing number) → AgencyMap → agencies.name (canonical, Title Case)
// Fallback: titleCase(ga_name)  — used when wa has no entry in agency_writing_numbers
//           (signals a missing roster entry; logs a warning so it's trackable)
// ---------------------------------------------------------------------------
export function resolveAgencyName(
  agencyMap: AgencyMap,
  wa: string | null,
  ga_name: string | null,
): string {
  const normalizedWn = (wa ?? "").trim().toUpperCase();

  if (normalizedWn) {
    const canonical = agencyMap.get(normalizedWn);
    if (canonical) return canonical;

    // No match in agency_writing_numbers — warn and fall back
    console.warn(
      `[agency-map] no agency match for writing_number=${normalizedWn} ga_name="${ga_name ?? ""}" — falling back to titleCase(ga_name)`,
    );
  }

  // Fall back to title-cased ga_name so GHL at least gets consistent casing
  return titleCase(ga_name ?? "");
}
