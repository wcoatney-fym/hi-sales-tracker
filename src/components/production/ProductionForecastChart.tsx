import { useState, useEffect, useMemo, useCallback } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from "recharts";
import {
  TrendingUp,
  Loader2,
  DollarSign,
  BarChart3,
  Layers,
} from "lucide-react";
import { adminGetMonteCarloData, adminGetMonteCarloAgentData } from "../../lib/api";

interface DailyRecord {
  submit_date: string;
  day_of_week: number;
  policy_count: number;
  total_premium: number;
  avg_premium: number;
}

interface MonthlyRecord {
  month: string;
  policy_count: number;
  total_premium: number;
}

interface MonteCarloMeta {
  total_days: number;
  selling_days: number;
  earliest_date: string;
  latest_date: string;
}

interface SimPoint {
  day: number;
  label: string;
  p5: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  actual?: number;
}

type ViewMode = "policies" | "income" | "combined";
type Horizon = 30 | 60 | 90 | 180 | 365;

interface ProductionForecastChartProps {
  token: string;
  agencyFilter?: string;
  agencies?: string[];
  agentNumber?: string;
  title?: string;
  compact?: boolean;
}

function linearRegression(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] || 0 };
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += values[i]; sumXY += i * values[i]; sumX2 += i * i;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  return { slope: isFinite(slope) ? slope : 0, intercept: isFinite(intercept) ? intercept : 0 };
}

function computeMonthlyGrowthRate(monthly: MonthlyRecord[]): number {
  if (monthly.length < 3) return 0;
  const recentMonths = monthly.slice(-12);
  const revenues = recentMonths.map((m) => m.total_premium * 12);
  const { slope, intercept } = linearRegression(revenues);
  const midpoint = intercept + slope * (revenues.length / 2);
  if (midpoint <= 0) return 0;
  const monthlyRate = slope / midpoint;
  return Math.max(-0.1, Math.min(0.15, monthlyRate));
}

function buildDowDistributions(daily: DailyRecord[]): Map<number, number[]> {
  const dists = new Map<number, number[]>();
  for (let d = 0; d < 7; d++) dists.set(d, []);
  for (const rec of daily) dists.get(rec.day_of_week)!.push(rec.policy_count);
  return dists;
}

function buildPremiumDistribution(daily: DailyRecord[]): number[] {
  return daily.filter((d) => d.avg_premium > 0).map((d) => d.avg_premium);
}

function runSimulation(
  daily: DailyRecord[],
  monthly: MonthlyRecord[],
  horizon: Horizon,
  iterations: number,
  mode: "policies" | "income"
): SimPoint[] {
  if (daily.length < 7) return [];
  const dowDists = buildDowDistributions(daily);
  const premiumDist = buildPremiumDistribution(daily);
  const monthlyGrowth = computeMonthlyGrowthRate(monthly);
  const dailyGrowth = Math.pow(1 + monthlyGrowth, 1 / 30) - 1;
  const results: number[][] = Array.from({ length: horizon }, () => []);
  const today = new Date();

  for (let i = 0; i < iterations; i++) {
    let cumulative = 0;
    for (let day = 0; day < horizon; day++) {
      const futureDate = new Date(today);
      futureDate.setDate(futureDate.getDate() + day + 1);
      const dow = futureDate.getDay();
      const dowArr = dowDists.get(dow)!;
      if (dowArr.length === 0) { results[day].push(cumulative); continue; }
      const idx = Math.floor(Math.random() * dowArr.length);
      let policyCount = dowArr[idx];
      policyCount = Math.round(policyCount * Math.pow(1 + dailyGrowth, day));
      if (mode === "income") {
        const premIdx = Math.floor(Math.random() * premiumDist.length);
        const avgPremium = premiumDist.length > 0 ? premiumDist[premIdx] : 50;
        cumulative += policyCount * avgPremium * 12;
      } else {
        cumulative += policyCount;
      }
      results[day].push(cumulative);
    }
  }

  const points: SimPoint[] = [];
  for (let day = 0; day < horizon; day++) {
    const sorted = results[day].sort((a, b) => a - b);
    const pct = (p: number) => sorted[Math.floor((p * sorted.length) / 100)] || 0;
    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + day + 1);
    points.push({
      day: day + 1,
      label: futureDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      p5: pct(5), p10: pct(10), p25: pct(25), p50: pct(50), p75: pct(75), p90: pct(90), p95: pct(95),
    });
  }
  return points;
}

function buildHistorical(daily: DailyRecord[], mode: "policies" | "income", trailingDays: number): SimPoint[] {
  const sorted = [...daily].sort((a, b) => a.submit_date.localeCompare(b.submit_date));
  const recent = sorted.slice(-trailingDays);
  if (recent.length === 0) return [];
  const points: SimPoint[] = [];
  let cumulative = 0;
  for (let i = 0; i < recent.length; i++) {
    const rec = recent[i];
    cumulative += mode === "income" ? rec.total_premium * 12 : rec.policy_count;
    const date = new Date(rec.submit_date);
    points.push({
      day: -(recent.length - i - 1),
      label: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      p5: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0, p95: 0,
      actual: cumulative,
    });
  }
  return points;
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${Math.round(value)}`;
}

function formatAxisValue(value: number, mode: ViewMode): string {
  if (mode === "policies" || mode === "combined") {
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return `${Math.round(value)}`;
  }
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${Math.round(value)}`;
}

function formatTooltipValue(value: number, mode: "policies" | "income"): string {
  if (mode === "policies") return `${value.toLocaleString()} policies`;
  return formatCurrency(value);
}

function CustomTooltip({
  active, payload, label, mode,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string }>;
  label?: string;
  mode: ViewMode;
}) {
  if (!active || !payload?.length || !label) return null;
  const actual = payload.find((p) => p.dataKey === "actual")?.value;
  const p50 = payload.find((p) => p.dataKey === "p50")?.value || 0;
  const p90 = payload.find((p) => p.dataKey === "p90")?.value || 0;
  const p10 = payload.find((p) => p.dataKey === "p10")?.value || 0;
  const displayMode = mode === "combined" ? "income" : mode;

  return (
    <div className="bg-navy/95 backdrop-blur border border-slate-700/50 rounded-lg shadow-lg p-3 text-sm">
      <p className="font-medium text-gold mb-2">{label}</p>
      <div className="space-y-1">
        {actual !== undefined && actual > 0 && (
          <div className="flex justify-between gap-4">
            <span className="text-sky-400">Actual</span>
            <span className="font-semibold text-white">{formatTooltipValue(actual, displayMode)}</span>
          </div>
        )}
        {p90 > 0 && (
          <>
            <div className="flex justify-between gap-4">
              <span className="text-emerald-400">Optimistic (P90)</span>
              <span className="font-semibold text-white">{formatTooltipValue(p90, displayMode)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-gold">Most Likely (P50)</span>
              <span className="font-semibold text-white">{formatTooltipValue(p50, displayMode)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-400">Conservative (P10)</span>
              <span className="font-semibold text-white">{formatTooltipValue(p10, displayMode)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function ProductionForecastChart({
  token,
  agencyFilter,
  agencies,
  agentNumber,
  title,
  compact = false,
}: ProductionForecastChartProps) {
  const [daily, setDaily] = useState<DailyRecord[]>([]);
  const [monthly, setMonthly] = useState<MonthlyRecord[]>([]);
  const [meta, setMeta] = useState<MonteCarloMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [horizon, setHorizon] = useState<Horizon>(90);
  const [viewMode, setViewMode] = useState<ViewMode>("income");
  const [target, setTarget] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      let result;
      if (agentNumber) {
        result = await adminGetMonteCarloAgentData(token, agentNumber);
      } else {
        result = await adminGetMonteCarloData(token, agencyFilter, undefined, undefined, agencies);
        if (result.target?.target) setTarget(Number(result.target.target));
      }
      setDaily(result.daily || []);
      setMonthly(result.monthly || []);
      setMeta(result.meta || null);
    } catch {
      // handled
    } finally {
      setLoading(false);
    }
  }, [token, agencyFilter, agentNumber, agencies]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const growthRate = useMemo(() => computeMonthlyGrowthRate(monthly), [monthly]);

  const policySim = useMemo(() => runSimulation(daily, monthly, horizon, 3000, "policies"), [daily, monthly, horizon]);
  const incomeSim = useMemo(() => runSimulation(daily, monthly, horizon, 3000, "income"), [daily, monthly, horizon]);

  const trailingDays = Math.min(30, daily.length);
  const policyHistorical = useMemo(() => buildHistorical(daily, "policies", trailingDays), [daily, trailingDays]);
  const incomeHistorical = useMemo(() => buildHistorical(daily, "income", trailingDays), [daily, trailingDays]);

  const chartData = useMemo(() => {
    const simData = viewMode === "policies" ? policySim : incomeSim;
    const histData = viewMode === "policies" ? policyHistorical : incomeHistorical;
    return [...histData, ...simData];
  }, [viewMode, policySim, incomeSim, policyHistorical, incomeHistorical]);

  const combinedChartData = useMemo(() => {
    const combined: (SimPoint & { policyP50?: number; policyActual?: number })[] = [];
    for (const pt of incomeHistorical) {
      const matchingPolicy = policyHistorical.find((p) => p.day === pt.day);
      combined.push({ ...pt, policyActual: matchingPolicy?.actual });
    }
    for (let i = 0; i < incomeSim.length; i++) {
      combined.push({ ...incomeSim[i], policyP50: policySim[i]?.p50 });
    }
    return combined;
  }, [incomeSim, incomeHistorical, policySim, policyHistorical]);

  const lastIncomePoint = incomeSim[incomeSim.length - 1];
  const lastPolicyPoint = policySim[policySim.length - 1];
  const sellingDays = useMemo(() => daily.filter((d) => d.policy_count > 0).length, [daily]);

  const displayTitle = title || (agentNumber ? "Agent Forecast" : agencyFilter ? `${agencyFilter} Forecast` : "Revenue Forecast");
  const chartHeight = compact ? "h-48 sm:h-56" : "h-52 sm:h-72";

  if (loading) {
    return (
      <div className="bg-navy rounded-xl border border-slate-700/50 p-6">
        <div className="flex items-center gap-3 mb-4">
          <TrendingUp size={18} className="text-gold" />
          <h3 className="text-sm font-semibold text-white">{displayTitle}</h3>
        </div>
        <div className={`${chartHeight} flex items-center justify-center`}>
          <Loader2 className="animate-spin text-slate-500" size={28} />
        </div>
      </div>
    );
  }

  if (daily.length < 7) {
    return (
      <div className="bg-navy rounded-xl border border-slate-700/50 p-6">
        <div className="flex items-center gap-3 mb-4">
          <TrendingUp size={18} className="text-gold" />
          <h3 className="text-sm font-semibold text-white">{displayTitle}</h3>
        </div>
        <div className={`${chartHeight} flex flex-col items-center justify-center text-slate-500`}>
          <TrendingUp size={36} className="mb-2 opacity-40" />
          <p className="text-sm">Insufficient data for forecast</p>
          <p className="text-xs mt-1 text-slate-600">{daily.length} days available, need at least 7</p>
        </div>
      </div>
    );
  }

  const renderChart = () => {
    if (viewMode === "combined") {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={combinedChartData} margin={{ top: 5, right: 50, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id={`fcBand-${agentNumber || agencyFilter || "all"}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#d4a84b" stopOpacity={0.15} />
                <stop offset="100%" stopColor="#d4a84b" stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} interval={Math.max(1, Math.floor(combinedChartData.length / 8))} />
            <YAxis yAxisId="income" tickFormatter={(v) => formatAxisValue(v, "income")} tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} width={55} />
            <YAxis yAxisId="policies" orientation="right" tickFormatter={(v) => formatAxisValue(v, "policies")} tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} width={45} />
            <Tooltip content={<CustomTooltip mode="combined" />} />
            {target && <ReferenceLine yAxisId="income" y={target} stroke="#d4a84b" strokeDasharray="6 4" strokeOpacity={0.6} />}
            <Area yAxisId="income" type="monotone" dataKey="p90" stroke="none" fill={`url(#fcBand-${agentNumber || agencyFilter || "all"})`} />
            <Area yAxisId="income" type="monotone" dataKey="p10" stroke="none" fill="transparent" />
            <Line yAxisId="income" type="monotone" dataKey="actual" stroke="#38bdf8" strokeWidth={2.5} dot={false} connectNulls />
            <Line yAxisId="income" type="monotone" dataKey="p50" stroke="#d4a84b" strokeWidth={2} dot={false} />
            <Line yAxisId="policies" type="monotone" dataKey="policyP50" stroke="#34d399" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
            <Line yAxisId="policies" type="monotone" dataKey="policyActual" stroke="#34d399" strokeWidth={2} dot={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      );
    }

    return (
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id={`fcP10P90-${agentNumber || agencyFilter || "all"}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d4a84b" stopOpacity={0.12} />
              <stop offset="100%" stopColor="#d4a84b" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id={`fcP25P75-${agentNumber || agencyFilter || "all"}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d4a84b" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#d4a84b" stopOpacity={0.1} />
            </linearGradient>
          </defs>
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} interval={Math.max(1, Math.floor(chartData.length / 8))} />
          <YAxis tickFormatter={(v) => formatAxisValue(v, viewMode)} tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} width={55} />
          <Tooltip content={<CustomTooltip mode={viewMode} />} />
          {target && viewMode === "income" && <ReferenceLine y={target} stroke="#d4a84b" strokeDasharray="6 4" strokeOpacity={0.6} />}
          <Area type="monotone" dataKey="p95" stroke="none" fill="transparent" />
          <Area type="monotone" dataKey="p90" stroke="none" fill={`url(#fcP10P90-${agentNumber || agencyFilter || "all"})`} />
          <Area type="monotone" dataKey="p10" stroke="none" fill="transparent" />
          <Area type="monotone" dataKey="p75" stroke="none" fill={`url(#fcP25P75-${agentNumber || agencyFilter || "all"})`} />
          <Area type="monotone" dataKey="p25" stroke="none" fill="transparent" />
          <Line type="monotone" dataKey="actual" stroke="#38bdf8" strokeWidth={2.5} dot={false} connectNulls />
          <Line type="monotone" dataKey="p50" stroke="#d4a84b" strokeWidth={2.5} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    );
  };

  return (
    <div className="bg-navy rounded-xl border border-slate-700/50 p-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <TrendingUp size={18} className="text-gold" />
          <div>
            <h3 className="text-sm font-semibold text-white">{displayTitle}</h3>
            <p className="text-[10px] text-slate-500 mt-0.5">
              Monte Carlo (3,000 iter) | {growthRate >= 0 ? "+" : ""}{(growthRate * 100).toFixed(1)}%/mo trend
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-0.5 bg-navy-light rounded-lg p-0.5 border border-slate-700/50">
            <button onClick={() => setViewMode("income")} className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors ${viewMode === "income" ? "bg-gold/20 text-gold" : "text-slate-400 hover:text-white"}`}>
              <DollarSign size={11} /> Income
            </button>
            <button onClick={() => setViewMode("policies")} className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors ${viewMode === "policies" ? "bg-gold/20 text-gold" : "text-slate-400 hover:text-white"}`}>
              <BarChart3 size={11} /> Policies
            </button>
            <button onClick={() => setViewMode("combined")} className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors ${viewMode === "combined" ? "bg-gold/20 text-gold" : "text-slate-400 hover:text-white"}`}>
              <Layers size={11} /> Both
            </button>
          </div>
          <div className="flex gap-0.5 bg-navy-light rounded-lg p-0.5 border border-slate-700/50">
            {([30, 60, 90, 180, 365] as Horizon[]).map((h) => (
              <button key={h} onClick={() => setHorizon(h)} className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${horizon === h ? "bg-gold/20 text-gold" : "text-slate-400 hover:text-white"}`}>
                {h >= 365 ? "1y" : `${h}d`}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={chartHeight}>{renderChart()}</div>

      <div className="flex items-center gap-4 mt-3 mb-3 px-1">
        <div className="flex items-center gap-1.5"><div className="w-4 h-0.5 bg-sky-400 rounded-full" /><span className="text-[10px] text-slate-500">Actual</span></div>
        <div className="flex items-center gap-1.5"><div className="w-4 h-0.5 bg-gold rounded-full" /><span className="text-[10px] text-slate-500">Median (P50)</span></div>
        <div className="flex items-center gap-1.5"><div className="w-4 h-1.5 bg-gold/20 rounded-sm" /><span className="text-[10px] text-slate-500">P10-P90 Band</span></div>
        {viewMode === "combined" && <div className="flex items-center gap-1.5"><div className="w-4 h-0.5 bg-emerald-400 rounded-full" /><span className="text-[10px] text-slate-500">Policies</span></div>}
      </div>

      <div className={`grid ${compact ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-5"} gap-3 pt-3 border-t border-slate-700/30`}>
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Optimistic (P90)</p>
          <p className="text-base font-bold text-emerald-400">{lastIncomePoint ? formatCurrency(lastIncomePoint.p90) : "--"}</p>
          {lastPolicyPoint && <p className="text-[10px] text-slate-600">{lastPolicyPoint.p90} policies</p>}
        </div>
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Most Likely (P50)</p>
          <p className="text-base font-bold text-gold">{lastIncomePoint ? formatCurrency(lastIncomePoint.p50) : "--"}</p>
          {lastPolicyPoint && <p className="text-[10px] text-slate-600">{lastPolicyPoint.p50} policies</p>}
        </div>
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Conservative (P10)</p>
          <p className="text-base font-bold text-slate-300">{lastIncomePoint ? formatCurrency(lastIncomePoint.p10) : "--"}</p>
          {lastPolicyPoint && <p className="text-[10px] text-slate-600">{lastPolicyPoint.p10} policies</p>}
        </div>
        {!compact && (
          <>
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Daily Run Rate</p>
              <p className="text-base font-bold text-sky-400">{lastIncomePoint ? formatCurrency(lastIncomePoint.p50 / horizon) : "--"}</p>
              <p className="text-[10px] text-slate-600">/day at P50</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Growth Trend</p>
              <p className={`text-base font-bold ${growthRate >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {growthRate >= 0 ? "+" : ""}{(growthRate * 100).toFixed(1)}%
              </p>
              <p className="text-[10px] text-slate-600">{sellingDays} selling days</p>
            </div>
          </>
        )}
      </div>

      {meta && !compact && (
        <div className="mt-3 pt-2 border-t border-slate-700/20">
          <p className="text-[10px] text-slate-600">
            Based on {meta.total_days} days ({meta.selling_days} active) from {meta.earliest_date} to {meta.latest_date}
          </p>
        </div>
      )}
    </div>
  );
}
