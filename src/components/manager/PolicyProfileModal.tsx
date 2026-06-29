import { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  X,
  Send,
  Flag,
  Bell,
  MessageSquare,
  User,
  Phone,
  Mail,
  FileText,
  Calendar,
  DollarSign,
  ShieldAlert,
} from "lucide-react";
import {
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

const DISPOSITIONS: { key: ManagerDisposition; label: string; color: string }[] = [
  { key: "working", label: "Working", color: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  { key: "secured", label: "Secured", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
  { key: "follow_up", label: "Follow Up", color: "bg-sky-500/10 text-sky-400 border-sky-500/30" },
  { key: "lost", label: "Lost", color: "bg-rose-500/10 text-rose-400 border-rose-500/30" },
];

function daysLapsed(paidToDate: string | null): number | null {
  if (!paidToDate) return null;
  const ptd = new Date(paidToDate).getTime();
  if (Number.isNaN(ptd)) return null;
  return Math.floor((Date.now() - ptd) / 86400000);
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return "—";
  return t.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function ProfileField({
  icon: Icon,
  label,
  value,
  valueClass = "text-white",
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon size={14} className="text-slate-500 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
        <p className={`text-sm font-medium truncate ${valueClass}`}>{value}</p>
      </div>
    </div>
  );
}

export default function PolicyProfileModal({
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

  const monthly = policy.plan_premium || 0;
  const annual = monthly * 12;
  const overdue = daysLapsed(policy.paid_to_date);
  const overdueClass =
    overdue === null ? "text-slate-400"
    : overdue > 60 ? "text-rose-400"
    : overdue > 30 ? "text-amber-400"
    : "text-yellow-300";

  // Agent contact info is not yet on the worklist payload (see PR-2: wire the
  // contact source). Render gracefully until the field lands.
  const agentPhone = (policy as { agent_phone?: string | null }).agent_phone || null;
  const agentEmail = (policy as { agent_email?: string | null }).agent_email || null;
  const clientPhone = policy.client_phone || null;
  const clientEmail = policy.client_email || null;

  const fetchThread = useCallback(async () => {
    setLoading(true);
    try {
      const res = await mgrGetPolicyThread(token, policy.id);
      setThread((res.thread as PolicyThreadEntry[]) || []);
      if (res.disposition) setDisposition((res.disposition as { disposition?: ManagerDisposition })?.disposition ?? (res.disposition as ManagerDisposition));
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
      await mgrPostNote(token, { policyId: policy.id, note: note.trim(), kind });
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-navy-light border border-slate-700 rounded-xl w-full max-w-lg max-h-[88vh] flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-slate-700/50">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-white font-semibold truncate">
                {policy.client_first_name} {policy.client_last_name}
              </h3>
              {policy.status && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-300 border border-slate-600/50 whitespace-nowrap">
                  {policy.status}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5 truncate">
              {policy.product_type} · {policy.carrier}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Client / policy profile */}
          <div className="px-5 py-4 border-b border-slate-700/50">
            <p className="text-[11px] uppercase tracking-wider text-slate-500 font-medium mb-3">
              Client Profile
            </p>
            <div className="grid grid-cols-2 gap-y-3 gap-x-4">
              <ProfileField icon={FileText} label="Policy #" value={policy.policy_number || "—"} />
              <ProfileField icon={ShieldAlert} label="Status" value={policy.status || "—"} />
              <ProfileField icon={DollarSign} label="Premium (mo)" value={fmtMoney(monthly)} />
              <ProfileField icon={DollarSign} label="Annualized" value={fmtMoney(annual)} />
              <ProfileField icon={Calendar} label="Effective" value={fmtDate(policy.policy_effective_date)} />
              <ProfileField icon={Calendar} label="Paid To" value={fmtDate(policy.paid_to_date)} />
              <ProfileField
                icon={Calendar}
                label="Days Overdue"
                value={overdue === null ? "—" : `${overdue}d`}
                valueClass={overdueClass}
              />
              <ProfileField icon={FileText} label="Product" value={`${policy.product_type} · ${policy.carrier}`} />
            </div>
          </div>

          {/* Client contact */}
          <div className="px-5 py-4 border-b border-slate-700/50">
            <p className="text-[11px] uppercase tracking-wider text-slate-500 font-medium mb-3">
              Client Contact
            </p>
            <div className="grid grid-cols-2 gap-y-3 gap-x-4">
              <ProfileField
                icon={Phone}
                label="Phone"
                value={clientPhone ? <a href={`tel:${clientPhone}`} className="text-gold hover:underline">{clientPhone}</a> : "—"}
              />
              <ProfileField
                icon={Mail}
                label="Email"
                value={clientEmail ? <a href={`mailto:${clientEmail}`} className="text-gold hover:underline">{clientEmail}</a> : "—"}
              />
            </div>
          </div>

          {/* Agent of record */}
          <div className="px-5 py-4 border-b border-slate-700/50">
            <p className="text-[11px] uppercase tracking-wider text-slate-500 font-medium mb-3">
              Agent of Record
            </p>
            <div className="grid grid-cols-2 gap-y-3 gap-x-4">
              <ProfileField
                icon={User}
                label="Agent"
                value={`${policy.agent_first_name} ${policy.agent_last_name}`.trim() || "—"}
              />
              <ProfileField icon={User} label="Writing #" value={policy.agent_number || "—"} />
              <ProfileField
                icon={Phone}
                label="Phone"
                value={agentPhone ? <a href={`tel:${agentPhone}`} className="text-gold hover:underline">{agentPhone}</a> : "—"}
              />
              <ProfileField
                icon={Mail}
                label="Email"
                value={agentEmail ? <a href={`mailto:${agentEmail}`} className="text-gold hover:underline">{agentEmail}</a> : "—"}
              />
            </div>
          </div>

          {/* Disposition control */}
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
          <div className="px-5 py-4 space-y-3">
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
