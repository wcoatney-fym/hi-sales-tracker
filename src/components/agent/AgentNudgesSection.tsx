import { useState, useEffect, useCallback } from "react";
import {
  Bell,
  Flag,
  Loader2,
  Send,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  agentGetNotifications,
  agentGetPolicyThread,
  agentReplyNote,
} from "../../lib/api";
import type { AgentNotification, PolicyThreadEntry } from "../../lib/api";

interface AgentNudgesSectionProps {
  sessionToken: string;
}

interface FlaggedPolicy {
  policyId: string;
  latestBody: string;
  latestType: AgentNotification["type"];
  latestAt: string;
}

// Agent mirror of the manager's nudges/flags. Shows flagged policies and lets
// the agent reply into the same thread. NO disposition control for agents.
export default function AgentNudgesSection({ sessionToken }: AgentNudgesSectionProps) {
  const [policies, setPolicies] = useState<FlaggedPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchNudges = useCallback(async () => {
    setLoading(true);
    try {
      const res = await agentGetNotifications(sessionToken, false);
      const list: AgentNotification[] = res.notifications || [];
      // Group by policy_id, keep the most recent nudge/flag per policy.
      const byPolicy = new Map<string, FlaggedPolicy>();
      for (const n of list) {
        if (!n.policy_id) continue;
        if (n.type !== "flag" && n.type !== "nudge") continue;
        const existing = byPolicy.get(n.policy_id);
        if (!existing || new Date(n.created_at) > new Date(existing.latestAt)) {
          byPolicy.set(n.policy_id, {
            policyId: n.policy_id,
            latestBody: n.body,
            latestType: n.type,
            latestAt: n.created_at,
          });
        }
      }
      const arr = [...byPolicy.values()].sort(
        (a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime()
      );
      setPolicies(arr);
    } catch {
      setPolicies([]);
    } finally {
      setLoading(false);
    }
  }, [sessionToken]);

  useEffect(() => {
    fetchNudges();
  }, [fetchNudges]);

  if (loading) {
    return (
      <section className="bg-navy rounded-xl border border-amber-500/20 p-6 flex items-center justify-center">
        <Loader2 size={18} className="animate-spin text-amber-400" />
      </section>
    );
  }

  if (policies.length === 0) return null;

  return (
    <section className="bg-navy rounded-xl border border-amber-500/20 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-700/30 flex items-center gap-2">
        <Bell size={14} className="text-amber-400" />
        <h3 className="text-sm font-semibold text-amber-400">Nudges from My Manager</h3>
        <span className="text-xs text-slate-500">({policies.length})</span>
      </div>
      <div className="divide-y divide-slate-700/30">
        {policies.map((p) => (
          <NudgeRow
            key={p.policyId}
            sessionToken={sessionToken}
            policy={p}
            expanded={expanded === p.policyId}
            onToggle={() => setExpanded((cur) => (cur === p.policyId ? null : p.policyId))}
          />
        ))}
      </div>
    </section>
  );
}

function NudgeRow({
  sessionToken,
  policy,
  expanded,
  onToggle,
}: {
  sessionToken: string;
  policy: FlaggedPolicy;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [thread, setThread] = useState<PolicyThreadEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  const fetchThread = useCallback(async () => {
    setLoading(true);
    try {
      const res = await agentGetPolicyThread(sessionToken, policy.policyId);
      setThread(res.thread || []);
    } catch {
      setThread([]);
    } finally {
      setLoading(false);
    }
  }, [sessionToken, policy.policyId]);

  useEffect(() => {
    if (expanded) fetchThread();
  }, [expanded, fetchThread]);

  const handleReply = async () => {
    if (!reply.trim()) return;
    setSending(true);
    try {
      await agentReplyNote(sessionToken, policy.policyId, reply.trim());
      setReply("");
      await fetchThread();
    } catch {
      /* keep text for retry */
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-navy-light/30 transition-colors">
        <div className="shrink-0">
          {policy.latestType === "flag" ? (
            <Flag size={14} className="text-rose-400" />
          ) : (
            <Bell size={14} className="text-amber-400" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-200 truncate">{policy.latestBody}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">{new Date(policy.latestAt).toLocaleString()}</p>
        </div>
        {expanded ? <ChevronDown size={16} className="text-slate-500 shrink-0" /> : <ChevronRight size={16} className="text-slate-500 shrink-0" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 size={16} className="animate-spin text-amber-400" />
            </div>
          ) : thread.length === 0 ? (
            <p className="text-xs text-slate-500 py-2">No messages yet.</p>
          ) : (
            <div className="space-y-2">
              {thread.map((t) => (
                <div
                  key={t.id}
                  className={`rounded-lg p-3 border ${
                    t.author_role === "manager"
                      ? "bg-amber-500/5 border-amber-500/20 mr-6"
                      : "bg-navy-light border-slate-700/50 ml-6"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-semibold uppercase ${t.author_role === "manager" ? "text-amber-400" : "text-sky-400"}`}>
                      {t.author_role === "manager" ? "Manager" : "You"}
                    </span>
                    {t.kind !== "note" && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-300 flex items-center gap-1">
                        {t.kind === "flag" ? <Flag size={9} /> : <Bell size={9} />}
                        {t.kind}
                      </span>
                    )}
                    <span className="text-[10px] text-slate-600 ml-auto">{new Date(t.created_at).toLocaleString()}</span>
                  </div>
                  <p className="text-sm text-slate-200 whitespace-pre-wrap">{t.note}</p>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2">
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={2}
              placeholder="Reply to your manager..."
              className="flex-1 bg-navy-light border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500 resize-none"
            />
            <button
              onClick={handleReply}
              disabled={sending || !reply.trim()}
              className="px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
