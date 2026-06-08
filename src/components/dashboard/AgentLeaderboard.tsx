import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from "recharts";
import {
  Trophy,
  ChevronDown,
  ChevronUp,
  Loader2,
  Users,
  TrendingUp,
  TrendingDown,
  Minus,
  Calendar,
} from "lucide-react";
import { adminGetEnhancedLeaderboard } from "../../lib/api";

interface WeeklyPoint {
  week: string;
  policies: number;
  premium: number;
}

interface EnhancedAgent {
  agent_first_name: string;
  agent_last_name: string;
  agent_number: string;
  carrier: string;
  agency: string;
  policies: number;
  annual_premium: number;
  avg_monthly_premium: number;
  last_sale_date: string | null;
  policies_30d: number;
  premium_30d: number;
  policies_prior: number;
  premium_prior: number;
  momentum: "up" | "down" | "flat";
  weekly_production: WeeklyPoint[];
}

interface AgentLeaderboardProps {
  token: string;
  startDate: string;
  endDate: string;
  agencyFilter?: string;
}

const PREVIEW_COUNT = 8;

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gold/30 to-amber-600/20 flex items-center justify-center ring-1 ring-gold/40">
        <Trophy size={14} className="text-gold" />
      </div>
    );
  }
  if (rank === 2) {
    return (
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-400/20 to-slate-500/10 flex items-center justify-center ring-1 ring-slate-400/30">
        <span className="text-xs font-bold text-slate-300">2</span>
      </div>
    );
  }
  if (rank === 3) {
    return (
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-700/20 to-amber-800/10 flex items-center justify-center ring-1 ring-amber-600/30">
        <span className="text-xs font-bold text-amber-400">3</span>
      </div>
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-navy-light flex items-center justify-center">
      <span className="text-xs font-medium text-slate-500">{rank}</span>
    </div>
  );
}

function MomentumIcon({ momentum }: { momentum: "up" | "down" | "flat" }) {
  if (momentum === "up") {
    return (
      <div className="flex items-center gap-1" title="Increasing production">
        <TrendingUp size={14} className="text-emerald-400" />
      </div>
    );
  }
  if (momentum === "down") {
    return (
      <div className="flex items-center gap-1" title="Decreasing production">
        <TrendingDown size={14} className="text-red-400" />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1" title="Steady production">
      <Minus size={14} className="text-slate-500" />
    </div>
  );
}

function MiniSparkline({ data }: { data: WeeklyPoint[] }) {
  if (!data || data.length === 0) return <div className="w-16 h-4" />;
  const max = Math.max(...data.map((d) => d.policies), 1);
  return (
    <div className="flex items-end gap-px h-4 w-16">
      {data.map((d, i) => (
        <div
          key={i}
          className="flex-1 bg-sky-500/60 rounded-sm min-h-[1px] transition-all"
          style={{ height: `${(d.policies / max) * 100}%` }}
        />
      ))}
    </div>
  );
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${Math.round(value)}`;
}

function formatDaysAgo(dateStr: string | null): string {
  if (!dateStr) return "--";
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff <= 7) return `${diff}d ago`;
  if (diff <= 30) return `${Math.floor(diff / 7)}w ago`;
  return `${Math.floor(diff / 30)}mo ago`;
}

function BarChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ value: number; payload: { name: string } }> }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-navy/95 backdrop-blur border border-slate-700/50 rounded-lg shadow-lg px-3 py-2 text-sm">
      <p className="text-white font-medium">{payload[0].payload.name}</p>
      <p className="text-gold">{formatCurrency(payload[0].value)}</p>
    </div>
  );
}

export default function AgentLeaderboard({ token, startDate, endDate, agencyFilter }: AgentLeaderboardProps) {
  const [agents, setAgents] = useState<EnhancedAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const fetchData = useCallback(async () => {
    if (!token || !startDate || !endDate) return;
    setLoading(true);
    try {
      const result = await adminGetEnhancedLeaderboard(token, startDate, endDate, agencyFilter);
      setAgents(result.agents || []);
    } catch (err) {
      console.error("Enhanced leaderboard error:", err);
    } finally {
      setLoading(false);
    }
  }, [token, startDate, endDate, agencyFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const visible = expanded ? agents : agents.slice(0, PREVIEW_COUNT);
  const hasMore = agents.length > PREVIEW_COUNT;

  const totalPremium = useMemo(() => agents.reduce((sum, a) => sum + a.annual_premium, 0), [agents]);

  const barData = useMemo(() => {
    return agents.slice(0, 10).map((a) => ({
      name: `${a.agent_first_name} ${a.agent_last_name.charAt(0)}.`,
      premium: a.annual_premium,
      momentum: a.momentum,
    }));
  }, [agents]);

  const barColors = ["#d4a84b", "#c9963f", "#be8433", "#b37227", "#a8601b", "#9d4e0f", "#8b4513", "#7a3d11", "#69350f", "#582d0d"];

  if (loading) {
    return (
      <div className="bg-navy rounded-xl border border-slate-700/50 p-6">
        <div className="flex items-center gap-3 mb-6">
          <Trophy size={20} className="text-slate-500" />
          <h3 className="text-base font-semibold text-white">Agent Performance</h3>
        </div>
        <div className="h-60 flex items-center justify-center">
          <Loader2 className="animate-spin text-slate-500" size={32} />
        </div>
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="bg-navy rounded-xl border border-slate-700/50 p-6">
        <div className="flex items-center gap-3 mb-6">
          <Trophy size={20} className="text-gold" />
          <h3 className="text-base font-semibold text-white">Agent Performance</h3>
        </div>
        <div className="h-48 flex flex-col items-center justify-center text-slate-500">
          <Users size={36} className="mb-3 opacity-40" />
          <p className="text-sm">No agent data for the selected period</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-navy rounded-xl border border-slate-700/50">
      {/* Header */}
      <div className="flex items-center gap-3 p-6 pb-4">
        <Trophy size={20} className="text-gold" />
        <div>
          <h3 className="text-base font-semibold text-white">Agent Performance</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Ranked by annualized premium | Momentum = last 30d vs prior 30d
          </p>
        </div>
        <span className="ml-auto text-xs text-slate-500 font-medium bg-navy-light px-2.5 py-1 rounded-full">
          {agents.length} agent{agents.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Two-column layout: Table + Chart */}
      <div className="grid lg:grid-cols-5 gap-0">
        {/* Table - 3 columns */}
        <div className="lg:col-span-3 px-4 pb-2">
          {/* Column headers */}
          <div className="grid grid-cols-[2rem_1fr_5.5rem_3.5rem_4.5rem_2.5rem_2rem] gap-x-2 px-2 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-700/30 mb-1">
            <span />
            <span>Agent</span>
            <span className="text-right">Annual Prem.</span>
            <span className="text-right">Policies</span>
            <span className="text-right">Avg/Policy</span>
            <span className="text-center">8wk</span>
            <span className="text-center" title="Momentum">M</span>
          </div>

          {/* Rows */}
          <div className="space-y-0.5">
            {visible.map((agent, idx) => {
              const share = totalPremium > 0 ? (agent.annual_premium / totalPremium) * 100 : 0;
              return (
                <div
                  key={`${agent.agent_number}-${idx}`}
                  className={`grid grid-cols-[2rem_1fr_5.5rem_3.5rem_4.5rem_2.5rem_2rem] gap-x-2 items-center px-2 py-2.5 rounded-lg transition-colors ${
                    idx % 2 === 0 ? "bg-navy-light/20" : ""
                  } hover:bg-navy-light/50`}
                >
                  <RankBadge rank={idx + 1} />

                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">
                      {agent.agent_first_name} {agent.agent_last_name}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] text-slate-500 truncate">
                        {agent.carrier} #{agent.agent_number}
                      </span>
                      {agent.last_sale_date && (
                        <span className="text-[10px] text-slate-600 flex items-center gap-0.5">
                          <Calendar size={8} />
                          {formatDaysAgo(agent.last_sale_date)}
                        </span>
                      )}
                    </div>
                    {/* Share bar */}
                    <div className="w-full h-1 bg-slate-800 rounded-full mt-1.5 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-gold/70 to-gold/30 transition-all"
                        style={{ width: `${Math.min(share, 100)}%` }}
                      />
                    </div>
                  </div>

                  <span className={`text-sm font-semibold text-right ${idx < 3 ? "text-gold" : "text-slate-200"}`}>
                    {formatCurrency(agent.annual_premium)}
                  </span>
                  <span className="text-sm text-slate-300 text-right">{agent.policies}</span>
                  <span className="text-sm text-slate-400 text-right">
                    ${agent.avg_monthly_premium.toFixed(0)}
                  </span>
                  <MiniSparkline data={agent.weekly_production} />
                  <MomentumIcon momentum={agent.momentum} />
                </div>
              );
            })}
          </div>

          {hasMore && (
            <div className="border-t border-slate-700/30 mt-2">
              <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-slate-400 hover:text-gold hover:bg-navy-light/30 transition-colors rounded-b-xl"
              >
                {expanded ? (
                  <>
                    <ChevronUp size={16} />
                    Show top {PREVIEW_COUNT}
                  </>
                ) : (
                  <>
                    <ChevronDown size={16} />
                    View all {agents.length} agents
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Bar Chart - 2 columns */}
        <div className="lg:col-span-2 px-4 pb-6 pt-2 border-l border-slate-700/20">
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-3 px-1">
            Top 10 by Annual Premium
          </p>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={barData}
                layout="vertical"
                margin={{ top: 0, right: 12, left: 0, bottom: 0 }}
              >
                <XAxis
                  type="number"
                  tickFormatter={(v) => formatCurrency(v)}
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  width={85}
                />
                <Tooltip content={<BarChartTooltip />} cursor={{ fill: "rgba(212, 168, 75, 0.05)" }} />
                <Bar dataKey="premium" radius={[0, 4, 4, 0]} maxBarSize={24}>
                  {barData.map((_, index) => (
                    <Cell key={index} fill={barColors[index] || barColors[barColors.length - 1]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Quick stats */}
          <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-slate-700/20">
            <div className="bg-navy-light/30 rounded-lg p-3">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Team Total</p>
              <p className="text-base font-bold text-white">{formatCurrency(totalPremium)}</p>
            </div>
            <div className="bg-navy-light/30 rounded-lg p-3">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Avg/Agent</p>
              <p className="text-base font-bold text-white">
                {agents.length > 0 ? formatCurrency(totalPremium / agents.length) : "--"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
