import { useState, useEffect, useCallback } from "react";
import { Loader2, RefreshCw, GraduationCap, AlertTriangle } from "lucide-react";
import { mgrGetAgentQuality } from "../../lib/api";

interface AgentQualityRow {
  agent_id: string | null;
  agent_name: string;
  handed_off: number;
  contacted_in_sla: number;
  followup_rate_pct: number;
}

interface ManagerAgentQualityPanelProps {
  token: string;
}

// Agents whose 5-day follow-up rate falls below this are flagged for coaching.
const COACH_THRESHOLD_PCT = 80;

export default function ManagerAgentQualityPanel({ token }: ManagerAgentQualityPanelProps) {
  const [agents, setAgents] = useState<AgentQualityRow[]>([]);
  const [slaDays, setSlaDays] = useState(5);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const fetchQuality = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const res = await mgrGetAgentQuality(token);
      setAgents((res.agents as AgentQualityRow[]) || []);
      if (typeof res.sla_days === "number") setSlaDays(res.sla_days);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agent quality");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    fetchQuality();
  }, [fetchQuality]);

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
        <button onClick={() => fetchQuality()} className="mt-3 text-xs text-gold hover:underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <GraduationCap size={16} className="text-gold" />
        <h3 className="text-sm font-semibold text-white">Agent Quality — At-Risk Follow-Up</h3>
        <span className="text-xs text-slate-500">({agents.length} agents)</span>
        <button
          onClick={() => fetchQuality(true)}
          disabled={refreshing}
          className="ml-auto text-slate-400 hover:text-white p-1 disabled:opacity-50"
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

      <p className="text-xs text-slate-500">
        Of the at-risk policies handed to each agent, the share they made contact on within the{" "}
        {slaDays}-day SLA. A low rate flags an agent who isn't chasing their own clients — a coaching signal.
      </p>

      {agents.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm bg-navy rounded-xl border border-slate-700/50">
          No agent handoffs yet. Hand an at-risk policy to an agent to start tracking.
        </div>
      ) : (
        <div className="space-y-2">
          {agents.map((a) => {
            const flag = a.followup_rate_pct < COACH_THRESHOLD_PCT;
            const barColor =
              a.followup_rate_pct >= 90 ? "bg-emerald-400"
              : a.followup_rate_pct >= COACH_THRESHOLD_PCT ? "bg-amber-400"
              : "bg-rose-400";
            return (
              <div
                key={a.agent_id ?? a.agent_name}
                className={`bg-navy rounded-lg p-3 border ${flag ? "border-rose-500/40" : "border-slate-700/50"}`}
              >
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-white truncate">{a.agent_name}</p>
                  {flag && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30 flex items-center gap-1">
                      <AlertTriangle size={9} /> NEEDS COACHING
                    </span>
                  )}
                  <span className="ml-auto text-sm font-bold text-white">{a.followup_rate_pct}%</span>
                </div>
                <div className="mt-2 h-1.5 w-full rounded-full bg-slate-700/60 overflow-hidden">
                  <div className={`h-full ${barColor}`} style={{ width: `${Math.min(100, a.followup_rate_pct)}%` }} />
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5">
                  {a.contacted_in_sla} of {a.handed_off} contacted within {slaDays} days
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
