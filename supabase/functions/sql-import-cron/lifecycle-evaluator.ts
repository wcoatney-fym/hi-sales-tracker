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

const DAY_MS = 24 * 60 * 60 * 1000;
const AT_RISK_WINDOW_DAYS = 60;
// One monthly cycle of grace on paid_to_date past the effective date. If the
// carrier hasn't collected past effective + ~1 cycle, the draft didn't hold.
const ONE_CYCLE_DAYS = 31;

function parseIso(d: string | null): number | null {
  if (!d) return null;
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
}

/**
 * Derived at-risk signal. True when a monthly, direct-bill (DIR) policy is
 * inside its first 60 days and its paid_to_date has NOT advanced one cycle
 * past the effective date — i.e. the early draft failed to hold.
 *
 * `now` is injectable for deterministic tests.
 */
export function deriveAtRisk(p: PolicyState, now: number = Date.now()): boolean {
  // Only monthly + direct-bill policies are in scope for the early-draft signal.
  const mode = (p.billing_mode || "").trim();
  const form = (p.billing_form || "").trim().toUpperCase();
  if (mode !== "1") return false;
  if (form !== "DIR") return false;

  const eff = parseIso(p.policy_effective_date);
  if (eff === null) return false;

  // Inside the first 60 days of coverage only.
  const ageDays = (now - eff) / DAY_MS;
  if (ageDays < 0 || ageDays > AT_RISK_WINDOW_DAYS) return false;

  // paid_to_date must have advanced at least one cycle past effective.
  const ptd = parseIso(p.paid_to_date);
  if (ptd === null) return true; // never drafted past effective => at risk
  return ptd <= eff + ONE_CYCLE_DAYS * DAY_MS;
}

/**
 * Compute the lifecycle events fired by a single policy given its prior state.
 * Returns 0+ events. Pure — no side effects.
 *
 * Transition rules require a specific prior code, so a brand-new policy
 * (prior === undefined) only ever fires "submission" (when it lands as P) and
 * "at risk", never a false approved/terminated on first insert.
 */
export function computeLifecycleEvents(
  next: PolicyState,
  prior: PriorState | undefined,
  now: number = Date.now(),
): LifecycleEvent[] {
  const events: LifecycleEvent[] = [];
  const prevCode = prior?.contract_code ?? null;
  const nextCode = (next.contract_code || "").trim().toUpperCase() || null;

  const base = {
    policy_number: next.policy_number,
    previous_contract_code: prevCode,
    contract_reason: next.contract_reason ?? null,
    risk_signal: null as string | null,
  };

  // 1. submission — Contract Code flips to P
  if (nextCode === "P" && prevCode !== "P") {
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
        risk_signal: "early-draft-not-held",
      },
    };
  }
  // Recovered: was flagged, no longer at risk => clear so it can re-fire later.
  if (!isAtRisk && alreadyFired) {
    return { fire: false, event: null, setFlag: false, clearFlag: true };
  }
  return { fire: false, event: null, setFlag: false, clearFlag: false };
}
