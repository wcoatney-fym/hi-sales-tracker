/**
 * carrier-mapping.ts — Multi-carrier column normalization layer.
 *
 * Each carrier in Max's DB has its own typed table with different column names,
 * value conventions, and field semantics. This module maps carrier-specific
 * columns to a common normalized schema so downstream consumers (quality-metrics,
 * leaderboard, lifecycle triggers) work identically regardless of carrier.
 *
 * Architecture:
 *   Max's DB table → CarrierMapping → Normalized row
 *   typed.unl_fym_policy_latest_load  → UNL mapping  → { policy_number, issue_date, ... }
 *   typed.heartland_inforced_policy_latest → Heartland  → { policy_number, issue_date, ... }
 *   (future carriers follow the same pattern)
 *
 * Usage in SQL:
 *   Use carrierSelectClause(carrier) to get the SELECT expressions that remap
 *   carrier-specific columns to the normalized names. UNION ALL across carriers.
 *
 * Usage in code:
 *   Use normalizeRow(carrier, rawRow) to normalize a single row from any carrier
 *   table into the common shape.
 */

// ---------------------------------------------------------------------------
// Normalized policy shape — the common schema all carriers map into
// ---------------------------------------------------------------------------
export interface NormalizedPolicy {
  policy_number: string;
  issue_date: string | null;       // date the policy was issued / became effective
  app_recvd_date: string | null;   // application received / submitted date
  paid_to_date: string | null;     // how far premiums have been paid
  term_date: string | null;        // termination date (null = not terminated)
  billing_mode: number | null;     // 1=monthly, 3=quarterly, 6=semi, 12=annual; null if unavailable
  annual_premium: number | null;   // annual premium amount
  plan_code: string | null;        // carrier plan code or description
  product_type: string | null;     // derived: HHC, HI, HIP, etc.
  contract_code: string | null;    // normalized status code: P, A, T, S
  carrier: string;                 // carrier tag: 'UNL', 'Heartland', etc.
  // Agent/client fields
  agent_code: string | null;       // writing number or agent code
  agent_first_name: string | null;
  agent_last_name: string | null;
  client_first_name: string | null;
  client_last_name: string | null;
  client_phone: string | null;
  client_email: string | null;
  // Hierarchy / agency (carrier-specific; may need post-processing)
  upline_raw: string | null;       // raw upline value before agency resolution
  // At-risk signals
  at_risk: boolean;                // derived at-risk flag
  at_risk_reason: string | null;   // reason for at-risk (Heartland: return_descripton; UNL: risk_signal)
  chargeback_date: string | null;  // chargeback date if applicable
}

// ---------------------------------------------------------------------------
// Carrier identifiers (canonical, uppercase)
// ---------------------------------------------------------------------------
export type CarrierId = "UNL" | "HEARTLAND";

// ---------------------------------------------------------------------------
// SQL column mapping — generates SELECT expressions for each carrier
// ---------------------------------------------------------------------------

/**
 * Returns a SQL SELECT fragment that remaps carrier-specific columns to
 * the normalized schema. Use inside a UNION ALL across carrier tables.
 *
 * Example:
 *   SELECT ${carrierSelectClause('UNL')} FROM typed.unl_fym_policy_latest_load
 *   UNION ALL
 *   SELECT ${carrierSelectClause('HEARTLAND')} FROM typed.heartland_inforced_policy_latest
 */
export function carrierSelectClause(carrier: CarrierId): string {
  switch (carrier) {
    case "UNL":
      return `
        policy_nbr AS policy_number,
        issue_date,
        app_recvd_date,
        paid_to_date,
        term_date,
        billing_mode,
        annual_premium,
        plan_code,
        cntrct_code AS contract_code,
        'UNL' AS carrier,
        wa AS agent_code,
        wa_name AS agent_name,
        first_name AS client_first_name,
        last_name AS client_last_name,
        phone_nbr::text AS client_phone,
        NULL::text AS client_email,
        COALESCE(
          (SELECT e->>'writing_number'
             FROM jsonb_array_elements(roster_hierarchy_json) e
             WHERE e->>'depth' = '02'
               AND COALESCE((e->>'is_person')::boolean, false) = false
             LIMIT 1),
          (SELECT e->>'writing_number'
             FROM jsonb_array_elements(roster_hierarchy_json) e
             WHERE e->>'depth' = '01'
             LIMIT 1)
        ) AS agency_writing_number,
        at_risk_policy AS at_risk,
        NULL::text AS at_risk_reason,
        NULL::date AS chargeback_date,
        roster_hierarchy_json
      `.trim();

    case "HEARTLAND":
      return `
        pol_no AS policy_number,
        eff_date AS issue_date,
        app_date AS app_recvd_date,
        paid_to_date,
        end_date AS term_date,
        NULL::integer AS billing_mode,
        premium AS annual_premium,
        product_desc AS plan_code,
        CASE hnl_status
          WHEN 'Active' THEN 'A'
          WHEN 'Pending Lapse' THEN 'A'
          WHEN 'Not Taken' THEN 'P'
          WHEN 'Cancelled' THEN 'T'
          ELSE 'P'
        END AS contract_code,
        'Heartland' AS carrier,
        agt_code AS agent_code,
        (agt_first_name || ' ' || agt_last_name) AS agent_name,
        first_name AS client_first_name,
        last_name AS client_last_name,
        client_phone,
        client_email,
        split_part(upline, ' - ', 2) AS agency_writing_number,
        (hnl_status = 'Pending Lapse')::boolean AS at_risk,
        return_descripton AS at_risk_reason,
        charge_back_dt AS chargeback_date,
        NULL::jsonb AS roster_hierarchy_json
      `.trim();

    default:
      throw new Error(`Unknown carrier: ${carrier}`);
  }
}

/**
 * Returns the typed table/view name in Max's DB for a given carrier.
 */
export function carrierTable(carrier: CarrierId): string {
  switch (carrier) {
    case "UNL":
      return "typed.unl_fym_policy_latest_load";
    case "HEARTLAND":
      return "typed.heartland_inforced_policy_latest";
    default:
      throw new Error(`Unknown carrier: ${carrier}`);
  }
}

/**
 * All carriers currently available in Max's DB.
 * Add new carriers here as they come online.
 */
export const ACTIVE_CARRIERS: CarrierId[] = ["UNL", "HEARTLAND"];

// ---------------------------------------------------------------------------
// Heartland status mapping
// ---------------------------------------------------------------------------

/**
 * Map Heartland hnl_status to the UNL-equivalent contract code.
 *
 * Heartland statuses:
 *   Active        → A (active, premium drafting)
 *   Pending Lapse  → A (still technically active, but at-risk — premium failed)
 *   Not Taken      → P (pending — never activated)
 *   Cancelled      → T (terminated)
 *
 * Note: "Pending Lapse" maps to 'A' not 'T' because the policy hasn't terminated
 * yet — it's at-risk. The at_risk flag handles the distinction.
 */
export function heartlandStatusToContractCode(hnlStatus: string | null): string {
  switch (hnlStatus) {
    case "Active":
      return "A";
    case "Pending Lapse":
      return "A"; // still active, but at-risk
    case "Not Taken":
      return "P";
    case "Cancelled":
      return "T";
    default:
      return "P"; // unknown → pending
  }
}

/**
 * Derive product type from Heartland product_desc.
 *
 * Heartland product_desc examples:
 *   "94023 Home Health Care - Complete Plan" → HHC
 *   "94023 Home Health Care - Standard Plan" → HHC
 *   "94023 SC Home Health Care - Basic Plan"  → HHC
 *   "93017 HIP - Benefit Period = 10 Days"    → HI
 *
 * Falls back to the existing derivePlanType rules for edge cases.
 */
export function heartlandProductType(productDesc: string | null): string {
  if (!productDesc) return "Unknown";
  const upper = productDesc.toUpperCase();
  if (upper.includes("HOME HEALTH") || upper.includes("HHC")) return "HHC";
  if (upper.includes("HIP") || upper.includes("HOSPITAL INDEMNITY")) return "HI";
  if (upper.includes("CANCER") || upper.includes("UNCAN")) return "Cancer";
  if (upper.includes("LIFE") || upper.includes("FEX") || upper.includes("UNFEX")) return "Life";
  if (upper.includes("DENTAL") || upper.includes("VISION") || upper.includes("DV")) return "DV";
  return "Unknown";
}

// ---------------------------------------------------------------------------
// Row-level normalization (for code-side processing, not SQL)
// ---------------------------------------------------------------------------

/**
 * Normalize a raw row from any carrier table into the common NormalizedPolicy shape.
 * Use this when processing rows in TypeScript (e.g., lifecycle evaluator, GHL push).
 * For SQL-level normalization, use carrierSelectClause() in UNION queries.
 */
export function normalizeRow(carrier: CarrierId, raw: Record<string, unknown>): NormalizedPolicy {
  switch (carrier) {
    case "UNL":
      return {
        policy_number: String(raw.policy_nbr ?? ""),
        issue_date: raw.issue_date as string | null,
        app_recvd_date: raw.app_recvd_date as string | null,
        paid_to_date: raw.paid_to_date as string | null,
        term_date: raw.term_date as string | null,
        billing_mode: raw.billing_mode as number | null,
        annual_premium: raw.annual_premium as number | null,
        plan_code: raw.plan_code as string | null,
        product_type: null, // derived downstream via derivePlanType
        contract_code: raw.cntrct_code as string | null,
        carrier: "UNL",
        agent_code: raw.wa as string | null,
        agent_first_name: null, // UNL doesn't split agent name; use wa_name
        agent_last_name: null,
        client_first_name: raw.first_name as string | null,
        client_last_name: raw.last_name as string | null,
        client_phone: raw.phone_nbr ? String(raw.phone_nbr) : null,
        client_email: null, // UNL doesn't provide email
        upline_raw: null, // UNL uses roster_hierarchy_json, not a flat upline
        at_risk: (raw.at_risk_policy as boolean) ?? false,
        at_risk_reason: null,
        chargeback_date: null,
      };

    case "HEARTLAND":
      return {
        policy_number: String(raw.pol_no ?? ""),
        issue_date: raw.eff_date as string | null,
        app_recvd_date: raw.app_date as string | null,
        paid_to_date: raw.paid_to_date as string | null,
        term_date: raw.end_date as string | null,
        billing_mode: null, // Heartland doesn't have billing_mode
        annual_premium: raw.premium as number | null,
        plan_code: raw.product_desc as string | null,
        product_type: heartlandProductType(raw.product_desc as string | null),
        contract_code: heartlandStatusToContractCode(raw.hnl_status as string | null),
        carrier: "Heartland",
        agent_code: raw.agt_code as string | null,
        agent_first_name: raw.agt_first_name as string | null,
        agent_last_name: raw.agt_last_name as string | null,
        client_first_name: raw.first_name as string | null,
        client_last_name: raw.last_name as string | null,
        client_phone: raw.client_phone as string | null,
        client_email: raw.client_email as string | null,
        upline_raw: raw.upline as string | null,
        at_risk: (raw.hnl_status as string) === "Pending Lapse",
        at_risk_reason: raw.return_descripton as string | null,
        chargeback_date: raw.charge_back_dt as string | null,
      };

    default:
      throw new Error(`Unknown carrier: ${carrier}`);
  }
}
