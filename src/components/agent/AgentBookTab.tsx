import { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  FileText,
  DollarSign,
  AlertTriangle,
  ShieldCheck,
  MessageSquarePlus,
  X,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock,
  CircleDot,
} from "lucide-react";
import {
  agentGetBookSummary,
  agentGetAtRiskPolicies,
  agentLogAtRiskActivity,
  agentLogContact,
  agentMarkSaved,
  agentGetAttentionStates,
  agentUpdateAttentionState,
} from "../../lib/api";
import { resolvePlanName } from "../../lib/planCodes";
import type { AttentionState } from "../../types/leaderboard";
import AgentNudgesSection from "./AgentNudgesSection";

interface BookCounts {
  active: number;
  pending: number;
  terminated: number;
  at_risk: number;
  total_premium_in_force: number;
}

interface PolicyItem {
  id: string;
  policy_number: string | null;
  client_first_name: string;
  client_last_name: string;
  plan_name: string;
  carrier: string;
  plan_premium: number;
  annual_premium: number;
  status: string;
  policy_effective_date: string;
  paid_to_date: string | null;
  product_type: string;
  contract_code: string | null;
  billing_mode: string | null;
  billing_form: string | null;
  is_at_risk: boolean;
}

interface AtRiskPolicy {
  policy_id: string;
  policy_number: string | null;
  client_first_name: string;
  client_last_name: string;
  plan_name: string;
  carrier: string;
  plan_premium: number;
  paid_to_date: string;
  days_lapsed: number;
  activities: { id: string; action_type: string; note: string; created_at: string }[] | null;
}

const STATUS_FILTERS = [
  { key: null, label: "All" },
  { key: "active", label: "Active" },
  { key: "pending", label: "Pending" },
  { key: "at_risk", label: "At Risk" },
  { key: "terminated", label: "Terminated" },
] as const;

const ACTION_LABELS: Record<string, string> = {
  called_client: "Called Client",
  called_carrier: "Called Carrier",
  payment_confirmed: "Payment Confirmed",
  lapse_notice_sent: "Lapse Notice Sent",
  other: "Other",
};

const CONTRACT_LABELS: Record<string, { label: string; color: string }> = {
  A: { label: "Active", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  T: { label: "Terminated", color: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  P: { label: "Pending", color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  S: { label: "Suspended", color: "bg-slate-500/10 text-slate-400 border-slate-500/20" },
};

const BILLING_LABELS: Record<string, string> = {
  "0": "Single",
  "1": "Monthly",
  "3": "Quarterly",
  "6": "Semi-Annual",
  "12": "Annual",
};

const ATTENTION_STATE_CONFIG: Record<AttentionState, { label: string; icon: typeof CircleDot; color: string }> = {
  got_it: { label: "Got It", icon: CircleDot, color: "bg-sky-500/10 text-sky-400 border-sky-500/30" },
  working: { label: "Working", icon: Clock, color: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  done: { label: "Done", icon: CheckCircle2, color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
};

interface AgentBookTabProps {
  sessionToken: string;
}

export default function AgentBookTab({ sessionToken }: AgentBookTabProps) {
  const [counts, setCounts] = useState<BookCounts | null>(null);
  const [policies, setPolicies] = useState<PolicyItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [atRiskPolicies, setAtRiskPolicies] = useState<AtRiskPolicy[]>([]);
  const [atRiskLoading, setAtRiskLoading] = useState(false);
  const [activityModal, setActivityModal] = useState<{ policyId: string; clientName: string } | null>(null);
  const [attentionStates, setAttentionStates] = useState<Record<string, AttentionState>>({});

  const fetchBook = useCallback(async () => {
    setLoading(true);
    try {
      const res = await agentGetBookSummary(sessionToken, page, statusFilter || undefined);
      setCounts(res.counts || null);
      setPolicies(res.policies || []);
      setTotal(res.total || 0);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [sessionToken, page, statusFilter]);

  const fetchAtRisk = useCallback(async () => {
    setAtRiskLoading(true);
    try {
      const res = await agentGetAtRiskPolicies(sessionToken);
      setAtRiskPolicies(res.policies || []);
    } catch {
      setAtRiskPolicies([]);
    } finally {
      setAtRiskLoading(false);
    }
  }, [sessionToken]);

  const fetchAttentionStates = useCallback(async () => {
    try {
      const res = await agentGetAttentionStates(sessionToken);
      const map: Record<string, AttentionState> = {};
      for (const a of res.actions || []) {
        map[a.form_submission_id] = a.state as AttentionState;
      }
      setAttentionStates(map);
    } catch { /* ignore */ }
  }, [sessionToken]);

  useEffect(() => { fetchBook(); }, [fetchBook]);
  useEffect(() => { fetchAtRisk(); }, [fetchAtRisk]);
  useEffect(() => { fetchAttentionStates(); }, [fetchAttentionStates]);

  const totalPages = Math.ceil(total / 20);

  const handleFilterChange = (key: string | null) => {
    setStatusFilter(key);
    setPage(1);
  };

  const handleAttentionCycle = async (policyId: string) => {
    const current = attentionStates[policyId];
    const next: AttentionState = !current ? "got_it" : current === "got_it" ? "working" : current === "working" ? "done" : "got_it";
    setAttentionStates((prev) => ({ ...prev, [policyId]: next }));
    try {
      await agentUpdateAttentionState(sessionToken, policyId, next);
    } catch { /* revert on error could be added */ }
  };

  const activeAtRisk = atRiskPolicies.filter((p) => attentionStates[p.policy_id] !== "done");
  const resolvedAtRisk = atRiskPolicies.filter((p) => attentionStates[p.policy_id] === "done");

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Nudges from my manager (flagged policies + reply thread) */}
      <AgentNudgesSection sessionToken={sessionToken} />

      {/* Book Summary KPIs */}
      {counts && (
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MiniKpi
            icon={FileText}
            iconColor="text-emerald-400"
            value={counts.active}
            label="Active Policies"
          />
          <MiniKpi
            icon={DollarSign}
            iconColor="text-sky-400"
            value={`$${counts.total_premium_in_force.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
            label="AP In Force"
          />
          <MiniKpi
            icon={FileText}
            iconColor="text-amber-400"
            value={counts.pending}
            label="Pending"
          />
          <MiniKpi
            icon={AlertTriangle}
            iconColor="text-rose-400"
            value={counts.at_risk}
            label="At Risk"
          />
        </section>
      )}

      {/* Status Filter Chips */}
      <section className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key || "all"}
            onClick={() => handleFilterChange(f.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              statusFilter === f.key
                ? "bg-gold/20 text-gold border border-gold/30"
                : "bg-navy border border-slate-700/50 text-slate-400 hover:text-white hover:border-slate-600"
            }`}
          >
            {f.label}
            {f.key === "at_risk" && counts?.at_risk ? (
              <span className="ml-1.5 bg-rose-500/20 text-rose-400 px-1.5 py-0.5 rounded-full text-[9px]">
                {counts.at_risk}
              </span>
            ) : null}
          </button>
        ))}
      </section>

      {/* Policy List */}
      <section className="bg-navy rounded-xl border border-slate-700/50 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="text-gold animate-spin" />
          </div>
        ) : policies.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">
            No policies found{statusFilter ? ` with status "${statusFilter}"` : ""}.
          </div>
        ) : (
          <>
            <div className="divide-y divide-slate-700/30">
              {policies.map((policy) => (
                <PolicyCard key={policy.id} policy={policy} />
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-700/30">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none"
                >
                  <ChevronLeft size={14} /> Prev
                </button>
                <span className="text-xs text-slate-500">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none"
                >
                  Next <ChevronRight size={14} />
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {/* At-Risk Policies with Action Chips */}
      {(statusFilter === null || statusFilter === "at_risk") && activeAtRisk.length > 0 && (
        <section className="bg-navy rounded-xl border border-amber-500/20 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700/30 flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-400" />
            <h3 className="text-sm font-semibold text-amber-400">Policies Needing Follow-Up</h3>
          </div>
          {atRiskLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={16} className="text-amber-400 animate-spin" />
            </div>
          ) : (
            <div className="divide-y divide-slate-700/30">
              {activeAtRisk.map((policy) => {
                const lastAct = policy.activities?.[0];
                const daysColor =
                  policy.days_lapsed > 60 ? "text-rose-400"
                  : policy.days_lapsed > 30 ? "text-amber-400"
                  : "text-yellow-300";
                const currentState = attentionStates[policy.policy_id];
                const stateConf = currentState ? ATTENTION_STATE_CONFIG[currentState] : null;

                return (
                  <div key={policy.policy_id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white font-medium truncate">
                        {policy.client_first_name} {policy.client_last_name}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5 truncate">
                        {resolvePlanName(policy.plan_name)} -- {policy.carrier} -- ${(policy.plan_premium * 12)?.toLocaleString(undefined, { maximumFractionDigits: 0 })} AP
                      </p>
                      {policy.policy_number && (
                        <p className="text-[10px] text-slate-600 font-mono mt-0.5">{policy.policy_number}</p>
                      )}
                      {lastAct && (
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          Last: {ACTION_LABELS[lastAct.action_type] || lastAct.action_type} ({new Date(lastAct.created_at).toLocaleDateString()})
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-bold ${daysColor}`}>{policy.days_lapsed}d</p>
                      <p className="text-[9px] text-slate-500">overdue</p>
                    </div>
                    {/* Action State Chip */}
                    <button
                      onClick={() => handleAttentionCycle(policy.policy_id)}
                      className={`px-2 py-1 rounded-md text-[10px] font-medium border transition-colors shrink-0 ${
                        stateConf ? stateConf.color : "bg-slate-700/30 text-slate-500 border-slate-600/30 hover:text-slate-300"
                      }`}
                      title="Cycle: Got It > Working > Done"
                    >
                      {stateConf ? stateConf.label : "Mark"}
                    </button>
                    <button
                      onClick={() => setActivityModal({
                        policyId: policy.policy_id,
                        clientName: `${policy.client_first_name} ${policy.client_last_name}`,
                      })}
                      className="p-2 rounded-md hover:bg-amber-500/10 text-amber-400 hover:text-amber-300 transition-colors shrink-0"
                      title="Log Follow-Up"
                    >
                      <MessageSquarePlus size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Resolved At-Risk (collapsed) */}
      {(statusFilter === null || statusFilter === "at_risk") && resolvedAtRisk.length > 0 && (
        <details className="bg-navy rounded-xl border border-slate-700/50 overflow-hidden">
          <summary className="px-4 py-3 flex items-center gap-2 cursor-pointer text-sm text-slate-400 hover:text-slate-200">
            <CheckCircle2 size={14} className="text-emerald-400" />
            <span>{resolvedAtRisk.length} resolved</span>
          </summary>
          <div className="divide-y divide-slate-700/30 border-t border-slate-700/30">
            {resolvedAtRisk.map((policy) => (
              <div key={policy.policy_id} className="flex items-center gap-3 px-4 py-2.5 opacity-60">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-400 truncate">
                    {policy.client_first_name} {policy.client_last_name} -- {resolvePlanName(policy.plan_name)}
                  </p>
                </div>
                <span className="text-[9px] text-emerald-400 font-medium">Done</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Healthy status if no at-risk */}
      {activeAtRisk.length === 0 && !atRiskLoading && (statusFilter === null || statusFilter === "at_risk") && atRiskPolicies.length === 0 && (
        <section className="flex items-center gap-3 bg-navy rounded-xl border border-slate-700/50 p-4">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
            <ShieldCheck size={18} className="text-emerald-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-white">All policies current</p>
            <p className="text-xs text-slate-400">No policies need follow-up right now.</p>
          </div>
        </section>
      )}

      {/* Activity Log Modal */}
      {activityModal && (
        <ActivityModal
          policyId={activityModal.policyId}
          clientName={activityModal.clientName}
          sessionToken={sessionToken}
          onClose={() => setActivityModal(null)}
          onSaved={() => {
            setActivityModal(null);
            fetchAtRisk();
          }}
        />
      )}
    </div>
  );
}

function MiniKpi({
  icon: Icon,
  iconColor,
  value,
  label,
}: {
  icon: React.ElementType;
  iconColor: string;
  value: number | string;
  label: string;
}) {
  return (
    <div className="bg-navy rounded-xl border border-slate-700/50 p-3.5">
      <Icon size={14} className={`${iconColor} mb-2`} />
      <p className="text-lg font-bold text-white">{value}</p>
      <p className="text-[10px] text-slate-500 mt-0.5">{label}</p>
    </div>
  );
}

function getEffectiveDateContext(dateStr: string): { label: string; color: string } | null {
  const effective = new Date(dateStr);
  const today = new Date();
  const diffMs = today.getTime() - effective.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays < 0) {
    return { label: `Eff. in ${Math.abs(diffDays)}d`, color: "text-sky-400" };
  }
  if (diffDays <= 30) {
    return { label: "Free Look", color: "text-amber-400" };
  }
  if (diffDays <= 90) {
    return { label: `Eff. ${Math.floor(diffDays / 30)}mo ago`, color: "text-slate-500" };
  }
  const months = Math.floor(diffDays / 30);
  return { label: `Eff. ${months}mo ago`, color: "text-slate-600" };
}

function PolicyCard({ policy }: { policy: PolicyItem }) {
  const contractConf = policy.contract_code ? CONTRACT_LABELS[policy.contract_code] : null;
  const billingLabel = policy.billing_mode ? BILLING_LABELS[policy.billing_mode] : null;
  const effectiveCtx = policy.policy_effective_date ? getEffectiveDateContext(policy.policy_effective_date) : null;

  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-navy-light/30 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm text-white font-medium truncate">
            {policy.client_first_name} {policy.client_last_name}
          </p>
          {policy.is_at_risk && (
            <AlertTriangle size={12} className="text-amber-400 shrink-0" />
          )}
        </div>
        <p className="text-xs text-slate-400 mt-0.5 truncate">
          {resolvePlanName(policy.plan_name)} -- {policy.carrier}
        </p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {policy.policy_number && (
            <span className="text-[10px] text-slate-600 font-mono">{policy.policy_number}</span>
          )}
          {contractConf && (
            <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-medium border ${contractConf.color}`}>
              {contractConf.label}
            </span>
          )}
          {billingLabel && (
            <span className="text-[9px] text-slate-600">{billingLabel}</span>
          )}
          {effectiveCtx && (
            <span className={`text-[9px] ${effectiveCtx.color}`}>{effectiveCtx.label}</span>
          )}
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-medium text-white">${(policy.annual_premium || policy.plan_premium * 12)?.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
        <p className="text-[9px] text-slate-600">AP</p>
        {!contractConf && (
          <span className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium ${
            policy.status === "active" ? "bg-emerald-500/10 text-emerald-400" :
            policy.status === "pending" ? "bg-amber-500/10 text-amber-400" :
            "bg-rose-500/10 text-rose-400"
          }`}>
            {policy.status}
          </span>
        )}
      </div>
    </div>
  );
}

function ActivityModal({
  policyId,
  clientName,
  sessionToken,
  onClose,
  onSaved,
}: {
  policyId: string;
  clientName: string;
  sessionToken: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [actionType, setActionType] = useState("called_client");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [pipelineAction, setPipelineAction] = useState<"contact" | "saved" | null>(null);

  const handleSave = async () => {
    setSaving(true);
    try {
      await agentLogAtRiskActivity(sessionToken, policyId, actionType, note);
      onSaved();
    } catch {
      // stay open
    } finally {
      setSaving(false);
    }
  };

  // Pipeline actions for a policy the manager handed to this agent: confirm
  // contact (5-day SLA) and mark saved (-> manager approval). Best-effort: a
  // policy not in agent_outreach simply won't be updated server-side.
  const handlePipeline = async (kind: "contact" | "saved") => {
    setPipelineAction(kind);
    try {
      if (kind === "contact") await agentLogContact(sessionToken, policyId);
      else await agentMarkSaved(sessionToken, policyId, note);
      onSaved();
    } catch {
      // stay open
    } finally {
      setPipelineAction(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-navy-light border border-slate-700 rounded-xl p-6 w-full max-w-md shadow-xl mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold">Log Follow-Up</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={18} /></button>
        </div>
        <p className="text-sm text-slate-400 mb-4">
          Policy for <span className="text-white font-medium">{clientName}</span>
        </p>
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 font-medium">Action Type</label>
            <select
              value={actionType}
              onChange={(e) => setActionType(e.target.value)}
              className="w-full bg-navy border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
            >
              {Object.entries(ACTION_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 font-medium">Note</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add details about your follow-up..."
              rows={3}
              className="w-full bg-navy border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500 resize-none"
            />
          </div>
          {/* Pipeline actions for manager-handed-off policies */}
          <div className="flex gap-3">
            <button
              onClick={() => handlePipeline("contact")}
              disabled={pipelineAction !== null}
              className="flex-1 px-4 py-2 border border-sky-500/40 text-sky-300 rounded-lg text-sm font-medium hover:bg-sky-500/10 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              title="Confirm you reached out (satisfies the 5-day follow-up)"
            >
              {pipelineAction === "contact" && <Loader2 size={14} className="animate-spin" />}
              Mark Contacted
            </button>
            <button
              onClick={() => handlePipeline("saved")}
              disabled={pipelineAction !== null}
              className="flex-1 px-4 py-2 border border-emerald-500/40 text-emerald-300 rounded-lg text-sm font-medium hover:bg-emerald-500/10 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              title="Mark saved — your manager approves to confirm"
            >
              {pipelineAction === "saved" && <Loader2 size={14} className="animate-spin" />}
              Mark Saved
            </button>
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={onClose} className="flex-1 px-4 py-2 border border-slate-600 rounded-lg text-slate-300 text-sm hover:bg-slate-800 transition-colors">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
