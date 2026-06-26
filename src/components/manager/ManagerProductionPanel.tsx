import { useState, useEffect, useCallback } from "react";
import { Loader2, Users, TrendingUp, TrendingDown } from "lucide-react";
import { adminGetAgentBreakdown } from "../../lib/api";
import { getDateRange, getPreviousPeriod } from "../../lib/dateUtils";

interface ManagerProductionPanelProps {
  token: string;
  agencyName: string;
}

interface AgentRow {
  agent_first_name: string;
  agent_last_name: string;
  agent_number: string;
  policies: number;
  revenue: number;
  avg_premium: number;
  prev_revenue: number;
}

// Agent-by-agent production for the manager's agency. Reuses the existing
// admin agent-breakdown endpoint scoped by agency name.
// TODO(diamond): this passes the manager token to an admin-api action. If the
// backend requires the admin token shape (not the manager session) for
// get-agent-breakdown, this panel will error — surface a clear message and
// switch to a manager-scoped endpoint once the backend confirms support.
export default function ManagerProductionPanel({ token, agencyName }: ManagerProductionPanelProps) {
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchProduction = useCallback(async () => {
    setLoading(true);
    try {
      const range = getDateRange("thisMonth");
      const prev = getPreviousPeriod(range);
      const res = await adminGetAgentBreakdown(
        token,
        range.startDate,
        range.endDate,
        prev.startDate,
        prev.endDate,
        agencyName
      );
      const list: AgentRow[] = (res.agents as AgentRow[]) || [];
      list.sort((a, b) => b.revenue - a.revenue);
      setRows(list);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load production");
    } finally {
      setLoading(false);
    }
  }, [token, agencyName]);

  useEffect(() => {
    fetchProduction();
  }, [fetchProduction]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Users size={16} className="text-gold" />
        <h3 className="text-sm font-semibold text-white">Agent-by-Agent Production</h3>
        <span className="text-xs text-slate-500">(this month)</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-gold" size={24} />
        </div>
      ) : error ? (
        <div className="text-center py-10 bg-navy rounded-xl border border-slate-700/50">
          <p className="text-red-400 text-sm">{error}</p>
          <button onClick={fetchProduction} className="mt-3 text-xs text-gold hover:underline">
            Retry
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm bg-navy rounded-xl border border-slate-700/50">
          No production for this period.
        </div>
      ) : (
        <div className="bg-navy rounded-xl border border-slate-700/50 overflow-hidden divide-y divide-slate-700/30">
          {rows.map((a) => {
            const delta = a.revenue - (a.prev_revenue || 0);
            const up = delta >= 0;
            return (
              <div key={a.agent_number} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium truncate">
                    {a.agent_first_name} {a.agent_last_name}
                  </p>
                  <p className="text-[11px] text-slate-500 font-mono">#{a.agent_number}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-white">
                    ${(a.revenue || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-[10px] text-slate-500">{a.policies} policies</p>
                </div>
                <div className={`flex items-center gap-1 text-xs shrink-0 ${up ? "text-emerald-400" : "text-rose-400"}`}>
                  {up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                  {Math.abs(delta).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
