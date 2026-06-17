import { useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { Loader2, PieChart as PieChartIcon } from "lucide-react";

const COLORS = [
  "#d4a84b", // gold
  "#34d399", // emerald
  "#38bdf8", // sky
  "#f59e0b", // amber
  "#fb7185", // rose
  "#2dd4bf", // teal
  "#fb923c", // orange
  "#22d3ee", // cyan
  "#94a3b8", // slate
  "#a3e635", // lime
  "#fbbf24", // yellow
  "#4ade80", // green
];

export interface PieSlice {
  name: string;
  policies: number;
  revenue: number;
}

interface ProductionPieChartProps {
  data: PieSlice[];
  loading: boolean;
  title: string;
}

type ViewMode = "policies" | "revenue";

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function CustomTooltip({ active, payload, viewMode }: { active?: boolean; payload?: { name: string; value: number; payload: PieSlice }[]; viewMode: ViewMode }) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return (
    <div className="bg-navy-dark/95 border border-slate-700/50 rounded-lg px-3 py-2 shadow-xl">
      <p className="text-xs text-gold font-medium mb-1">{item.name}</p>
      <p className="text-sm text-white font-semibold">
        {viewMode === "revenue" ? formatCurrency(item.value) : `${item.value.toLocaleString()} policies`}
      </p>
    </div>
  );
}

export default function ProductionPieChart({ data, loading, title }: ProductionPieChartProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("policies");

  const total = data.reduce((sum, d) => sum + (viewMode === "policies" ? d.policies : d.revenue), 0);

  return (
    <div className="bg-navy rounded-xl border border-slate-700/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <PieChartIcon size={16} className="text-gold" />
          <h3 className="text-sm font-semibold text-white">{title}</h3>
        </div>
        <div className="flex items-center bg-navy-dark rounded-lg p-0.5 border border-slate-700/50">
          <button
            onClick={() => setViewMode("policies")}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              viewMode === "policies"
                ? "bg-navy-light text-gold"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Policies
          </button>
          <button
            onClick={() => setViewMode("revenue")}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              viewMode === "revenue"
                ? "bg-navy-light text-gold"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Annual Premium
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-[260px]">
          <Loader2 className="animate-spin text-slate-500" size={28} />
        </div>
      ) : data.length === 0 ? (
        <div className="flex items-center justify-center h-[260px] text-sm text-slate-500">
          No data available
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <div className="relative w-[200px] h-[200px] flex-shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey={viewMode}
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={90}
                  paddingAngle={1}
                  strokeWidth={0}
                >
                  {data.map((_, index) => (
                    <Cell key={index} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip viewMode={viewMode} />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-lg font-bold text-white">
                {viewMode === "revenue" ? formatCurrency(total) : total.toLocaleString()}
              </span>
              <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                {viewMode === "revenue" ? "Annual Premium" : "Policies"}
              </span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto max-h-[220px] space-y-1.5 pr-1">
            {data.map((item, index) => {
              const value = viewMode === "policies" ? item.policies : item.revenue;
              const pct = total > 0 ? ((value / total) * 100).toFixed(1) : "0.0";
              return (
                <div key={item.name} className="flex items-center gap-2 group">
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: COLORS[index % COLORS.length] }}
                  />
                  <span className="text-xs text-slate-300 truncate flex-1 group-hover:text-white transition-colors">
                    {item.name}
                  </span>
                  <span className="text-xs text-slate-400 font-medium tabular-nums flex-shrink-0">
                    {pct}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
