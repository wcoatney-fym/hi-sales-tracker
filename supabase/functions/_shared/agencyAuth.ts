// Shared agency-access authorization — single source of truth for "can this
// session view this agency's quality data." Mirrors the rule Charlie established
// in leaderboard-api so the direct-query function and the RPC path stay in lockstep.
//
// Rules:
//   - Global admin (admin session with no agency_id): any agency + whole-book.
//   - Scoped admin: only their agency (never whole-book).
//   - Agent: only their own agency (never whole-book).
//   - agencyId === null means "whole book" — allowed only for global admins.
//   - Managers are intentionally NOT handled here (matches current behavior);
//     granting managers access is a separate, deliberate product decision.
// deno-lint-ignore no-explicit-any
export async function authorizeAgencyAccess(
  supabase: any,
  accessToken: string,
  agencyId: string | null,
): Promise<boolean> {
  if (!accessToken) return false;
  const nowIso = new Date().toISOString();

  const { data: adminSession } = await supabase
    .from("admin_sessions")
    .select("agency_id")
    .eq("token", accessToken)
    .gt("expires_at", nowIso)
    .maybeSingle();
  if (adminSession) {
    return !adminSession.agency_id || (agencyId !== null && adminSession.agency_id === agencyId);
  }

  if (!agencyId) return false;

  const { data: agentSession } = await supabase
    .from("agent_sessions")
    .select("agent_id")
    .eq("token", accessToken)
    .gt("expires_at", nowIso)
    .maybeSingle();
  if (agentSession) {
    const { data: sessionAgent } = await supabase
      .from("agents")
      .select("agency_id")
      .eq("id", agentSession.agent_id)
      .maybeSingle();
    return !!sessionAgent && sessionAgent.agency_id === agencyId;
  }

  return false;
}
