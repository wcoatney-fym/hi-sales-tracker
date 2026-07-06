import { useState, useEffect, useCallback } from "react";
import { Loader2, AlertTriangle, RefreshCw, XCircle, Search } from "lucide-react";
import {
  mgrGetAtRiskWorklist,
  mgrGetTerminatedWorklist,
  mgrSetDisposition,
  mgrHandoffToAgent,
  mgrApproveSave,
} from "../../lib/api";
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
  | "code_red"
  | "agent_saved_pending"
  | "saved"
  | "lost";

const STAGES: { key: Stage; label: string; accent: string; dot: string }[] = [
  { key: "new", label: "New", accent: "border-slate-600/60", dot: "bg-slate-400" },
  { key: "responded", label: "Responded", accent: "border-sky-500/40", dot: "bg-sky-400" },
  { key: "manager_outreach", label: "Manager", accent: "border-amber-500/40", dot: "bg-amber-400" },
  { key: "agent_outreach", label: "Agent", accent: "border-violet-500/40", dot: "bg-violet-400" },
  { key: "code_red", label: "Code Red", accent: "border-red-600/70", dot: "bg-red-500" },
  { key: "agent_saved_pending", label: "Pending", accent: "border-teal-500/40", dot: "bg-teal-400" },
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
  const valid: Stage[] = ["new", "responded", "manager_outreach", "agent_outreach", "code_red", "agent_saved_pending", "saved", "lost"];
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
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<Stage | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "code_red" | "heating_up" | "agent_overdue">("all");
  const [query, setQuery] = useState("");

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
    setWorklist((prev) => prev.map((p) => (p.id === policyId ? { ...p, disposition, stage: disposition } : p)));
    setSelected((prev) => (prev && prev.id === policyId ? { ...prev, disposition } : prev));
  };

  // Stages a manager can drop a card into, and the action each drop performs.
  // 'new' (system/auto) and 'agent_saved_pending' (agent-set) are not manual
  // drop targets.
  const DROPPABLE: Stage[] = ["responded", "manager_outreach", "agent_outreach", "code_red", "saved", "lost"];

  const moveToStage = async (policy: ManagerWorklistPolicy, target: Stage) => {
    const current = stageOf(policy);
    if (current === target || !DROPPABLE.includes(target)) return;
    setMovingId(policy.id);
    // optimistic
    setWorklist((prev) => prev.map((p) => (p.id === policy.id ? { ...p, stage: target, disposition: target as ManagerDisposition } : p)));
    try {
      if (target === "agent_outreach") {
        await mgrHandoffToAgent(token, { policyId: policy.id });
      } else if (target === "saved" && current === "agent_saved_pending") {
        await mgrApproveSave(token, policy.id);
      } else {
        await mgrSetDisposition(token, { policyId: policy.id, disposition: target as ManagerDisposition });
      }
    } catch {
      // revert on failure
      setWorklist((prev) => prev.map((p) => (p.id === policy.id ? policy : p)));
    } finally {
      setMovingId(null);
    }
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

  // Triage counts across the whole at-risk book (pre-filter).
  const counts = {
    total: worklist.length,
    code_red: worklist.filter((p) => (p as { is_code_red?: boolean }).is_code_red).length,
    heating_up: worklist.filter((p) => (p as { is_heating_up?: boolean }).is_heating_up).length,
    agent_overdue: worklist.filter((p) => (p as { agent_overdue?: boolean }).agent_overdue).length,
  };

  const matchesQuery = (p: ManagerWorklistPolicy) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (
      `${p.client_first_name} ${p.client_last_name}`.toLowerCase().includes(q) ||
      `${p.agent_first_name} ${p.agent_last_name}`.toLowerCase().includes(q) ||
      (p.policy_number || "").toLowerCase().includes(q)
    );
  };

  const matchesFilter = (p: ManagerWorklistPolicy) => {
    if (filter === "all") return true;
    if (filter === "code_red") return !!(p as { is_code_red?: boolean }).is_code_red;
    if (filter === "heating_up") return !!(p as { is_heating_up?: boolean }).is_heating_up;
    if (filter === "agent_overdue") return !!(p as { agent_overdue?: boolean }).agent_overdue;
    return true;
  };

  const visible = worklist.filter((p) => matchesQuery(p) && matchesFilter(p));
  const byStage = (stage: Stage) => visible.filter((p) => stageOf(p) === stage);

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

      {/* Triage bar + search (at-risk lane) */}
      {lane === "at_risk" && worklist.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {([
            { key: "all", label: `All ${counts.total}`, cls: "text-slate-300 border-slate-600/60", active: "bg-slate-600/30 text-white border-slate-400" },
            { key: "code_red", label: `Code Red ${counts.code_red}`, cls: "text-rose-300 border-rose-500/30", active: "bg-rose-500/20 text-rose-200 border-rose-400" },
            { key: "agent_overdue", label: `Agent Overdue ${counts.agent_overdue}`, cls: "text-rose-300 border-rose-500/30", active: "bg-rose-500/20 text-rose-200 border-rose-400" },
            { key: "heating_up", label: `Heating Up ${counts.heating_up}`, cls: "text-amber-300 border-amber-500/30", active: "bg-amber-500/20 text-amber-200 border-amber-400" },
          ] as const).map((chip) => (
            <button
              key={chip.key}
              onClick={() => setFilter((f) => (f === chip.key ? "all" : chip.key))}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${filter === chip.key ? chip.active : `bg-navy ${chip.cls} hover:text-white`}`}
            >
              {chip.label}
            </button>
          ))}
          <div className="relative ml-auto">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search client, agent, policy #"
              className="bg-navy border border-slate-700/60 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-gold w-52"
            />
          </div>
        </div>
      )}

      {worklist.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm bg-navy rounded-xl border border-slate-700/50">
          {lane === "terminated"
            ? "No terminated policies to work right now."
            : "No at-risk policies right now. Nice and clean."}
        </div>
      ) : (
        // Kanban: horizontal-scroll columns on mobile, all 7 stages as a full-
        // width grid on desktop (one screen). Drag a card between columns.
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide snap-x lg:grid lg:grid-cols-7 lg:gap-2.5 lg:overflow-visible">
          {STAGES.map((stage) => {
            const cards = byStage(stage.key);
            const isDroppable = DROPPABLE.includes(stage.key);
            const isOver = dropTarget === stage.key && isDroppable;
            return (
              <div
                key={stage.key}
                onDragOver={(e) => { if (isDroppable && dragId) { e.preventDefault(); setDropTarget(stage.key); } }}
                onDragLeave={() => setDropTarget((t) => (t === stage.key ? null : t))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDropTarget(null);
                  const p = worklist.find((w) => w.id === dragId);
                  if (p) moveToStage(p, stage.key);
                  setDragId(null);
                }}
                className={`shrink-0 w-[68vw] sm:w-[38vw] lg:w-auto snap-start rounded-lg p-1.5 transition-colors ${isOver ? "bg-gold/5 ring-1 ring-gold/40" : "bg-navy/40"} ${dragId && !isDroppable ? "opacity-50" : ""}`}
              >
                <div className={`flex items-center gap-1.5 px-1 pb-2 border-b ${stage.accent} mb-2`}>
                  <span className={`w-2 h-2 rounded-full ${stage.dot} shrink-0`} />
                  <span className="text-[11px] font-semibold text-slate-200 truncate">{stage.label}</span>
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
                          draggable={lane === "at_risk"}
                          onDragStart={() => setDragId(p.id)}
                          onDragEnd={() => { setDragId(null); setDropTarget(null); }}
                          onClick={() => setSelected(p)}
                          className={`w-full text-left bg-navy border rounded-lg p-2.5 transition-colors ${lane === "at_risk" ? "cursor-grab active:cursor-grabbing" : ""} ${movingId === p.id ? "opacity-60" : ""} ${
                            codeRed ? "border-rose-500/50 hover:border-rose-400" : "border-slate-700/50 hover:border-gold/30"
                          }`}
                        >
                          {/* Urgency row: badge(s) on the left, countdown on the right */}
                          <div className="flex items-center gap-1 mb-1 min-h-[16px]">
                            {codeRed && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30">
                                CODE RED
                              </span>
                            )}
                            {pp.agent_overdue && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30">
                                OVERDUE
                              </span>
                            )}
                            {lane === "at_risk" && typeof dtt === "number" ? (
                              <span className={`text-[11px] font-bold ml-auto ${dttColor}`}>
                                {dtt > 0 ? `${dtt}d left` : "grace up"}
                              </span>
                            ) : (
                              (() => { const days = daysLapsed(p.paid_to_date); return days !== null ? (
                                <span className="text-[11px] font-bold ml-auto text-slate-400">{days}d</span>
                              ) : null; })()
                            )}
                          </div>
                          <p className="text-sm font-semibold text-white leading-snug break-words">
                            {p.client_first_name} {p.client_last_name}
                          </p>
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
