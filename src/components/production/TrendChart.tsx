import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { Loader2, BarChart3 } from "lucide-react";
import type { ChartDataPoint } from "../../types/dashboard";

interface TrendChartProps {
  data: ChartDataPoint[];
  loading: boolean;
  title?: string;
  height?: number;
}

function formatAxisCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
}

function formatDateLabel(dateStr: string): string {
  if (dateStr.length === 7) {
    const [y, m] = dateStr.split("-");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[parseInt(m, 10) - 1]} ${y.slice(2)}`;
  }
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length || !label) return null;

  return (
    <div className="bg-navy/95 backdrop-blur border border-slate-700/50 rounded-lg shadow-lg p-3 text-sm">
      <p className="font-medium text-gold mb-1.5">{formatDateLabel(label)}</p>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-slate-400">
            {entry.dataKey === "revenue" ? "Revenue" : "Policies"}:
          </span>
          <span className="font-semibold text-white">
            {entry.dataKey === "revenue" ? `$${entry.value.toLocaleString()}` : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function TrendChart({ data, loading, title = "Revenue & Policy Trends", height = 280 }: TrendChartProps) {
  return (
    <div className="bg-navy rounded-xl border border-slate-700/50 p-6">
      <div className="flex items-center gap-3 mb-6">
        <BarChart3 size={20} className="text-gold" />
        <h3 className="text-base font-semibold text-white">{title}</h3>
      </div>

      {loading ? (
        <div style={{ height }} className="flex items-center justify-center">
          <Loader2 className="animate-spin text-slate-500" size={32} />
        </div>
      ) : data.length === 0 ? (
        <div style={{ height }} className="flex flex-col items-center justify-center text-slate-500">
          <BarChart3 size={40} className="mb-3 opacity-40" />
          <p className="text-sm">No data for the selected period</p>
        </div>
      ) : (
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="trendBarGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#d4a84b" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="#d4a84b" stopOpacity={0.4} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(100, 116, 139, 0.15)" />
              <XAxis
                dataKey="date"
                tickFormatter={formatDateLabel}
                tick={{ fontSize: 11, fill: "#94A3B8" }}
                axisLine={false}
                tickLine={false}
                dy={8}
              />
              <YAxis
                yAxisId="left"
                tickFormatter={formatAxisCurrency}
                tick={{ fontSize: 11, fill: "#94A3B8" }}
                axisLine={false}
                tickLine={false}
                width={55}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 11, fill: "#94A3B8" }}
                axisLine={false}
                tickLine={false}
                width={35}
                allowDecimals={false}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
                formatter={(val: string) => <span className="text-slate-400 capitalize">{val}</span>}
              />
              <Bar yAxisId="left" dataKey="revenue" fill="url(#trendBarGradient)" radius={[4, 4, 0, 0]} maxBarSize={40} />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="policies"
                stroke="#34d399"
                strokeWidth={2.5}
                dot={{ fill: "#34d399", r: 3.5, strokeWidth: 0 }}
                activeDot={{ fill: "#34d399", r: 5, strokeWidth: 2, stroke: "#1a2744" }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
