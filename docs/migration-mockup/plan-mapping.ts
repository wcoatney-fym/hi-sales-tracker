/**
 * plan-mapping.ts — Plan code → plan name lookup + product type derivation
 *
 * Part of the Max DB → GHL migration mockup.
 * Source: Charlie's plan list (2026-07-17) + prod plan_codes from
 *         typed.unl_fym_policy_latest_load (queried 2026-07-17).
 *
 * derivePlanType() is copied verbatim from:
 *   supabase/functions/sql-import-cron/lifecycle-evaluator.ts
 * Any drift from that canonical implementation is flagged in the PR description
 * rather than silently reconciled here.
 */

// ---------------------------------------------------------------------------
// Plan name lookup — plan_code → human-readable plan name
// ---------------------------------------------------------------------------
// Covers all codes Charlie specified. Prod codes not in this map are flagged
// in docs/migration-mockup/prod-plan-codes.md.
// State-suffix variants (e.g. "UTHHC OH", "UHIP2 MI") share the base plan
// name — strip the suffix before lookup (see resolvePlanName below).

export const PLAN_NAME_MAP: Record<string, string> = {
  // Hospital Indemnity
  UHIP2: "Hospital Indemnity Shield 2.0",
  UNHIP: "Original Hospital Indemnity Shield",
  UGHIP: "Guaranteed Issue Hospital Indemnity Shield",
  UFHIP: "Hospital Indemnity Shield 2.0 - FL with Assoc.",
  UFGHI: "Guaranteed Issue Hospital Indemnity Shield - FL with Assoc.",

  // Home Health Care
  UTHHC: "Home Health Care Shield with TCARE benefit",
  UNHHC: "Original Home Health Care Shield",
  UIHHC: "Caregiver Shield",

  // Cancer
  UNCAN: "Cancer Shield 2.0",
  UCSIA: "Original Cancer Individual Plan A",
  UCSIB: "Original Cancer Individual Plan B",
  UCSIC: "Original Cancer Individual Plan C",

  // Dental / Vision
  UDN21: "Dental Shield 2.0",
  UDN24: "Dental Shield 2.0 w/ waiting period waiver",
  UDV17: "Dental Vision",
  UDV18: "Dental Vision",

  // Life / Final Expense
  UNFEL: "Final Expense Shield - Life",
  UNFEX: "Optional GI $5k Life on Hosp Indem Shield",
};

/**
 * Resolve a plan_code (possibly with a state suffix like "UTHHC OH") to its
 * human-readable plan name. Returns null if the code is not in the lookup.
 *
 * State suffixes in prod follow the pattern "<BASE_CODE> <2-CHAR-STATE>".
 * Strip the suffix and look up the base code.
 */
export function resolvePlanName(planCode: string | null): string | null {
  if (!planCode) return null;
  const raw = planCode.trim().toUpperCase();

  // Direct match first
  if (PLAN_NAME_MAP[raw]) return PLAN_NAME_MAP[raw];

  // Strip trailing state suffix (e.g. " OH", " MI", " KY", " PA", " TX", " FL", " AR", " WI")
  const withoutSuffix = raw.replace(/\s+[A-Z]{2}$/, "");
  return PLAN_NAME_MAP[withoutSuffix] ?? null;
}

// ---------------------------------------------------------------------------
// Product type — plan_code → GHL LOB bucket
// ---------------------------------------------------------------------------
// PlanType values must match the GHL field key prefix:
//   HIP  → hip__*  fields
//   HHC  → hhc__*  fields
//   DV   → dv__*   fields (Dental/Vision)
//   Cancer / Life / Unknown — no LOB push currently; contact.* fields only

export type PlanType = "HHC" | "HIP" | "Life" | "DV" | "Cancer" | "Unknown";

/**
 * Classify a plan_code (or plan name string) into the GHL LOB bucket.
 *
 * COPIED VERBATIM from:
 *   supabase/functions/sql-import-cron/lifecycle-evaluator.ts @ derivePlanType()
 *
 * Do NOT modify this function to resolve drift — flag drift in the PR instead.
 * The canonical source is lifecycle-evaluator.ts; this copy must stay in sync.
 *
 * Order matters: more-specific / higher-priority buckets are matched first so
 * a combined descriptor (e.g. a Life rider "...offered on Hosp Indem Shield")
 * lands in Life, not HIP.
 *
 * Drift vs spec (Charlie 2026-07-17): NONE — canonical implementation matches
 * the specified order exactly. See PR description for full diff notes.
 */
export function derivePlanType(planName: string | null): PlanType {
  const s = (planName || "").toUpperCase();
  if (!s.trim()) return "Unknown";

  // 1. Cancer
  if (/CANCER|UNCAN|\bCAN\b/.test(s)) return "Cancer";
  // 2. Life / Final Expense (matched before HI so a life rider written on a
  //    hospital-indemnity base is classed as Life)
  if (/LIFE|FINAL EXPENSE|\bFEX\b|UNFEX/.test(s)) return "Life";
  // 3. Dental / Vision
  if (/DENTAL|VISION|\bDV\b|UDN|UDEN/.test(s)) return "DV";
  // 4. Home Health Care (before HI so "HHC + HI" combos class as HHC)
  if (/HHC|HOME HEALTH/.test(s)) return "HHC";
  // 5. Hospital Indemnity
  if (/HOSPITAL INDEMNITY|HIP|GHI|\bHI\b/.test(s)) return "HIP";

  return "Unknown";
}

/**
 * Convenience: resolve plan_code → PlanType in one call.
 * Passes the plan_code string directly to derivePlanType (which uppercases it).
 * Does NOT use the plan name lookup — derivePlanType operates on the raw code
 * string and its keyword patterns match the codes directly.
 */
export function planCodeToType(planCode: string | null): PlanType {
  return derivePlanType(planCode);
}

/**
 * Full resolution: plan_code → { planName, planType }
 * planName is null if the code isn't in PLAN_NAME_MAP (including suffixed variants).
 */
export function resolvePlan(planCode: string | null): {
  planName: string | null;
  planType: PlanType;
} {
  return {
    planName: resolvePlanName(planCode),
    planType: planCodeToType(planCode),
  };
}
