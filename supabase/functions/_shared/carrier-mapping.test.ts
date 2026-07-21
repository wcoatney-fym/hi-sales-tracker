/**
 * carrier-mapping.test.ts — Tests for multi-carrier column normalization.
 */

import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  heartlandStatusToContractCode,
  heartlandProductType,
  heartlandLifecycleTrigger,
  heartlandTriggerLabel,
  normalizeRow,
  carrierSelectClause,
  carrierTable,
  ACTIVE_CARRIERS,
} from "./carrier-mapping.ts";

// ---------------------------------------------------------------------------
// heartlandStatusToContractCode
// ---------------------------------------------------------------------------
Deno.test("heartlandStatusToContractCode — Active → A", () => {
  assertEquals(heartlandStatusToContractCode("Active"), "A");
});

Deno.test("heartlandStatusToContractCode — Pending Lapse → A (at-risk, not terminated)", () => {
  assertEquals(heartlandStatusToContractCode("Pending Lapse"), "A");
});

Deno.test("heartlandStatusToContractCode — Not Taken → P", () => {
  assertEquals(heartlandStatusToContractCode("Not Taken"), "P");
});

Deno.test("heartlandStatusToContractCode — Cancelled → T", () => {
  assertEquals(heartlandStatusToContractCode("Cancelled"), "T");
});

Deno.test("heartlandStatusToContractCode — null → P (default)", () => {
  assertEquals(heartlandStatusToContractCode(null), "P");
});

Deno.test("heartlandStatusToContractCode — unknown string → P (default)", () => {
  assertEquals(heartlandStatusToContractCode("SomeUnknownStatus"), "P");
});

// ---------------------------------------------------------------------------
// heartlandProductType
// ---------------------------------------------------------------------------
Deno.test("heartlandProductType — Home Health Care Complete → HHC", () => {
  assertEquals(heartlandProductType("94023 Home Health Care - Complete Plan"), "HHC");
});

Deno.test("heartlandProductType — Home Health Care Standard → HHC", () => {
  assertEquals(heartlandProductType("94023 Home Health Care - Standard Plan"), "HHC");
});

Deno.test("heartlandProductType — SC Home Health Care → HHC", () => {
  assertEquals(heartlandProductType("94023 SC Home Health Care - Basic Plan"), "HHC");
});

Deno.test("heartlandProductType — HIP → HI", () => {
  assertEquals(heartlandProductType("93017 HIP - Benefit Period = 10 Days"), "HI");
});

Deno.test("heartlandProductType — null → Unknown", () => {
  assertEquals(heartlandProductType(null), "Unknown");
});

Deno.test("heartlandProductType — empty string → Unknown", () => {
  assertEquals(heartlandProductType(""), "Unknown");
});

Deno.test("heartlandProductType — unrecognized plan → Unknown", () => {
  assertEquals(heartlandProductType("99999 Mystery Plan"), "Unknown");
});

// ---------------------------------------------------------------------------
// normalizeRow — Heartland
// ---------------------------------------------------------------------------
Deno.test("normalizeRow — Heartland active HHC policy", () => {
  const raw = {
    pol_no: "HL-12345",
    eff_date: "2026-07-01",
    app_date: "2026-06-20",
    paid_to_date: "2026-08-01",
    end_date: null,
    premium: 940,
    product_desc: "94023 Home Health Care - Complete Plan",
    hnl_status: "Active",
    agt_code: "5151561",
    agt_first_name: "JOSHUA",
    agt_last_name: "BOCK",
    first_name: "Jane",
    last_name: "Doe",
    client_phone: "5551234567",
    client_email: "jane@example.com",
    upline: "JOSHUA BOCK - 5151561",
    return_descripton: null,
    charge_back_dt: null,
  };

  const norm = normalizeRow("HEARTLAND", raw);

  assertEquals(norm.policy_number, "HL-12345");
  assertEquals(norm.issue_date, "2026-07-01");
  assertEquals(norm.app_recvd_date, "2026-06-20");
  assertEquals(norm.paid_to_date, "2026-08-01");
  assertEquals(norm.term_date, null);
  assertEquals(norm.billing_mode, null);
  assertEquals(norm.annual_premium, 940);
  assertEquals(norm.product_type, "HHC");
  assertEquals(norm.contract_code, "A");
  assertEquals(norm.carrier, "Heartland");
  assertEquals(norm.agent_code, "5151561");
  assertEquals(norm.agent_first_name, "JOSHUA");
  assertEquals(norm.agent_last_name, "BOCK");
  assertEquals(norm.client_first_name, "Jane");
  assertEquals(norm.client_last_name, "Doe");
  assertEquals(norm.client_phone, "5551234567");
  assertEquals(norm.client_email, "jane@example.com");
  assertEquals(norm.upline_raw, "JOSHUA BOCK - 5151561");
  assertEquals(norm.at_risk, false);
  assertEquals(norm.at_risk_reason, null);
  assertEquals(norm.chargeback_date, null);
});

Deno.test("normalizeRow — Heartland Pending Lapse → at_risk true with reason", () => {
  const raw = {
    pol_no: "HL-99999",
    eff_date: "2026-06-15",
    app_date: "2026-06-10",
    paid_to_date: "2026-07-01",
    end_date: null,
    premium: 500,
    product_desc: "93017 HIP - Benefit Period = 10 Days",
    hnl_status: "Pending Lapse",
    agt_code: "5151699",
    agt_first_name: "JENNIFER",
    agt_last_name: "JAMES",
    first_name: "John",
    last_name: "Smith",
    client_phone: "5559876543",
    client_email: null,
    upline: "JENNIFER JAMES - 5151699",
    return_descripton: "INSUFFICIENT FUNDS",
    charge_back_dt: "2026-07-15",
  };

  const norm = normalizeRow("HEARTLAND", raw);

  assertEquals(norm.contract_code, "A"); // still active, not terminated
  assertEquals(norm.at_risk, true);
  assertEquals(norm.at_risk_reason, "INSUFFICIENT FUNDS");
  assertEquals(norm.chargeback_date, "2026-07-15");
  assertEquals(norm.product_type, "HI");
  assertEquals(norm.carrier, "Heartland");
});

Deno.test("normalizeRow — Heartland Cancelled → contract_code T", () => {
  const raw = {
    pol_no: "HL-CANCELLED",
    eff_date: "2026-06-15",
    app_date: "2026-06-10",
    paid_to_date: "2026-06-15",
    end_date: "2026-07-01",
    premium: 300,
    product_desc: "94023 Home Health Care - Basic Plan",
    hnl_status: "Cancelled",
    agt_code: "5151684",
    agt_first_name: "JAKE",
    agt_last_name: "LEVINE",
    first_name: "Bob",
    last_name: "Jones",
    client_phone: null,
    client_email: null,
    upline: "JAKE LEVINE - 5151684",
    return_descripton: null,
    charge_back_dt: null,
  };

  const norm = normalizeRow("HEARTLAND", raw);
  assertEquals(norm.contract_code, "T");
  assertEquals(norm.term_date, "2026-07-01");
  assertEquals(norm.at_risk, false);
});

// ---------------------------------------------------------------------------
// normalizeRow — UNL
// ---------------------------------------------------------------------------
Deno.test("normalizeRow — UNL active policy", () => {
  const raw = {
    policy_nbr: "UNL-54321",
    issue_date: "2026-04-01",
    app_recvd_date: "2026-03-25",
    paid_to_date: "2026-07-01",
    term_date: null,
    billing_mode: 1,
    annual_premium: 6360,
    plan_code: "HHC100",
    cntrct_code: "A",
    wa: "202NEW00",
    first_name: "Alice",
    last_name: "Williams",
    phone_nbr: 5551112222,
    at_risk_policy: false,
  };

  const norm = normalizeRow("UNL", raw);
  assertEquals(norm.policy_number, "UNL-54321");
  assertEquals(norm.issue_date, "2026-04-01");
  assertEquals(norm.billing_mode, 1);
  assertEquals(norm.contract_code, "A");
  assertEquals(norm.carrier, "UNL");
  assertEquals(norm.agent_code, "202NEW00");
  assertEquals(norm.client_phone, "5551112222");
  assertEquals(norm.client_email, null); // UNL doesn't provide email
  assertEquals(norm.at_risk, false);
});

// ---------------------------------------------------------------------------
// normalizeRow — unknown carrier throws
// ---------------------------------------------------------------------------
Deno.test("normalizeRow — unknown carrier throws", () => {
  assertThrows(
    () => normalizeRow("GTL" as any, {}),
    Error,
    "Unknown carrier",
  );
});

// ---------------------------------------------------------------------------
// carrierSelectClause — smoke tests (non-empty, contains key remap)
// ---------------------------------------------------------------------------
Deno.test("carrierSelectClause — UNL contains policy_number remap", () => {
  const clause = carrierSelectClause("UNL");
  assertEquals(clause.includes("policy_nbr AS policy_number"), true);
  assertEquals(clause.includes("'UNL' AS carrier"), true);
});

Deno.test("carrierSelectClause — HEARTLAND contains policy_number remap", () => {
  const clause = carrierSelectClause("HEARTLAND");
  assertEquals(clause.includes("pol_no AS policy_number"), true);
  assertEquals(clause.includes("'Heartland' AS carrier"), true);
});

Deno.test("carrierSelectClause — unknown carrier throws", () => {
  assertThrows(
    () => carrierSelectClause("MYSTERY" as any),
    Error,
    "Unknown carrier",
  );
});

// ---------------------------------------------------------------------------
// carrierTable
// ---------------------------------------------------------------------------
Deno.test("carrierTable — UNL", () => {
  assertEquals(carrierTable("UNL"), "typed.unl_fym_policy_latest_load");
});

Deno.test("carrierTable — HEARTLAND", () => {
  assertEquals(carrierTable("HEARTLAND"), "typed.heartland_inforced_policy_latest");
});

Deno.test("carrierTable — unknown throws", () => {
  assertThrows(() => carrierTable("GTL" as any), Error, "Unknown carrier");
});

// ---------------------------------------------------------------------------
// ACTIVE_CARRIERS
// ---------------------------------------------------------------------------
Deno.test("ACTIVE_CARRIERS includes UNL and HEARTLAND", () => {
  assertEquals(ACTIVE_CARRIERS.includes("UNL"), true);
  assertEquals(ACTIVE_CARRIERS.includes("HEARTLAND"), true);
  assertEquals(ACTIVE_CARRIERS.length, 2);
});

// ---------------------------------------------------------------------------
// heartlandLifecycleTrigger — Phase 3 prep
// ---------------------------------------------------------------------------
Deno.test("heartlandLifecycleTrigger — null → Active = submission", () => {
  assertEquals(heartlandLifecycleTrigger(null, "Active"), "submission");
});

Deno.test("heartlandLifecycleTrigger — Active → Pending Lapse = at_risk", () => {
  assertEquals(heartlandLifecycleTrigger("Active", "Pending Lapse"), "at_risk");
});

Deno.test("heartlandLifecycleTrigger — Pending Lapse → Active = approved (recovered)", () => {
  assertEquals(heartlandLifecycleTrigger("Pending Lapse", "Active"), "approved");
});

Deno.test("heartlandLifecycleTrigger — Active → Cancelled = terminated", () => {
  assertEquals(heartlandLifecycleTrigger("Active", "Cancelled"), "terminated");
});

Deno.test("heartlandLifecycleTrigger — Pending Lapse → Cancelled = terminated", () => {
  assertEquals(heartlandLifecycleTrigger("Pending Lapse", "Cancelled"), "terminated");
});

Deno.test("heartlandLifecycleTrigger — null → Not Taken = null (no trigger)", () => {
  assertEquals(heartlandLifecycleTrigger(null, "Not Taken"), null);
});

Deno.test("heartlandLifecycleTrigger — null → null = null", () => {
  assertEquals(heartlandLifecycleTrigger(null, null), null);
});

Deno.test("heartlandLifecycleTrigger — unknown transition = null", () => {
  assertEquals(heartlandLifecycleTrigger("Not Taken", "Active"), null);
});

// ---------------------------------------------------------------------------
// heartlandTriggerLabel
// ---------------------------------------------------------------------------
Deno.test("heartlandTriggerLabel — at_risk → 'at risk' (space for GHL)", () => {
  assertEquals(heartlandTriggerLabel("at_risk"), "at risk");
});

Deno.test("heartlandTriggerLabel — submission stays submission", () => {
  assertEquals(heartlandTriggerLabel("submission"), "submission");
});

Deno.test("heartlandTriggerLabel — approved stays approved", () => {
  assertEquals(heartlandTriggerLabel("approved"), "approved");
});

Deno.test("heartlandTriggerLabel — terminated stays terminated", () => {
  assertEquals(heartlandTriggerLabel("terminated"), "terminated");
});
