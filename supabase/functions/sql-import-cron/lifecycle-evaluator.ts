// Lifecycle event evaluator for the daily UNL pull.
//
// The UNL production file is a daily *full-state* refresh: every policy lands
// again on every pull. To drive the GHL/Zapier retention automation we must
// fire on **change vs last-known state**, never on presence — otherwise every
// policy re-blasts its events daily.
//
// Locked contract = 4 lifecycle triggers (GHL owns all downstream timing).
// `trigger` values are EXACT strings and must not drift:
//   1. "submission" — Contract Code flips to P
//   2. "approved"   — P -> A (transition)
//   3. "terminated" — A -> T (transition); carries contract_reason for GHL branch
//   4. "at risk"    — DERIVED (monthly + DIR, paid_to_date not advanced one
//                     cycle past effective_date inside first 60d); push only on
//                     flip-true, carries risk_signal.
//
// This module is intentionally pure + dependency-free so it can be unit-tested
// with `deno test` without touching Supabase or the network.

export type Trigger = "submission" | "approved" | "terminated" | "at risk";

// Product/plan-type buckets matching the GHL Zap paths.
export type PlanType = "HHC" | "HIP" | "Life" | "DV" | "Cancer" | "Unknown";

/**
 * Classify a UNL plan name into the GHL Zap path bucket. Deterministic keyword
 * match validated against the live `form_submissions.plan_name` values.
 *
 * Order matters: more specific / higher-priority riders are matched first so a
 * combined descriptor (e.g. a Life rider "...offered on Hosp Indem Shield")
 * lands in the right bucket instead of the substring it happens to contain.
 *
 * Examples from real data:
 *   UTHHC, "Home Health Care Shield with TCARE benefit"   -> HHC
 *   UHIP2, UGHIP, UFGHI, "Hospital Indemnity Shield 2.0"  -> HI
 *   UDN24, "Dental Shield 2.0"                             -> DV
 *   UNCAN, "...Cancer..."                                  -> Cancer
 *   UNFEX, "...$5k Life policy..."                         -> Life
 */
// UNL contract-reason code -> mapped label. GHL termination branches key on the
// mapped reason (Charlie, 2026-07-01), not the raw code. Mirrors the tracker's
// SourceRecordsTable mapping. Unknown/blank codes pass through unchanged.
const CONTRACT_REASON_MAP: Record<string, string> = {
  WI: "Withdrawn", LP: "Lapsed", DE: "Declined", CA: "Canceled",
  DC: "Claim", IC: "Incomplete", RS: "Reinstated/Restored", OW: "Owner Withdrawn",
  RI: "Ready to Issue", NT: "Not Taken", CV: "Converted", AC: "Canceled",
  HO: "Suspended (Pending - NSF)", SR: "Surrendered", RE: "Reinstated",
  SM: "Submitted", PC: "Policy Change",
};

export function contractReasonLabel(code: string | null): string {
  const c = (code ?? "").trim();
  if (!c) return "";
  return CONTRACT_REASON_MAP[c.toUpperCase()] ?? c;
}

export function derivePlanType(planName: string | null): PlanType {
  const s = (planName || "").toUpperCase();
  if (!s.trim()) return "Unknown";

  // 1. Cancer
  if (/CANCER|UNCAN|\bCAN\b/.test(s)) return "Cancer";
  // 2. Life / Final Expense (matched before HI so a life rider written on a
  //    hospital-indemnity base is classed as Life).
  if (/LIFE|FINAL EXPENSE|\bFEX\b|UNFEX/.test(s)) return "Life";
  // 3. Dental / Vision
  if (/DENTAL|VISION|\bDV\b|UDN|UDEN/.test(s)) return "DV";
  // 4. Home Health Care (before HI so "HHC + HI" combos class as HHC).
  if (/HHC|HOME HEALTH/.test(s)) return "HHC";
  // 5. Hospital Indemnity (HIP / HI / GHI / "Hospital Indemnity").
  // Emit "HIP" to match the GHL/Zapier product path label (Charlie, 2026-07-01).
  if (/HOSPITAL INDEMNITY|HIP|GHI|\bHI\b/.test(s)) return "HIP";

  return "Unknown";
}

// Minimal shape the evaluator needs off a synced policy row.
export interface PolicyState {
  policy_number: string;
  contract_code: string | null; // A / P / T / S (raw UNL code)
  billing_mode: string | null; // "1" monthly, "3" quarterly, ...
  billing_form: string | null; // PAC / DIR
  policy_effective_date: string | null; // YYYY-MM-DD
  paid_to_date: string | null; // YYYY-MM-DD
  contract_reason?: string | null;
}

// Last-known state captured BEFORE the upsert overwrites form_submissions.
export interface PriorState {
  contract_code: string | null;
  at_risk_fired_at: string | null; // non-null => at-risk already fired, don't re-blast
}

export interface LifecycleEvent {
  trigger: Trigger;
  policy_number: string;
  previous_contract_code: string | null;
  contract_reason: string | null;
  risk_signal: string | null;
}

function parseIso(d: string | null): number | null {
  if (!d) return null;
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
}

// Start-of-today in UTC, for a strict paid_to_date < today comparison.
function todayUtcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Derived at-risk signal (Charlie, 2026-06-30): active + DIR + paid_to_date is
 * in the past. i.e. an active, direct-bill policy whose premium is paid through
 * a date earlier than today has fallen behind on its draft.
 *
 * `now` is injectable for deterministic tests.
 */
export function deriveAtRisk(p: PolicyState, now: number = Date.now()): boolean {
  // ACTIVE policies only. A pending (P) / submission-status policy has not
  // completed a draft yet, so it must never fire at-risk automatically — the
  // whole pending/submission status is paused + locked until the UNL webhook
  // cutover (see SUBMISSION_TRIGGER_ENABLED). Terminated/suspended are also out.
  const code = (p.contract_code || "").trim().toUpperCase();
  if (code !== "A") return false;

  // Direct-bill only (PAC auto-draft is out of scope).
  const form = (p.billing_form || "").trim().toUpperCase();
  if (form !== "DIR") return false;

  // paid_to_date strictly before today => behind on premium => at risk.
  const ptd = parseIso(p.paid_to_date);
  if (ptd === null) return false; // no paid-to-date on file => not evaluable
  return ptd < todayUtcMidnight(now);
}

// TEMPORARY: the `submission` event is currently owned by the intake form
// (public-api -> Zapier hook up1e31i) which fires the moment an app is
// submitted. Until the live UNL webhook replaces that intake form, having the
// data-side evaluator ALSO fire `submission` on Contract Code -> P would
// double-trigger the same policy. So submission is disabled here by default.
//
// LOCKED (Charlie, 2026-06-30): the pending/submission status is PAUSED. Do not
// flip this to true (and do not pass { emitSubmission: true } from production)
// without an explicit manual thumbs-up AND the live UNL webhook in place. Until
// then the intake form remains the single source of the submission event.
export const SUBMISSION_TRIGGER_ENABLED = false;

export interface LifecycleOptions {
  // Override the submission gate (defaults to SUBMISSION_TRIGGER_ENABLED).
  emitSubmission?: boolean;
}

/**
 * Compute the lifecycle events fired by a single policy given its prior state.
 * Returns 0+ events. Pure — no side effects.
 *
 * Transition rules require a specific prior code, so a brand-new policy
 * (prior === undefined) never fires a false approved/terminated on first
 * insert. `submission` is gated off by default (see SUBMISSION_TRIGGER_ENABLED)
 * to avoid double-firing against the intake form.
 */
export function computeLifecycleEvents(
  next: PolicyState,
  prior: PriorState | undefined,
  now: number = Date.now(),
  opts: LifecycleOptions = {},
): LifecycleEvent[] {
  const events: LifecycleEvent[] = [];
  const prevCode = prior?.contract_code ?? null;
  const nextCode = (next.contract_code || "").trim().toUpperCase() || null;
  const emitSubmission = opts.emitSubmission ?? SUBMISSION_TRIGGER_ENABLED;

  const base = {
    policy_number: next.policy_number,
    previous_contract_code: prevCode,
    contract_reason: next.contract_reason ?? null,
    risk_signal: null as string | null,
  };

  // 1. submission — Contract Code flips to P.
  // Disabled by default while the intake form still owns this event.
  if (emitSubmission && nextCode === "P" && prevCode !== "P") {
    events.push({ ...base, trigger: "submission" });
  }
  // 2. approved — P -> A
  if (prevCode === "P" && nextCode === "A") {
    events.push({ ...base, trigger: "approved" });
  }
  // 3. terminated — A -> T (carries contract_reason)
  if (prevCode === "A" && nextCode === "T") {
    events.push({ ...base, trigger: "terminated" });
  }

  return events;
}

/**
 * Decide the at-risk transition for a policy. Fire only on flip-true (was not
 * already flagged). Signals when the persisted flag should be set or cleared so
 * the caller can update at_risk_fired_at without re-blasting daily.
 */
export interface AtRiskDecision {
  fire: boolean; // emit an "at risk" event now
  event: LifecycleEvent | null;
  setFlag: boolean; // persist at_risk_fired_at = now
  clearFlag: boolean; // reset at_risk_fired_at = null (recovered / no longer at risk)
}

export function evaluateAtRisk(
  next: PolicyState,
  prior: PriorState | undefined,
  now: number = Date.now(),
): AtRiskDecision {
  const isAtRisk = deriveAtRisk(next, now);
  const alreadyFired = !!prior?.at_risk_fired_at;

  if (isAtRisk && !alreadyFired) {
    return {
      fire: true,
      setFlag: true,
      clearFlag: false,
      event: {
        trigger: "at risk",
        policy_number: next.policy_number,
        previous_contract_code: prior?.contract_code ?? null,
        contract_reason: next.contract_reason ?? null,
        risk_signal: "active-dir-paid-to-date-past-due",
      },
    };
  }
  // Recovered: was flagged, no longer at risk => clear so it can re-fire later.
  if (!isAtRisk && alreadyFired) {
    return { fire: false, event: null, setFlag: false, clearFlag: true };
  }
  return { fire: false, event: null, setFlag: false, clearFlag: false };
}
