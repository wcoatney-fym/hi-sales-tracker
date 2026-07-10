// Direct GHL (LeadConnector v2) contact push for the retention lifecycle.
//
// Replaces the Zapier hop (Charlie, 2026-07-02): the Activity-tracker evaluator
// now writes lifecycle state straight into the GHL contact via the v2
// contacts/upsert endpoint. Upsert dedupes on email/phone within the location,
// so it updates the intake-created contact in place rather than duplicating.
//
// GHL stores the policy state in per-line-of-business custom fields
// (contact.{lob}__{attr}). We select the field group from the policy's derived
// plan type, so an HHC policy writes the hhc__* fields, an HI policy the hip__*
// fields, etc. GHL workflows branch on those field VALUES (client_status,
// at_risk_status, terminated_reason) — the tracker's `trigger` is not a GHL
// construct.
//
// The body builder is pure + dependency-free so it can be unit-tested with
// `deno test` without touching the network.

import type { PlanType } from "./lifecycle-evaluator.ts";

// GHL location custom-field ids per line of business. Pulled live from
// GET /locations/{id}/customFields (2026-07-02). All five LOB groups carry the
// identical 15-field set; refresh from that endpoint if fields are added.
export type LobKey = "hip" | "hhc" | "life" | "dv" | "cancer";

export type LobFieldAttr =
  | "plan_name"
  | "plan_premium"
  | "submission_date"
  | "effective_date"
  | "paid_to_date"
  | "billing_mode"
  | "at_risk_status"
  | "client_status"
  | "policy_number"
  | "carrier_name"
  | "agent_first_name"
  | "agent_full_name"
  | "agent_writing_number"
  | "terminated_reason"
  | "termination_date";

// Global (non-LOB) custom field for the writing agent's NPN. ALWAYS written on
// every push regardless of product — all GHL automations key on NPN
// (Charlie, 2026-07-02). Field: contact.agent_npn.
export const AGENT_NPN_FIELD_ID = "uEFOApsD4JKXsXH3T9E4";

// Product tag applied to the contact so GHL can segment by line of business
// (Charlie, 2026-07-02). Uses the existing GHL tag taxonomy (`<product> | sold
// client`). Unknown plan type gets no product tag.
export const PRODUCT_TAG: Record<LobKey, string> = {
  hip: "hip | sold client",
  hhc: "hhc | sold client",
  life: "life | sold client",
  dv: "dv | sold client",
  cancer: "cancer stroke | sold client",
};

export const LOB_FIELD_IDS: Record<LobKey, Record<LobFieldAttr, string>> = {
  hip: {
    plan_name: "0wkHYd9Jfr1mtttt56kf",
    plan_premium: "u04RAp234layEohSc3KC",
    submission_date: "HbKscJYxMujUTWdgkjU9",
    effective_date: "qt4XBL6vrZByGLtkc0Ih",
    paid_to_date: "czhlxaX7aFdHkNOY6KPe",
    billing_mode: "cB6DQmu1gbSY7piS5Wb1",
    at_risk_status: "AHDJArHPmAzZ6IMaIcxw",
    client_status: "GnUA91j0Yj1PXH7CPtT4",
    policy_number: "O7MjvGP1J6PRGhjdwjhj",
    carrier_name: "ujIt1GLYAbrspZ2XgXQy",
    agent_first_name: "V7EV9UnKsQD47LKAqnTs",
    agent_full_name: "4SMzb0SrKt0mkkv8wN5V",
    agent_writing_number: "eMkkdSs1mq3R1YETEonE",
    terminated_reason: "YkGHoEC4SdIe6nJyt5YZ",
    termination_date: "xambt0f3vxofw4kt1Pdi",
  },
  hhc: {
    plan_name: "8hCfNIwfoOdI12Yyvtin",
    plan_premium: "VJRuOntDk0OW95UU2quk",
    submission_date: "i1G2mIDxNgbKl5ZPQhbh",
    effective_date: "2bzz5hCmd7rL8xTCHnHi",
    paid_to_date: "7rdKra2trtEElzfP0sxL",
    billing_mode: "JGVCWYaY8IWjdw3umjwX",
    at_risk_status: "cOhlJ1vFAPk9oyrwn4Qo",
    client_status: "55lFi7DxNxHHRjZw786Q",
    policy_number: "9AX6SIbt8GfjuMIHhF30",
    carrier_name: "qFdK00s2UWyOaWspS6hA",
    agent_first_name: "OuhQi0UEcV4XQkfVzW8L",
    agent_full_name: "7AuXjj4UvTfo77sKSTz4",
    agent_writing_number: "aorTF2gLo6xxOiw5LGBx",
    terminated_reason: "MqNTHQv5VtqvWQDjAtCE",
    termination_date: "3kavwfssUhNqp1go6Bjs",
  },
  life: {
    plan_name: "u3k0zrN8JCbCXrvUMP5u",
    plan_premium: "O7PBZkE2ph4Izt1s9zxt",
    submission_date: "VvjKFIuX8S3qSouiLq0D",
    effective_date: "kt884Dl3B470YF43rJqO",
    paid_to_date: "DfxnsvpMB8JnqQShOIQp",
    billing_mode: "Z3eM2nXfhbke32bmpsjw",
    at_risk_status: "WC0CIPwCIy7oVzCp4unf",
    client_status: "Ieu1LuasCcusfaT16hO2",
    policy_number: "DDMuEjHO4rXnjlvLXtro",
    carrier_name: "WjJkQRwj2CjsAasdvnHG",
    agent_first_name: "tulhcfFHXkOst7ZpmoK0",
    agent_full_name: "G66JPd3bh5ipSTj1tYe7",
    agent_writing_number: "jPPwoWZIHCikCFGl8dav",
    terminated_reason: "s5IZFwc2uO7967bgl5zw",
    termination_date: "mfEOueJ35gkPL6MLOnQE",
  },
  dv: {
    plan_name: "VXYaVt3ny9mjbBnnCHUt",
    plan_premium: "wjhlbqMimsuhuqSGTXI4",
    submission_date: "rtjEEVIlYET61waijrKw",
    effective_date: "Zpt4ywr1Sxa73p1X4mPQ",
    paid_to_date: "LZVZDeHIlBEGGzsrVquU",
    billing_mode: "xP3DVuX9yF3MkEGOg7XO",
    at_risk_status: "rUfUumYDwb1monhWRZ88",
    client_status: "dK1edrgLZbUQUZ5Pg5J8",
    policy_number: "kZKzqIn6Aon0HR2aQSsj",
    carrier_name: "7BaMsjNLVmlLDnFGEcdM",
    agent_first_name: "IVHUUILreWiYolYr0Ski",
    agent_full_name: "06YqTBfafv1J2h1Espko",
    agent_writing_number: "47QZtcUURgU0J8c9YAuR",
    terminated_reason: "z6PFV8144iU5wqLXUG4q",
    termination_date: "EPPygeh4k9xHSSKWgOlY",
  },
  cancer: {
    plan_name: "vygQpo1UzPk6HGC8rNFF",
    plan_premium: "GH6O3TwhWK2afu2pWb95",
    submission_date: "jljiD2cjqdVLwx2Elptd",
    effective_date: "KXB2RjuHNm0p4XXR3NCS",
    paid_to_date: "FU1lw06KVaQ4QpcMucSY",
    billing_mode: "Fph5DSftKPiwC1X63eS7",
    at_risk_status: "Silo8oGlarkgLUXYH2Lw",
    client_status: "JhgLl7vyEYUoiAqw9emI",
    policy_number: "WL9hnl4eleB2iHCNdJjt",
    carrier_name: "TV2S9vZ15ZQdaRjLwytX",
    agent_first_name: "Hcbu8GyHXpDyryp0cyZl",
    agent_full_name: "gmTwNX6OGPKNAw65otX2",
    agent_writing_number: "qFNEnll9LiaQQCrCiFpC",
    terminated_reason: "r494CljXQVXzUxSNl6BD",
    termination_date: "53Nj6eSWpXVPddI62LDU",
  },
};

// Map the evaluator's PlanType to the GHL custom-field prefix. "Unknown" has no
// field group — the contact is still upserted (standard fields + tags) but no
// LOB custom fields are written.
export function lobKeyForPlanType(planType: PlanType): LobKey | null {
  switch (planType) {
    case "HIP":
      return "hip";
    case "HHC":
      return "hhc";
    case "Life":
      return "life";
    case "DV":
      return "dv";
    case "Cancer":
      return "cancer";
    default:
      return null;
  }
}

// The flat lifecycle payload the evaluator assembles (same shape used for the
// legacy Zap). Only the fields we forward to GHL are typed here.
export interface LifecyclePayload {
  client_first_name?: unknown;
  client_last_name?: unknown;
  phone?: unknown;
  email?: unknown;
  address?: unknown;
  city?: unknown;
  state?: unknown;
  zip?: unknown;
  plan_name?: unknown;
  plan_type: PlanType;
  plan_premium?: unknown;
  submission_date?: unknown;
  effective_date?: unknown;
  paid_to_date?: unknown;
  billing_mode?: unknown;
  at_risk_status?: unknown; // boolean from deriveAtRisk
  client_status?: unknown;
  policy_number?: unknown;
  termination_date?: unknown;
  contract_reason?: unknown; // mapped label, goes to {lob}__terminated_reason
  agent_npn?: unknown; // writing agent NPN -> global contact.agent_npn field
  carrier?: unknown;
  agent_first_name?: unknown;
  agent_full_name?: unknown;
  agent_writing_number?: unknown;
  trigger: string;
}

export interface GhlCustomField {
  id: string;
  value: string;
}

export interface GhlContactBody {
  locationId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address1: string;
  city: string;
  state: string;
  postalCode: string;
  source: string;
  tags: string[];
  customFields: GhlCustomField[];
}

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

// Normalize the derived at-risk boolean (or string) to the Yes/No the GHL field
// expects.
function yesNo(v: unknown): string {
  if (v === true) return "Yes";
  if (v === false) return "No";
  const s = str(v).trim().toLowerCase();
  if (s === "true" || s === "yes") return "Yes";
  if (s === "false" || s === "no" || s === "") return "No";
  return str(v);
}

/**
 * Build the GHL contacts/upsert body from a flat lifecycle payload. Pure.
 *
 * Standard contact fields come from the client/agent columns; the policy state
 * is written to the LOB-specific custom fields selected by plan_type. Unknown
 * plan types still upsert the contact (no LOB custom fields).
 */
export function buildGhlContactBody(
  p: LifecyclePayload,
  locationId: string,
): GhlContactBody {
  const lob = lobKeyForPlanType(p.plan_type);
  const customFields: GhlCustomField[] = [];

  // Agent NPN is global (not LOB-scoped) and ALWAYS included — GHL automations
  // hinge on it (Charlie, 2026-07-02).
  customFields.push({ id: AGENT_NPN_FIELD_ID, value: str(p.agent_npn) });

  if (lob) {
    const ids = LOB_FIELD_IDS[lob];
    const put = (attr: LobFieldAttr, value: string) => {
      customFields.push({ id: ids[attr], value });
    };
    put("plan_name", str(p.plan_name));
    put("plan_premium", str(p.plan_premium));
    put("submission_date", str(p.submission_date));
    put("effective_date", str(p.effective_date));
    put("paid_to_date", str(p.paid_to_date));
    put("billing_mode", str(p.billing_mode));
    put("at_risk_status", yesNo(p.at_risk_status));
    put("client_status", str(p.client_status));
    put("policy_number", str(p.policy_number));
    put("carrier_name", str(p.carrier));
    put("agent_first_name", str(p.agent_first_name));
    put("agent_full_name", str(p.agent_full_name));
    put("agent_writing_number", str(p.agent_writing_number));
    put("terminated_reason", str(p.contract_reason));
    put("termination_date", str(p.termination_date));
  }

  const tags = ["lifecycle", `trigger-${p.trigger}`];
  if (lob) tags.push(PRODUCT_TAG[lob]);

  const email = str(p.email).trim();
  const phone = str(p.phone).trim();

  return {
    locationId,
    firstName: str(p.client_first_name),
    lastName: str(p.client_last_name),
    // Omit email/phone entirely when blank — GHL 422s on empty string format validation
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    address1: str(p.address),
    city: str(p.city),
    state: str(p.state),
    postalCode: str(p.zip),
    source: "activity-tracker-lifecycle",
    tags,
    customFields,
  } as GhlContactBody;
}

export interface GhlConfig {
  token: string;
  locationId: string;
  apiBase: string;
}

// Load GHL creds from the container env. Returns null (dormant) if unset, so the
// import never breaks when the integration isn't configured.
export function loadGhlConfig(): GhlConfig | null {
  try {
    const token = Deno.env.get("GHL_API_KEY_HIP_PORTAL");
    const locationId = Deno.env.get("GHL_LOCATION_ID_SUNFIRE");
    if (!token || !locationId) return null;
    return {
      token,
      locationId,
      apiBase: Deno.env.get("GHL_API_BASE") || "https://services.leadconnectorhq.com",
    };
  } catch {
    return null;
  }
}

export interface GhlPushResult {
  ok: boolean;
  http_status: number | null;
  error: string | null;
}

// Best-effort upsert of one contact. Never throws.
export async function pushContactToGhl(
  cfg: GhlConfig,
  body: GhlContactBody,
): Promise<GhlPushResult> {
  try {
    // Use /contacts/ (POST create) — upsert requires email or phone which
    // the lifecycle runner doesn't always have. Dedup handled in GHL subaccount layer.
    const resp = await fetch(`${cfg.apiBase}/contacts/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Version: "2021-07-28",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    return {
      ok: resp.ok,
      http_status: resp.status,
      error: resp.ok ? null : `HTTP ${resp.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      http_status: null,
      error: err instanceof Error ? err.message : "fetch failed",
    };
  }
}
