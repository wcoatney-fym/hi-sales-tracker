import { useState } from "react";
import { FileText, DollarSign, TrendingUp } from "lucide-react";
import type { LeaderboardEntry } from "../../types/leaderboard";

type KpiPeriod = "today" | "week" | "month" | "year";

interface KpiSummaryProps {
  dailyEntries: LeaderboardEntry[];
  weeklyEntries: LeaderboardEntry[];
  monthlyEntries: LeaderboardEntry[];
  yearlyEntries: LeaderboardEntry[];
  loading: boolean;
}

const PERIOD_OPTIONS: { key: KpiPeriod; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "year", label: "This Year" },
];

export default function KpiSummary({
  dailyEntries,
  weeklyEntries,
  monthlyEntries,
  yearlyEntries,
  loading,
}: KpiSummaryProps) {
  const [activePeriod, setActivePeriod] = useState<KpiPeriod>("today");

  const entriesMap: Record<KpiPeriod, LeaderboardEntry[]> = {
    today: dailyEntries,
    week: weeklyEntries,
    month: monthlyEntries,
    year: yearlyEntries,
  };

  const entries = entriesMap[activePeriod];
  const totalDeals = entries.reduce((sum, e) => sum + e.policies, 0);
  const totalPremium = entries.reduce((sum, e) => sum + e.commission, 0);
  const avgPremium = totalDeals > 0 ? totalPremium / totalDeals : 0;

  const kpis = [
    {
      label: "Total Deals",
      value: loading ? "--" : totalDeals.toLocaleString(),
      icon: FileText,
      accent: "from-emerald-500/10 to-transparent",
    },
    {
      label: "Monthly Premium",
      value: loading ? "--" : `$${Math.ceil(totalPremium).toLocaleString()}`,
      icon: DollarSign,
      accent: "from-gold/10 to-transparent",
    },
    {
      label: "Avg Mo. Premium",
      value: loading ? "--" : `$${Math.ceil(avgPremium).toLocaleString()}`,
      icon: TrendingUp,
      accent: "from-blue-500/10 to-transparent",
    },
  ];

  return (
    <div>
      {/* Period Selector */}
      <div className="flex items-center gap-1 mb-3 bg-navy-light/50 rounded-lg p-1 w-fit">
        {PERIOD_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            onClick={() => setActivePeriod(opt.key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ${
              activePeriod === opt.key
                ? "bg-gold text-navy-dark shadow-sm shadow-gold/20"
                : "text-slate-400 hover:text-white"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        {kpis.map((kpi, i) => (
          <div
            key={kpi.label}
            className="card-navy p-4 sm:p-5 flex flex-col items-center text-center relative overflow-hidden group hover:scale-[1.03] hover:shadow-xl hover:shadow-gold/5 transition-all duration-300 animate-slide-up"
            style={{ animationDelay: `${i * 100}ms`, animationFillMode: "both" }}
          >
            {/* Gradient overlay on hover */}
            <div className={`absolute inset-0 bg-gradient-to-br ${kpi.accent} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />

            <div className="relative">
              <div className="w-9 h-9 rounded-lg bg-gold/10 flex items-center justify-center mb-2 group-hover:bg-gold/20 transition-colors duration-300">
                <kpi.icon size={18} className="text-gold" />
              </div>
              <p className="text-lg sm:text-2xl font-bold text-white animate-count-up">
                {kpi.value}
              </p>
              <p className="text-[11px] sm:text-xs text-slate-400 font-medium mt-1">
                {kpi.label}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
