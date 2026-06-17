import { useState, useEffect, useCallback } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { Calendar, Loader2, TrendingUp, TrendingDown } from "lucide-react";
import { adminGetSalesChart } from "../../lib/api";

interface MonthlyDataPoint {
  date: string;
  revenue: number;
  policies: number;
}

interface MonthlyProductionChartProps {
  token: string;
  agencyFilter?: string;
  agencies?: string[];
  agentNumber?: string;
  title?: string;
  compact?: boolean;
}

function formatAxisCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
}

function formatMonthLabel(dateStr: string): string {
  if (dateStr.length === 7) {
    const [y, m] = dateStr.split("-");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[parseInt(m, 10) - 1]} '${y.slice(2)}`;
  }
  return dateStr;
}

function CustomTooltip({
  active, payload, label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length || !label) return null;
  return (
    <div className="bg-navy/95 backdrop-blur border border-slate-700/50 rounded-lg shadow-lg p-3 text-sm">
      <p className="font-medium text-gold mb-1.5">{formatMonthLabel(label)}</p>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-slate-400">{entry.dataKey === "revenue" ? "Annual Premium" : "Policies"}:</span>
          <span className="font-semibold text-white">
            {entry.dataKey === "revenue" ? `$${entry.value.toLocaleString()}` : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function MonthlyProductionChart({
  token,
  agencyFilter,
  agencies,
  agentNumber,
  title = "Monthly Production",
  compact = false,
}: MonthlyProductionChartProps) {
  const [data, setData] = useState<MonthlyDataPoint[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const end = new Date();
      const start = new Date(end);
      start.setMonth(start.getMonth() - 12);

      const startDate = start.toISOString();
      const endDate = end.toISOString();

      const agentFilter = agentNumber || undefined;
      const result = await adminGetSalesChart(token, startDate, endDate, agencyFilter || agentFilter, agencies);

      const chartData: MonthlyDataPoint[] = (result.chartData || []).map((p: { date: string; revenue: number; policies: number }) => ({
        date: p.date,
        revenue: p.revenue,
        policies: p.policies,
      }));

      setData(chartData);
    } catch {
      // handled
    }
    setLoading(false);
  }, [token, agencyFilter, agencies, agentNumber]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const trend = data.length >= 2 ? data[data.length - 1].revenue - data[0].revenue : 0;
  const avgRevenue = data.length > 0 ? data.reduce((s, d) => s + d.revenue, 0) / data.length : 0;
  const avgPolicies = data.length > 0 ? data.reduce((s, d) => s + d.policies, 0) / data.length : 0;
  const chartHeight = compact ? "h-40 sm:h-44" : "h-48 sm:h-56";

  if (loading) {
    return (
      <div className="bg-navy rounded-xl border border-slate-700/50 p-6">
        <div className="flex items-center gap-3 mb-4">
          <Calendar size={18} className="text-gold" />
          <h3 className="text-sm font-semibold text-white">{title}</h3>
        </div>
        <div className={`${chartHeight} flex items-center justify-center`}>
          <Loader2 className="animate-spin text-slate-500" size={28} />
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="bg-navy rounded-xl border border-slate-700/50 p-6">
        <div className="flex items-center gap-3 mb-4">
          <Calendar size={18} className="text-gold" />
          <h3 className="text-sm font-semibold text-white">{title}</h3>
        </div>
        <div className={`${chartHeight} flex flex-col items-center justify-center text-slate-500`}>
          <Calendar size={36} className="mb-2 opacity-40" />
          <p className="text-sm">No monthly data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-navy rounded-xl border border-slate-700/50 p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <Calendar size={18} className="text-gold" />
          <div>
            <h3 className="text-sm font-semibold text-white">{title}</h3>
            <p className="text-[10px] text-slate-500 mt-0.5">Last 12 months</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {trend !== 0 && (
            <span className={`flex items-center gap-1 text-xs font-semibold ${trend > 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {trend > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {trend > 0 ? "Uptrend" : "Downtrend"}
            </span>
          )}
        </div>
      </div>

      <div className={chartHeight}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="monthlyBarGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#d4a84b" stopOpacity={0.9} />
                <stop offset="100%" stopColor="#d4a84b" stopOpacity={0.4} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(100, 116, 139, 0.15)" />
            <XAxis dataKey="date" tickFormatter={formatMonthLabel} tick={{ fontSize: 10, fill: "#94A3B8" }} axisLine={false} tickLine={false} dy={6} />
            <YAxis yAxisId="left" tickFormatter={formatAxisCurrency} tick={{ fontSize: 10, fill: "#94A3B8" }} axisLine={false} tickLine={false} width={50} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: "#94A3B8" }} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
            <Tooltip content={<CustomTooltip />} />
            <Bar yAxisId="left" dataKey="revenue" fill="url(#monthlyBarGrad)" radius={[3, 3, 0, 0]} maxBarSize={32} />
            <Line yAxisId="right" type="monotone" dataKey="policies" stroke="#34d399" strokeWidth={2} dot={{ fill: "#34d399", r: 3, strokeWidth: 0 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {!compact && (
        <div className="grid grid-cols-3 gap-4 pt-3 mt-3 border-t border-slate-700/30">
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Avg Monthly Annual Premium</p>
            <p className="text-sm font-bold text-white">{formatAxisCurrency(avgRevenue)}</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Avg Monthly Policies</p>
            <p className="text-sm font-bold text-white">{Math.round(avgPolicies)}</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Months Tracked</p>
            <p className="text-sm font-bold text-white">{data.length}</p>
          </div>
        </div>
      )}
    </div>
  );
}
