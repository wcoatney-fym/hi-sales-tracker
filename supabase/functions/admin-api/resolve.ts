// Agent-resolution helpers for admin-api.
//
// Extracted into their own module so they can be unit-tested without booting
// the edge function's HTTP server (index.ts calls Deno.serve at import time).

// Minimal structural type of the Supabase query surface we use here, so the
// resolver can be exercised with a lightweight stub in tests.
export interface SupabaseLike {
  from: (table: string) => any;
}

/**
 * Resolve the agents.id that owns a policy, using the policy's writing number.
 *
 * Matches the current UNL/GTL writing number or any prior/alias writing number
 * (carrier number reassignments leave historical form_submissions stamped with
 * the old agent_number). Returns null when no unambiguous single match exists,
 * so we never mis-attribute a notification.
 */
export async function resolveAgentIdFromPolicy(
  supabase: SupabaseLike,
  policyId: string
): Promise<string | null> {
  const { data: policy } = await supabase
    .from("form_submissions")
    .select("agent_number")
    .eq("id", policyId)
    .maybeSingle();
  const num = (policy?.agent_number || "").trim().toUpperCase();
  if (!num) return null;
  const { data: matches } = await supabase
    .from("agents")
    .select("id")
    .or(
      `unl_writing_number.eq.${num},gtl_writing_number.eq.${num},prior_writing_numbers.cs.{${num}}`
    )
    .limit(2);
  // Only attribute when exactly one agent owns the writing number.
  if (matches && matches.length === 1) return matches[0].id as string;
  return null;
}
