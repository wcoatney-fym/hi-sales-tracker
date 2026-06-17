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
import { TrendingUp, Loader2, RefreshCw, Target, BarChart3, DollarSign, Layers, Calendar, Database } from "lucide-react";
import { adminGetMonteCarloData, adminSetMonteCarloTarget, adminRefreshMonteCarlo } from "../../lib/api";

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
  last_refresh: string;
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

interface MonteCarloChartProps {
  token: string;
  agencyFilter?: string;
  dateRange?: { startDate: string; endDate: string };
}

function linearRegression(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] || 0 };
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
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
  for (const rec of daily) {
    const arr = dists.get(rec.day_of_week)!;
    arr.push(rec.policy_count);
  }
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

      if (dowArr.length === 0) {
        results[day].push(cumulative);
        continue;
      }

      const idx = Math.floor(Math.random() * dowArr.length);
      let policyCount = dowArr[idx];

      const trendMultiplier = Math.pow(1 + dailyGrowth, day);
      policyCount = Math.round(policyCount * trendMultiplier);

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
    const label = futureDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });

    points.push({
      day: day + 1,
      label,
      p5: pct(5),
      p10: pct(10),
      p25: pct(25),
      p50: pct(50),
      p75: pct(75),
      p90: pct(90),
      p95: pct(95),
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
    if (mode === "income") {
      cumulative += rec.total_premium * 12;
    } else {
      cumulative += rec.policy_count;
    }

    const date = new Date(rec.submit_date);
    const label = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });

    points.push({
      day: -(recent.length - i - 1),
      label,
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
  active,
  payload,
  label,
  mode,
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

export default function MonteCarloChart({ token, agencyFilter, dateRange }: MonteCarloChartProps) {
  const [daily, setDaily] = useState<DailyRecord[]>([]);
  const [monthly, setMonthly] = useState<MonthlyRecord[]>([]);
  const [meta, setMeta] = useState<MonteCarloMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [horizon, setHorizon] = useState<Horizon>(90);
  const [viewMode, setViewMode] = useState<ViewMode>("income");
  const [target, setTarget] = useState<number | null>(null);
  const [showTargetInput, setShowTargetInput] = useState(false);
  const [useDateFilter, setUseDateFilter] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const startDate = useDateFilter && dateRange ? dateRange.startDate : undefined;
      const endDate = useDateFilter && dateRange ? dateRange.endDate : undefined;
      const result = await adminGetMonteCarloData(token, agencyFilter, startDate, endDate);
      setDaily(result.daily || []);
      setMonthly(result.monthly || []);
      setMeta(result.meta || null);
      if (result.target?.target) {
        setTarget(Number(result.target.target));
      }
    } catch (err) {
      console.error("Monte Carlo fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [token, agencyFilter, useDateFilter, dateRange]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await adminRefreshMonteCarlo(token);
      await fetchData();
    } finally {
      setRefreshing(false);
    }
  };

  const handleSetTarget = async (value: number | null) => {
    setTarget(value);
    setShowTargetInput(false);
    try {
      await adminSetMonteCarloTarget(token, value);
    } catch (err) {
      console.error("Failed to save target:", err);
    }
  };

  const growthRate = useMemo(() => computeMonthlyGrowthRate(monthly), [monthly]);

  const policySim = useMemo(() => {
    return runSimulation(daily, monthly, horizon, 5000, "policies");
  }, [daily, monthly, horizon]);

  const incomeSim = useMemo(() => {
    return runSimulation(daily, monthly, horizon, 5000, "income");
  }, [daily, monthly, horizon]);

  const trailingDays = Math.min(30, daily.length);

  const policyHistorical = useMemo(() => buildHistorical(daily, "policies", trailingDays), [daily, trailingDays]);
  const incomeHistorical = useMemo(() => buildHistorical(daily, "income", trailingDays), [daily, trailingDays]);

  const chartData = useMemo(() => {
    const simData = viewMode === "policies" ? policySim : incomeSim;
    const histData = viewMode === "policies" ? policyHistorical : incomeHistorical;

    const combined: SimPoint[] = [
      ...histData,
      ...simData,
    ];
    return combined;
  }, [viewMode, policySim, incomeSim, policyHistorical, incomeHistorical]);

  const combinedChartData = useMemo(() => {
    const combined: (SimPoint & { policyP50?: number; policyActual?: number })[] = [];
    for (const pt of incomeHistorical) {
      const matchingPolicy = policyHistorical.find((p) => p.day === pt.day);
      combined.push({
        ...pt,
        policyActual: matchingPolicy?.actual,
      });
    }
    for (let i = 0; i < incomeSim.length; i++) {
      combined.push({
        ...incomeSim[i],
        policyP50: policySim[i]?.p50,
      });
    }
    return combined;
  }, [incomeSim, incomeHistorical, policySim, policyHistorical]);

  const targetProbability = useMemo(() => {
    if (!target || incomeSim.length === 0) return null;
    const lastPoint = incomeSim[incomeSim.length - 1];
    if (!lastPoint) return null;

    if (target <= lastPoint.p5) return 97;
    if (target <= lastPoint.p10) return 90;
    if (target <= lastPoint.p25) return 75;
    if (target <= lastPoint.p50) return 50;
    if (target <= lastPoint.p75) return 25;
    if (target <= lastPoint.p90) return 10;
    if (target <= lastPoint.p95) return 5;
    return 2;
  }, [target, incomeSim]);

  const lastIncomePoint = incomeSim[incomeSim.length - 1];
  const lastPolicyPoint = policySim[policySim.length - 1];

  const fymCount = useMemo(() => {
    const fym = daily.filter((d) => d.policy_count > 0).length;
    return fym;
  }, [daily]);

  const nextRefresh = useMemo(() => {
    const now = new Date();
    const refreshHoursUTC = [13, 16, 22];
    for (const h of refreshHoursUTC) {
      const next = new Date(now);
      next.setUTCHours(h, 0, 0, 0);
      if (next > now) return next;
    }
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setUTCHours(13, 0, 0, 0);
    return tomorrow;
  }, []);

  const timeUntilRefresh = useMemo(() => {
    const diff = nextRefresh.getTime() - Date.now();
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }, [nextRefresh]);

  if (loading) {
    return (
      <div className="bg-navy rounded-xl border border-slate-700/50 p-6">
        <div className="flex items-center gap-3 mb-6">
          <TrendingUp size={20} className="text-gold" />
          <h3 className="text-base font-semibold text-white">Annual Premium Forecast</h3>
        </div>
        <div className="h-52 sm:h-80 flex items-center justify-center">
          <Loader2 className="animate-spin text-slate-500" size={32} />
        </div>
      </div>
    );
  }

  if (daily.length < 7) {
    return (
      <div className="bg-navy rounded-xl border border-slate-700/50 p-6">
        <div className="flex items-center gap-3 mb-6">
          <TrendingUp size={20} className="text-gold" />
          <h3 className="text-base font-semibold text-white">Annual Premium Forecast</h3>
        </div>
        <div className="h-80 flex flex-col items-center justify-center text-slate-500">
          <TrendingUp size={40} className="mb-3 opacity-40" />
          <p className="text-sm">Insufficient data for projections</p>
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
              <linearGradient id="mcIncBand" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#d4a84b" stopOpacity={0.15} />
                <stop offset="100%" stopColor="#d4a84b" stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "#64748b" }}
              axisLine={false}
              tickLine={false}
              interval={Math.max(1, Math.floor(combinedChartData.length / 8))}
            />
            <YAxis
              yAxisId="income"
              tickFormatter={(v) => formatAxisValue(v, "income")}
              tick={{ fontSize: 10, fill: "#64748b" }}
              axisLine={false}
              tickLine={false}
              width={60}
            />
            <YAxis
              yAxisId="policies"
              orientation="right"
              tickFormatter={(v) => formatAxisValue(v, "policies")}
              tick={{ fontSize: 10, fill: "#64748b" }}
              axisLine={false}
              tickLine={false}
              width={50}
            />
            <Tooltip content={<CustomTooltip mode="combined" />} />
            {target && <ReferenceLine yAxisId="income" y={target} stroke="#d4a84b" strokeDasharray="6 4" strokeOpacity={0.6} />}
            <Area yAxisId="income" type="monotone" dataKey="p90" stroke="none" fill="url(#mcIncBand)" />
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
            <linearGradient id="mcP5P95" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d4a84b" stopOpacity={0.05} />
              <stop offset="100%" stopColor="#d4a84b" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="mcP10P90" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d4a84b" stopOpacity={0.12} />
              <stop offset="100%" stopColor="#d4a84b" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="mcP25P75" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d4a84b" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#d4a84b" stopOpacity={0.1} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "#64748b" }}
            axisLine={false}
            tickLine={false}
            interval={Math.max(1, Math.floor(chartData.length / 8))}
          />
          <YAxis
            tickFormatter={(v) => formatAxisValue(v, viewMode)}
            tick={{ fontSize: 10, fill: "#64748b" }}
            axisLine={false}
            tickLine={false}
            width={60}
          />
          <Tooltip content={<CustomTooltip mode={viewMode} />} />
          {target && viewMode === "income" && (
            <ReferenceLine y={target} stroke="#d4a84b" strokeDasharray="6 4" strokeOpacity={0.6} />
          )}
          <Area type="monotone" dataKey="p95" stroke="none" fill="url(#mcP5P95)" />
          <Area type="monotone" dataKey="p5" stroke="none" fill="transparent" />
          <Area type="monotone" dataKey="p90" stroke="none" fill="url(#mcP10P90)" />
          <Area type="monotone" dataKey="p10" stroke="none" fill="transparent" />
          <Area type="monotone" dataKey="p75" stroke="none" fill="url(#mcP25P75)" />
          <Area type="monotone" dataKey="p25" stroke="none" fill="transparent" />
          <Line type="monotone" dataKey="actual" stroke="#38bdf8" strokeWidth={2.5} dot={false} connectNulls />
          <Line type="monotone" dataKey="p50" stroke="#d4a84b" strokeWidth={2.5} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    );
  };

  return (
    <div className="bg-navy rounded-xl border border-slate-700/50 p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-5">
        <div className="flex items-center gap-3">
          <TrendingUp size={20} className="text-gold" />
          <div>
            <h3 className="text-base font-semibold text-white">FYM Direct + Wisechoice Annual Premium Forecast</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Monte Carlo simulation (5,000 iterations) | DOW-weighted | {growthRate >= 0 ? "+" : ""}{(growthRate * 100).toFixed(1)}%/mo trend
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* View mode selector */}
          <div className="flex gap-0.5 bg-navy-light rounded-lg p-0.5 border border-slate-700/50">
            <button
              onClick={() => setViewMode("income")}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                viewMode === "income" ? "bg-gold/20 text-gold" : "text-slate-400 hover:text-white"
              }`}
              title="Annualized Premium"
            >
              <DollarSign size={12} />
              Income
            </button>
            <button
              onClick={() => setViewMode("policies")}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                viewMode === "policies" ? "bg-gold/20 text-gold" : "text-slate-400 hover:text-white"
              }`}
              title="Policy Count"
            >
              <BarChart3 size={12} />
              Policies
            </button>
            <button
              onClick={() => setViewMode("combined")}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                viewMode === "combined" ? "bg-gold/20 text-gold" : "text-slate-400 hover:text-white"
              }`}
              title="Combined View"
            >
              <Layers size={12} />
              Both
            </button>
          </div>

          {/* Horizon selector */}
          <div className="flex gap-0.5 bg-navy-light rounded-lg p-0.5 border border-slate-700/50">
            {([30, 60, 90, 180, 365] as Horizon[]).map((h) => (
              <button
                key={h}
                onClick={() => setHorizon(h)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  horizon === h ? "bg-gold/20 text-gold" : "text-slate-400 hover:text-white"
                }`}
              >
                {h >= 365 ? "1y" : `${h}d`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Target + Refresh controls */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowTargetInput(!showTargetInput)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              target
                ? "border-gold/40 bg-gold/10 text-gold"
                : "border-slate-600 text-slate-400 hover:text-white hover:border-slate-500"
            }`}
          >
            <Target size={12} />
            {target ? `Target: ${formatCurrency(target)}` : "Set Target"}
          </button>
          {target && targetProbability !== null && (
            <span className="text-xs text-emerald-400 font-medium">
              {targetProbability}% probability in {horizon}d
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setUseDateFilter(!useDateFilter)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              useDateFilter
                ? "border-sky-500/40 bg-sky-500/10 text-sky-400"
                : "border-slate-600 text-slate-400 hover:text-white hover:border-slate-500"
            }`}
            title={useDateFilter ? "Using selected date range" : "Using all historical data"}
          >
            {useDateFilter ? <Calendar size={12} /> : <Database size={12} />}
            {useDateFilter ? "Date Range" : "All History"}
          </button>
          {useDateFilter && dateRange && (
            <span className="text-[10px] text-sky-400/70">
              Based on {dateRange.startDate} to {dateRange.endDate}
            </span>
          )}
          <span className="text-[10px] text-slate-600">
            Next refresh in {timeUntilRefresh}
          </span>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-400 hover:text-white border border-slate-700/50 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* Target input */}
      {showTargetInput && (
        <div className="flex items-center gap-2 mb-4 animate-fade-in">
          <span className="text-xs text-slate-400">Annual Premium Target $</span>
          <input
            type="number"
            placeholder="e.g. 500000"
            defaultValue={target || ""}
            onBlur={(e) => {
              const val = Number(e.target.value);
              handleSetTarget(val > 0 ? val : null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const val = Number((e.target as HTMLInputElement).value);
                handleSetTarget(val > 0 ? val : null);
              }
            }}
            autoFocus
            className="w-36 px-3 py-1.5 text-sm border border-slate-600 rounded-lg bg-navy-light text-white focus:outline-none focus:ring-1 focus:ring-gold"
          />
          {target && (
            <button
              onClick={() => handleSetTarget(null)}
              className="text-xs text-slate-500 hover:text-red-400 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Chart */}
      <div className="h-52 sm:h-72">
        {renderChart()}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 mb-4 px-2">
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-0.5 bg-sky-400 rounded-full" />
          <span className="text-[10px] text-slate-500">Actual</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-0.5 bg-gold rounded-full" />
          <span className="text-[10px] text-slate-500">Median (P50)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-1.5 bg-gold/20 rounded-sm" />
          <span className="text-[10px] text-slate-500">P10-P90 Band</span>
        </div>
        {viewMode === "combined" && (
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-0.5 bg-emerald-400 rounded-full border-dashed" style={{ borderTop: "1px dashed #34d399" }} />
            <span className="text-[10px] text-slate-500">Policies (right axis)</span>
          </div>
        )}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 pt-4 border-t border-slate-700/30">
        <div>
          <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">Optimistic (P90)</p>
          <p className="text-lg font-bold text-emerald-400">
            {lastIncomePoint ? formatCurrency(lastIncomePoint.p90) : "--"}
          </p>
          {lastPolicyPoint && (
            <p className="text-[10px] text-slate-600">{lastPolicyPoint.p90.toLocaleString()} policies</p>
          )}
        </div>
        <div>
          <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">Most Likely (P50)</p>
          <p className="text-lg font-bold text-gold">
            {lastIncomePoint ? formatCurrency(lastIncomePoint.p50) : "--"}
          </p>
          {lastPolicyPoint && (
            <p className="text-[10px] text-slate-600">{lastPolicyPoint.p50.toLocaleString()} policies</p>
          )}
        </div>
        <div>
          <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">Conservative (P10)</p>
          <p className="text-lg font-bold text-slate-300">
            {lastIncomePoint ? formatCurrency(lastIncomePoint.p10) : "--"}
          </p>
          {lastPolicyPoint && (
            <p className="text-[10px] text-slate-600">{lastPolicyPoint.p10.toLocaleString()} policies</p>
          )}
        </div>
        <div>
          <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">Daily Run Rate</p>
          <p className="text-lg font-bold text-sky-400">
            {lastIncomePoint ? formatCurrency(lastIncomePoint.p50 / horizon) : "--"}
          </p>
          <p className="text-[10px] text-slate-600">/day at P50</p>
        </div>
        <div>
          <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">Growth Trend</p>
          <p className={`text-lg font-bold ${growthRate >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {growthRate >= 0 ? "+" : ""}{(growthRate * 100).toFixed(1)}%
          </p>
          <p className="text-[10px] text-slate-600">{fymCount} selling days</p>
        </div>
      </div>

      {/* Data freshness */}
      {meta && (
        <div className="mt-4 pt-3 border-t border-slate-700/20 flex items-center justify-between">
          <p className="text-[10px] text-slate-600">
            Based on {meta.total_days} total days ({meta.selling_days} active) from {meta.earliest_date} to {meta.latest_date}
          </p>
          <p className="text-[10px] text-slate-600">
            Refreshes at 9am, 12pm, 6pm EST
          </p>
        </div>
      )}
    </div>
  );
}
