import { assertEquals } from "jsr:@std/assert";
import {
  AGENCY_FIELD_ID,
  AGENT_NPN_FIELD_ID,
  buildGhlContactBody,
  LOB_FIELD_IDS,
  lobKeyForPlanType,
  PRODUCT_TAG,
  type LifecyclePayload,
} from "./ghl-client.ts";

const LOC = "TESTLOC123";

function basePayload(overrides: Partial<LifecyclePayload> = {}): LifecyclePayload {
  return {
    client_first_name: "Marcus",
    client_last_name: "Bellamy",
    phone: "(555) 311-0101",
    email: "marcus.bellamy@example.com",
    address: "100 Test St",
    city: "Tampa",
    state: "FL",
    zip: "33601",
    plan_name: "Hospital Indemnity Plus",
    plan_type: "HIP",
    plan_premium: 45,
    submission_date: "06/01/2026",
    effective_date: "07/01/2026",
    paid_to_date: "08/01/2026",
    billing_mode: "monthly",
    at_risk_status: false,
    client_status: "active",
    policy_number: "TESTHI-APP-001",
    termination_date: "",
    contract_reason: "",
    agent_npn: "18408252",
    agency: "FYM",
    carrier: "GTL",
    agent_first_name: "Tyler",
    agent_full_name: "Tyler Cole",
    agent_writing_number: "011OOQ11",
    trigger: "approved",
    ...overrides,
  };
}

function cfMap(body: { customFields: { id: string; value: string }[] }) {
  const m = new Map<string, string>();
  for (const f of body.customFields) m.set(f.id, f.value);
  return m;
}

Deno.test("lobKeyForPlanType maps all plan types", () => {
  assertEquals(lobKeyForPlanType("HIP"), "hip");
  assertEquals(lobKeyForPlanType("HHC"), "hhc");
  assertEquals(lobKeyForPlanType("Life"), "life");
  assertEquals(lobKeyForPlanType("DV"), "dv");
  assertEquals(lobKeyForPlanType("Cancer"), "cancer");
  assertEquals(lobKeyForPlanType("Unknown"), null);
});

Deno.test("standard contact fields map straight through", () => {
  const b = buildGhlContactBody(basePayload(), LOC);
  assertEquals(b.locationId, LOC);
  assertEquals(b.firstName, "Marcus");
  assertEquals(b.lastName, "Bellamy");
  assertEquals(b.email, "marcus.bellamy@example.com");
  assertEquals(b.phone, "(555) 311-0101");
  assertEquals(b.address1, "100 Test St");
  assertEquals(b.city, "Tampa");
  assertEquals(b.state, "FL");
  assertEquals(b.postalCode, "33601");
  assertEquals(b.source, "activity-tracker-lifecycle");
  // Tags: exactly one product tag, no trigger-* or lifecycle tags (Charlie, 2026-07-09).
  assertEquals(b.tags, ["hip | sold client"]);
});

Deno.test("HIP approved writes the hip__ field group with correct ids", () => {
  const b = buildGhlContactBody(basePayload(), LOC);
  const m = cfMap(b);
  const ids = LOB_FIELD_IDS.hip;
  // 15 LOB fields + agent_npn + agency = 17 custom fields.
  assertEquals(b.customFields.length, 17);
  assertEquals(m.get(AGENT_NPN_FIELD_ID), "18408252");
  assertEquals(m.get(AGENCY_FIELD_ID), "FYM");
  assertEquals(m.get(ids.plan_name), "Hospital Indemnity Plus");
  assertEquals(m.get(ids.plan_premium), "45");
  assertEquals(m.get(ids.client_status), "active");
  assertEquals(m.get(ids.at_risk_status), "No");
  assertEquals(m.get(ids.policy_number), "TESTHI-APP-001");
  assertEquals(m.get(ids.carrier_name), "GTL");
  assertEquals(m.get(ids.agent_full_name), "Tyler Cole");
  assertEquals(m.get(ids.agent_writing_number), "011OOQ11");
  assertEquals(m.get(ids.terminated_reason), "");
});

Deno.test("at risk boolean true -> Yes", () => {
  const b = buildGhlContactBody(basePayload({ at_risk_status: true, trigger: "at risk" }), LOC);
  const m = cfMap(b);
  assertEquals(m.get(LOB_FIELD_IDS.hip.at_risk_status), "Yes");
  assertEquals(b.tags, ["hip | sold client"]);
});

Deno.test("product tag applied per LOB; Unknown gets none", () => {
  const cases: Array<[LifecyclePayload["plan_type"], string | null]> = [
    ["HIP", "hip | sold client"],
    ["HHC", "hhc | sold client"],
    ["Life", "life | sold client"],
    ["DV", "dv | sold client"],
    ["Cancer", "cancer stroke | sold client"],
    ["Unknown", null],
  ];
  for (const [pt, tag] of cases) {
    const b = buildGhlContactBody(basePayload({ plan_type: pt }), LOC);
    if (tag === null) {
      // Unknown: no tags at all (Charlie, 2026-07-09: only one product tag, no lifecycle/trigger tags).
      assertEquals(b.tags, [], `${pt} no product tag`);
    } else {
      assertEquals(b.tags.includes(tag), true, `${pt} has product tag`);
      assertEquals(b.tags.length, 1, `${pt} tag count`);
    }
  }
});

Deno.test("PRODUCT_TAG covers all LOB keys", () => {
  assertEquals(Object.keys(PRODUCT_TAG).sort(), ["cancer", "dv", "hhc", "hip", "life"]);
});

Deno.test("terminated carries mapped reason label + date into hhc group", () => {
  const b = buildGhlContactBody(
    basePayload({
      plan_type: "HHC",
      plan_name: "Home Health Care Plus",
      trigger: "terminated",
      client_status: "terminated",
      contract_reason: "Lapsed",
      termination_date: "06/01/2026",
    }),
    LOC,
  );
  const m = cfMap(b);
  const ids = LOB_FIELD_IDS.hhc;
  assertEquals(m.get(ids.terminated_reason), "Lapsed");
  assertEquals(m.get(ids.termination_date), "06/01/2026");
  assertEquals(m.get(ids.client_status), "terminated");
});

Deno.test("Unknown plan type still writes agent_npn + agency (global fields only)", () => {
  const b = buildGhlContactBody(basePayload({ plan_type: "Unknown" }), LOC);
  // 2 global fields: agent_npn + agency. No LOB fields for Unknown.
  assertEquals(b.customFields.length, 2);
  const m = cfMap(b);
  assertEquals(m.get(AGENT_NPN_FIELD_ID), "18408252");
  assertEquals(m.get(AGENCY_FIELD_ID), "FYM");
  assertEquals(b.firstName, "Marcus");
});

Deno.test("agent_npn is always included across every LOB", () => {
  for (const pt of ["HIP", "HHC", "Life", "DV", "Cancer", "Unknown"] as const) {
    const b = buildGhlContactBody(basePayload({ plan_type: pt }), LOC);
    const npn = b.customFields.find((f) => f.id === AGENT_NPN_FIELD_ID);
    assertEquals(npn?.value, "18408252", `${pt} carries agent_npn`);
  }
});

Deno.test("null/undefined values become empty strings", () => {
  const b = buildGhlContactBody(
    basePayload({ email: null, phone: undefined, plan_premium: null }),
    LOC,
  );
  assertEquals(b.email, "");
  assertEquals(b.phone, "");
  assertEquals(cfMap(b).get(LOB_FIELD_IDS.hip.plan_premium), "");
});

Deno.test("all five LOB groups expose the full 15-field id set", () => {
  const attrs = [
    "plan_name","plan_premium","submission_date","effective_date","paid_to_date",
    "billing_mode","at_risk_status","client_status","policy_number","carrier_name",
    "agent_first_name","agent_full_name","agent_writing_number","terminated_reason","termination_date",
  ];
  for (const lob of ["hip","hhc","life","dv","cancer"] as const) {
    const ids = LOB_FIELD_IDS[lob];
    assertEquals(Object.keys(ids).length, 15, `${lob} field count`);
    for (const a of attrs) {
      // @ts-ignore index
      const v = ids[a];
      assertEquals(typeof v === "string" && v.length > 0, true, `${lob}.${a} id present`);
    }
    // ids must be unique within a group
    const set = new Set(Object.values(ids));
    assertEquals(set.size, 15, `${lob} ids unique`);
  }
});
