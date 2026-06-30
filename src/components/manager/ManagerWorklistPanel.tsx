import { useState, useEffect, useCallback } from "react";
import { Loader2, AlertTriangle, RefreshCw, XCircle } from "lucide-react";
import { mgrGetAtRiskWorklist, mgrGetTerminatedWorklist } from "../../lib/api";
import type { ManagerWorklistPolicy, ManagerDisposition } from "../../lib/api";
import PolicyProfileModal from "./PolicyProfileModal";

type Lane = "at_risk" | "terminated";

interface ManagerWorklistPanelProps {
  token: string;
}

// v3 pipeline stages, left → right. The backend computes `stage` per policy
// (data-driven entry + keyword + manager/agent actions); Code Red / Heating Up
// are urgency overlays carried on each card, not columns.
type Stage =
  | "new"
  | "responded"
  | "manager_outreach"
  | "agent_outreach"
  | "agent_saved_pending"
  | "saved"
  | "lost";

const STAGES: { key: Stage; label: string; accent: string; dot: string }[] = [
  { key: "new", label: "New · Auto-Outreach", accent: "border-slate-600/60", dot: "bg-slate-400" },
  { key: "responded", label: "Responded", accent: "border-sky-500/40", dot: "bg-sky-400" },
  { key: "manager_outreach", label: "Manager Outreach", accent: "border-amber-500/40", dot: "bg-amber-400" },
  { key: "agent_outreach", label: "Agent Outreach", accent: "border-violet-500/40", dot: "bg-violet-400" },
  { key: "agent_saved_pending", label: "Pending Approval", accent: "border-teal-500/40", dot: "bg-teal-400" },
  { key: "saved", label: "Saved", accent: "border-emerald-500/40", dot: "bg-emerald-400" },
  { key: "lost", label: "Lost", accent: "border-rose-500/40", dot: "bg-rose-400" },
];

function daysLapsed(paidToDate: string | null): number | null {
  if (!paidToDate) return null;
  const ptd = new Date(paidToDate).getTime();
  if (Number.isNaN(ptd)) return null;
  return Math.floor((Date.now() - ptd) / 86400000);
}

function stageOf(p: ManagerWorklistPolicy): Stage {
  // Prefer the backend-computed stage; fall back to disposition for safety.
  const s = (p as { stage?: string }).stage || p.disposition || "new";
  const valid: Stage[] = ["new", "responded", "manager_outreach", "agent_outreach", "agent_saved_pending", "saved", "lost"];
  return (valid.includes(s as Stage) ? s : "new") as Stage;
}

// Worst-first within a column: Code Red, then overdue agent handoffs, then
// closest to termination.
function urgencyRank(p: ManagerWorklistPolicy): number {
  let r = 0;
  if ((p as { is_code_red?: boolean }).is_code_red) r += 1000;
  if ((p as { agent_overdue?: boolean }).agent_overdue) r += 500;
  if ((p as { is_heating_up?: boolean }).is_heating_up) r += 100;
  const dtt = (p as { days_to_terminate?: number }).days_to_terminate;
  if (typeof dtt === "number") r += Math.max(0, 45 - dtt);
  return r;
}

export default function ManagerWorklistPanel({ token }: ManagerWorklistPanelProps) {
  const [worklist, setWorklist] = useState<ManagerWorklistPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<ManagerWorklistPolicy | null>(null);
  const [lane, setLane] = useState<Lane>("at_risk");

  const fetchWorklist = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const res =
        lane === "terminated"
          ? await mgrGetTerminatedWorklist(token)
          : await mgrGetAtRiskWorklist(token);
      const list: ManagerWorklistPolicy[] = (res.worklist as ManagerWorklistPolicy[]) || [];
      // Worst-first: Code Red / overdue / closest-to-termination at the top.
      list.sort((a, b) => urgencyRank(b) - urgencyRank(a));
      setWorklist(list);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load worklist");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, lane]);

  useEffect(() => {
    fetchWorklist();
  }, [fetchWorklist]);

  const handleDispositionChange = (policyId: string, disposition: ManagerDisposition) => {
    setWorklist((prev) => prev.map((p) => (p.id === policyId ? { ...p, disposition } : p)));
    setSelected((prev) => (prev && prev.id === policyId ? { ...prev, disposition } : prev));
  };

  const laneTabs: { key: Lane; label: string; icon: React.ElementType }[] = [
    { key: "at_risk", label: "At-Risk", icon: AlertTriangle },
    { key: "terminated", label: "Terminated", icon: XCircle },
  ];

  const LaneSwitch = (
    <div className="flex gap-1 bg-navy p-1 rounded-lg w-fit border border-slate-700/50">
      {laneTabs.map((t) => {
        const Icon = t.icon;
        const active = lane === t.key;
        return (
          <button
            key={t.key}
            onClick={() => { setLane(t.key); setSelected(null); }}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              active ? "bg-navy-light text-gold border border-gold/20" : "text-slate-400 hover:text-white"
            }`}
          >
            <Icon size={14} />
            {t.label}
          </button>
        );
      })}
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-4">
        {LaneSwitch}
        <div className="flex items-center justify-center py-16">
          <Loader2 className="animate-spin text-gold" size={28} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-400 text-sm">{error}</p>
        <button onClick={() => fetchWorklist()} className="mt-3 text-xs text-gold hover:underline">
          Retry
        </button>
      </div>
    );
  }

  const byStage = (stage: Stage) => worklist.filter((p) => stageOf(p) === stage);

  return (
    <div className="space-y-4">
      {LaneSwitch}
      {/* Header */}
      <div className="flex items-center gap-2">
        {lane === "terminated" ? (
          <XCircle size={16} className="text-rose-400" />
        ) : (
          <AlertTriangle size={16} className="text-amber-400" />
        )}
        <h3 className="text-sm font-semibold text-white">
          {lane === "terminated" ? "Terminated Outreach" : "At-Risk Pipeline"}
        </h3>
        <span className="text-xs text-slate-500">
          ({worklist.length} {lane === "terminated" ? "terminated" : "flagged"})
        </span>
        <button
          onClick={() => fetchWorklist(true)}
          disabled={refreshing}
          className="ml-auto text-slate-400 hover:text-white p-1 disabled:opacity-50"
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

      {worklist.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm bg-navy rounded-xl border border-slate-700/50">
          {lane === "terminated"
            ? "No terminated policies to work right now."
            : "No at-risk policies right now. Nice and clean."}
        </div>
      ) : (
        // Kanban: columns scroll horizontally on narrow screens.
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide snap-x">
          {STAGES.map((stage) => {
            const cards = byStage(stage.key);
            return (
              <div
                key={stage.key}
                className="shrink-0 w-[78vw] sm:w-64 snap-start"
              >
                <div className={`flex items-center gap-2 px-1 pb-2 border-b ${stage.accent} mb-2`}>
                  <span className={`w-2 h-2 rounded-full ${stage.dot}`} />
                  <span className="text-xs font-semibold text-slate-200">{stage.label}</span>
                  <span className="text-[11px] text-slate-500 ml-auto">{cards.length}</span>
                </div>
                <div className="space-y-2 min-h-[40px]">
                  {cards.length === 0 ? (
                    <p className="text-[11px] text-slate-600 px-1 py-3 text-center">—</p>
                  ) : (
                    cards.map((p) => {
                      const pp = p as ManagerWorklistPolicy & {
                        days_to_terminate?: number; is_code_red?: boolean;
                        is_heating_up?: boolean; agent_overdue?: boolean;
                      };
                      const dtt = pp.days_to_terminate;
                      const codeRed = !!pp.is_code_red;
                      const heating = !!pp.is_heating_up;
                      const dttColor =
                        codeRed ? "text-rose-400"
                        : heating ? "text-amber-400"
                        : "text-yellow-300";
                      return (
                        <button
                          key={p.id}
                          onClick={() => setSelected(p)}
                          className={`w-full text-left bg-navy border rounded-lg p-3 transition-colors ${
                            codeRed ? "border-rose-500/50 hover:border-rose-400" : "border-slate-700/50 hover:border-gold/30"
                          }`}
                        >
                          {(codeRed || pp.agent_overdue) && (
                            <div className="flex items-center gap-1 mb-1.5">
                              {codeRed && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30">
                                  CODE RED
                                </span>
                              )}
                              {pp.agent_overdue && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30">
                                  AGENT OVERDUE
                                </span>
                              )}
                            </div>
                          )}
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium text-white truncate">
                              {p.client_first_name} {p.client_last_name}
                            </p>
                            {lane === "at_risk" && typeof dtt === "number" ? (
                              <span className={`text-xs font-bold shrink-0 ${dttColor}`}>
                                {dtt > 0 ? `${dtt}d left` : "grace up"}
                              </span>
                            ) : (
                              (() => { const days = daysLapsed(p.paid_to_date); return days !== null ? (
                                <span className="text-xs font-bold shrink-0 text-slate-400">{days}d</span>
                              ) : null; })()
                            )}
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                            {p.carrier} · {p.product_type} · ${((p.plan_premium || 0) * 12).toLocaleString(undefined, { maximumFractionDigits: 0 })} AP
                          </p>
                          {lane === "terminated" && p.contract_reason && (
                            <span className="inline-block mt-1 text-[9px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/20">
                              {p.contract_reason}
                            </span>
                          )}
                          <p className="text-[10px] text-slate-500 mt-0.5 truncate">
                            {p.agent_first_name} {p.agent_last_name}
                            {p.agent_number ? ` · #${p.agent_number}` : ""}
                          </p>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <PolicyProfileModal
          token={token}
          policy={selected}
          onClose={() => setSelected(null)}
          onDispositionChange={handleDispositionChange}
        />
      )}
    </div>
  );
}
