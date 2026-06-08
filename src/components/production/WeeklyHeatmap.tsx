import { useState, useEffect, useCallback, useMemo } from "react";
import { LayoutGrid, Loader2, Trophy } from "lucide-react";
import { adminGetMonteCarloData, adminGetMonteCarloAgentData } from "../../lib/api";

interface DailyRecord {
  submit_date: string;
  day_of_week: number;
  policy_count: number;
  total_premium: number;
  avg_premium: number;
}

interface WeeklyHeatmapProps {
  token: string;
  agencyFilter?: string;
  agencies?: string[];
  agentNumber?: string;
  title?: string;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function WeeklyHeatmap({
  token,
  agencyFilter,
  agencies,
  agentNumber,
  title = "Day-of-Week Productivity",
}: WeeklyHeatmapProps) {
  const [daily, setDaily] = useState<DailyRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      let result;
      if (agentNumber) {
        result = await adminGetMonteCarloAgentData(token, agentNumber);
      } else {
        result = await adminGetMonteCarloData(token, agencyFilter, undefined, undefined, agencies);
      }
      setDaily(result.daily || []);
    } catch {
      // handled
    }
    setLoading(false);
  }, [token, agencyFilter, agencies, agentNumber]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const dowStats = useMemo(() => {
    const stats = Array.from({ length: 7 }, () => ({ totalPolicies: 0, totalPremium: 0, daysCount: 0 }));
    for (const rec of daily) {
      stats[rec.day_of_week].totalPolicies += rec.policy_count;
      stats[rec.day_of_week].totalPremium += rec.total_premium;
      stats[rec.day_of_week].daysCount += 1;
    }
    return stats.map((s, dow) => ({
      dow,
      label: DAY_LABELS[dow],
      avgPolicies: s.daysCount > 0 ? s.totalPolicies / s.daysCount : 0,
      avgPremium: s.daysCount > 0 ? s.totalPremium / s.daysCount : 0,
      totalPolicies: s.totalPolicies,
      totalPremium: s.totalPremium,
      daysCount: s.daysCount,
    }));
  }, [daily]);

  const maxAvgPolicies = useMemo(() => Math.max(...dowStats.map((s) => s.avgPolicies), 1), [dowStats]);
  const bestDay = useMemo(() => dowStats.reduce((best, s) => s.avgPolicies > best.avgPolicies ? s : best, dowStats[0]), [dowStats]);

  function getHeatColor(value: number, max: number): string {
    const ratio = max > 0 ? value / max : 0;
    if (ratio === 0) return "bg-slate-800/50";
    if (ratio < 0.2) return "bg-gold/5 border-gold/10";
    if (ratio < 0.4) return "bg-gold/10 border-gold/15";
    if (ratio < 0.6) return "bg-gold/20 border-gold/25";
    if (ratio < 0.8) return "bg-gold/30 border-gold/35";
    return "bg-gold/40 border-gold/50";
  }

  function formatCurrency(value: number): string {
    if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
    return `$${Math.round(value)}`;
  }

  if (loading) {
    return (
      <div className="bg-navy rounded-xl border border-slate-700/50 p-6">
        <div className="flex items-center gap-3 mb-4">
          <LayoutGrid size={18} className="text-gold" />
          <h3 className="text-sm font-semibold text-white">{title}</h3>
        </div>
        <div className="h-32 flex items-center justify-center">
          <Loader2 className="animate-spin text-slate-500" size={24} />
        </div>
      </div>
    );
  }

  if (daily.length < 7) {
    return (
      <div className="bg-navy rounded-xl border border-slate-700/50 p-6">
        <div className="flex items-center gap-3 mb-4">
          <LayoutGrid size={18} className="text-gold" />
          <h3 className="text-sm font-semibold text-white">{title}</h3>
        </div>
        <div className="h-32 flex flex-col items-center justify-center text-slate-500">
          <LayoutGrid size={32} className="mb-2 opacity-40" />
          <p className="text-xs">Insufficient data for weekly patterns</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-navy rounded-xl border border-slate-700/50 p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 mb-4 sm:mb-5">
        <div className="flex items-center gap-3">
          <LayoutGrid size={18} className="text-gold" />
          <h3 className="text-sm font-semibold text-white">{title}</h3>
        </div>
        {bestDay.avgPolicies > 0 && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gold/10 border border-gold/20 w-fit">
            <Trophy size={12} className="text-gold" />
            <span className="text-[11px] font-semibold text-gold">{bestDay.label} is most productive</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
        {dowStats.map((stat) => {
          const intensity = getHeatColor(stat.avgPolicies, maxAvgPolicies);
          const isBest = stat.dow === bestDay.dow && bestDay.avgPolicies > 0;
          return (
            <div
              key={stat.dow}
              className={`relative rounded-lg border p-2 sm:p-3 text-center transition-all ${intensity} ${isBest ? "ring-1 ring-gold/40" : "border-slate-700/30"}`}
            >
              <p className={`text-[10px] sm:text-xs font-semibold mb-1 sm:mb-1.5 ${isBest ? "text-gold" : "text-slate-400"}`}>{stat.label}</p>
              <p className="text-sm sm:text-lg font-bold text-white">{stat.avgPolicies.toFixed(1)}</p>
              <p className="text-[9px] sm:text-[10px] text-slate-500 mt-0.5">pol/day</p>
              <p className="text-[9px] sm:text-[10px] text-slate-600 mt-0.5 sm:mt-1 hidden sm:block">{formatCurrency(stat.avgPremium * 12)}/day</p>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between mt-3 sm:mt-4 pt-3 border-t border-slate-700/30">
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="text-[10px] text-slate-500">Intensity:</span>
          <div className="flex items-center gap-1">
            <div className="w-3 sm:w-4 h-2.5 sm:h-3 rounded bg-slate-800/50 border border-slate-700/30" />
            <div className="w-3 sm:w-4 h-2.5 sm:h-3 rounded bg-gold/10 border border-gold/15" />
            <div className="w-3 sm:w-4 h-2.5 sm:h-3 rounded bg-gold/20 border border-gold/25" />
            <div className="w-3 sm:w-4 h-2.5 sm:h-3 rounded bg-gold/30 border border-gold/35" />
            <div className="w-3 sm:w-4 h-2.5 sm:h-3 rounded bg-gold/40 border border-gold/50" />
          </div>
        </div>
        <p className="text-[10px] text-slate-600">
          {daily.length} days
        </p>
      </div>
    </div>
  );
}
