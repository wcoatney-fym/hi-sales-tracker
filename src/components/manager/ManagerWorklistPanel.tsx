import { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  AlertTriangle,
  X,
  Send,
  Flag,
  Bell,
  MessageSquare,
} from "lucide-react";
import {
  mgrGetAtRiskWorklist,
  mgrGetPolicyThread,
  mgrPostNote,
  mgrSetDisposition,
} from "../../lib/api";
import type {
  ManagerWorklistPolicy,
  PolicyThreadEntry,
  ManagerDisposition,
  ThreadKind,
} from "../../lib/api";

interface ManagerWorklistPanelProps {
  token: string;
}

const DISPOSITIONS: { key: ManagerDisposition; label: string; color: string }[] = [
  { key: "working", label: "Working", color: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  { key: "secured", label: "Secured", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
  { key: "follow_up", label: "Follow Up", color: "bg-sky-500/10 text-sky-400 border-sky-500/30" },
  { key: "lost", label: "Lost", color: "bg-rose-500/10 text-rose-400 border-rose-500/30" },
];

function dispositionConf(d: ManagerDisposition | null) {
  return DISPOSITIONS.find((x) => x.key === d) || null;
}

function daysLapsed(paidToDate: string | null): number | null {
  if (!paidToDate) return null;
  const ptd = new Date(paidToDate).getTime();
  if (Number.isNaN(ptd)) return null;
  return Math.floor((Date.now() - ptd) / 86400000);
}

export default function ManagerWorklistPanel({ token }: ManagerWorklistPanelProps) {
  const [worklist, setWorklist] = useState<ManagerWorklistPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<ManagerWorklistPolicy | null>(null);

  const fetchWorklist = useCallback(async () => {
    setLoading(true);
    try {
      const res = await mgrGetAtRiskWorklist(token);
      const list: ManagerWorklistPolicy[] = (res.worklist as ManagerWorklistPolicy[]) || [];
      // Worst-first: most days lapsed at the top.
      list.sort((a, b) => (daysLapsed(b.paid_to_date) ?? -1) - (daysLapsed(a.paid_to_date) ?? -1));
      setWorklist(list);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load worklist");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchWorklist();
  }, [fetchWorklist]);

  const handleDispositionChange = (policyId: string, disposition: ManagerDisposition) => {
    setWorklist((prev) =>
      prev.map((p) => (p.id === policyId ? { ...p, disposition } : p))
    );
    setSelected((prev) => (prev && prev.id === policyId ? { ...prev, disposition } : prev));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="animate-spin text-gold" size={28} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-400 text-sm">{error}</p>
        <button onClick={fetchWorklist} className="mt-3 text-xs text-gold hover:underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle size={16} className="text-amber-400" />
        <h3 className="text-sm font-semibold text-white">At-Risk Worklist</h3>
        <span className="text-xs text-slate-500">({worklist.length})</span>
      </div>

      {worklist.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm bg-navy rounded-xl border border-slate-700/50">
          No at-risk policies right now. Nice and clean.
        </div>
      ) : (
        <div className="grid gap-3">
          {worklist.map((p) => {
            const days = daysLapsed(p.paid_to_date);
            const daysColor =
              days === null ? "text-slate-500"
              : days > 60 ? "text-rose-400"
              : days > 30 ? "text-amber-400"
              : "text-yellow-300";
            const dispConf = dispositionConf(p.disposition);
            return (
              <button
                key={p.id}
                onClick={() => setSelected(p)}
                className="w-full text-left bg-navy border border-slate-700/50 rounded-xl p-4 hover:border-gold/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">
                      {p.client_first_name} {p.client_last_name}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5 truncate">
                      {p.carrier} - {p.product_type} - ${((p.plan_premium || 0) * 12).toLocaleString(undefined, { maximumFractionDigits: 0 })} AP
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                      Agent: {p.agent_first_name} {p.agent_last_name}
                      {p.agent_number ? ` (#${p.agent_number})` : ""}
                    </p>
                    {p.policy_number && (
                      <p className="text-[10px] text-slate-600 font-mono mt-0.5">{p.policy_number}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    {days !== null && (
                      <>
                        <p className={`text-sm font-bold ${daysColor}`}>{days}d</p>
                        <p className="text-[9px] text-slate-500">overdue</p>
                      </>
                    )}
                    {dispConf && (
                      <span className={`inline-block mt-1.5 px-2 py-0.5 rounded text-[9px] font-medium border ${dispConf.color}`}>
                        {dispConf.label}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <PolicyDrawer
          token={token}
          policy={selected}
          onClose={() => setSelected(null)}
          onDispositionChange={handleDispositionChange}
        />
      )}
    </div>
  );
}

function PolicyDrawer({
  token,
  policy,
  onClose,
  onDispositionChange,
}: {
  token: string;
  policy: ManagerWorklistPolicy;
  onClose: () => void;
  onDispositionChange: (policyId: string, disposition: ManagerDisposition) => void;
}) {
  const [thread, setThread] = useState<PolicyThreadEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<ThreadKind>("nudge");
  const [posting, setPosting] = useState(false);
  const [savingDisp, setSavingDisp] = useState<ManagerDisposition | null>(null);
  const [disposition, setDisposition] = useState<ManagerDisposition | null>(policy.disposition);

  const fetchThread = useCallback(async () => {
    setLoading(true);
    try {
      const res = await mgrGetPolicyThread(token, policy.id);
      setThread((res.thread as PolicyThreadEntry[]) || []);
      if (res.disposition) setDisposition(res.disposition as ManagerDisposition);
    } catch {
      setThread([]);
    } finally {
      setLoading(false);
    }
  }, [token, policy.id]);

  useEffect(() => {
    fetchThread();
  }, [fetchThread]);

  const handlePost = async () => {
    if (!note.trim()) return;
    setPosting(true);
    try {
      // The worklist row carries agent_number but not agent_id; the backend
      // resolves the owning agent from the policy when agent_id is omitted.
      await mgrPostNote(token, {
        policyId: policy.id,
        note: note.trim(),
        kind,
      });
      setNote("");
      await fetchThread();
    } catch {
      /* keep text for retry */
    } finally {
      setPosting(false);
    }
  };

  const handleDisposition = async (d: ManagerDisposition) => {
    setSavingDisp(d);
    try {
      await mgrSetDisposition(token, { policyId: policy.id, disposition: d });
      setDisposition(d);
      onDispositionChange(policy.id, d);
    } catch {
      /* ignore */
    } finally {
      setSavingDisp(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-navy-light border border-slate-700 rounded-xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-slate-700/50">
          <div className="min-w-0">
            <h3 className="text-white font-semibold truncate">
              {policy.client_first_name} {policy.client_last_name}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5 truncate">
              {policy.carrier} - {policy.product_type} - Agent {policy.agent_first_name} {policy.agent_last_name}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1">
            <X size={18} />
          </button>
        </div>

        {/* Disposition control (manager only) */}
        <div className="px-5 py-4 border-b border-slate-700/50">
          <p className="text-[11px] uppercase tracking-wider text-slate-500 font-medium mb-2">
            Disposition
          </p>
          <div className="flex flex-wrap gap-2">
            {DISPOSITIONS.map((d) => {
              const active = disposition === d.key;
              return (
                <button
                  key={d.key}
                  onClick={() => handleDisposition(d.key)}
                  disabled={savingDisp !== null}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50 flex items-center gap-1.5 ${
                    active ? d.color : "bg-navy border-slate-600/50 text-slate-400 hover:text-white"
                  }`}
                >
                  {savingDisp === d.key && <Loader2 size={12} className="animate-spin" />}
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Thread */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <p className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">Conversation</p>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={18} className="animate-spin text-gold" />
            </div>
          ) : thread.length === 0 ? (
            <p className="text-sm text-slate-500 py-4 text-center">No notes yet. Start the conversation below.</p>
          ) : (
            thread.map((t) => (
              <div
                key={t.id}
                className={`rounded-lg p-3 border ${
                  t.author_role === "manager"
                    ? "bg-gold/5 border-gold/20 ml-6"
                    : "bg-navy border-slate-700/50 mr-6"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] font-semibold uppercase ${t.author_role === "manager" ? "text-gold" : "text-sky-400"}`}>
                    {t.author_role}
                  </span>
                  {t.kind !== "note" && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-300 flex items-center gap-1">
                      {t.kind === "flag" ? <Flag size={9} /> : <Bell size={9} />}
                      {t.kind}
                    </span>
                  )}
                  <span className="text-[10px] text-slate-600 ml-auto">
                    {new Date(t.created_at).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm text-slate-200 whitespace-pre-wrap">{t.note}</p>
              </div>
            ))
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-slate-700/50 p-4 space-y-3">
          <div className="flex gap-2">
            {(["nudge", "flag", "note"] as ThreadKind[]).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5 ${
                  kind === k
                    ? "bg-gold/15 border-gold/30 text-gold"
                    : "bg-navy border-slate-600/50 text-slate-400 hover:text-white"
                }`}
              >
                {k === "flag" ? <Flag size={12} /> : k === "nudge" ? <Bell size={12} /> : <MessageSquare size={12} />}
                {k.charAt(0).toUpperCase() + k.slice(1)}
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder={
                kind === "flag"
                  ? "Flag this policy for the agent's attention..."
                  : kind === "nudge"
                  ? "Nudge the agent to work this policy..."
                  : "Add a note..."
              }
              className="flex-1 bg-navy border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-gold resize-none"
            />
            <button
              onClick={handlePost}
              disabled={posting || !note.trim()}
              className="btn-primary !px-3 !py-2 flex items-center gap-1.5 disabled:opacity-50"
            >
              {posting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
