import { ChevronRight } from "lucide-react";
import Sparkline from "./Sparkline";
import GrowthBadge from "./GrowthBadge";

export interface BreakdownRow {
  id: string;
  name: string;
  subtitle?: string;
  policies: number;
  revenue: number;
  avgPremium: number;
  previousRevenue: number;
  sparklineData: number[];
  agentCount?: number;
}

interface BreakdownTableProps {
  rows: BreakdownRow[];
  loading: boolean;
  onRowClick?: (row: BreakdownRow) => void;
  showAgentCount?: boolean;
  emptyMessage?: string;
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <tr key={i} className="animate-pulse">
          <td className="px-4 py-3"><div className="h-4 w-32 bg-navy-light rounded" /></td>
          <td className="px-4 py-3"><div className="h-4 w-12 bg-navy-light rounded" /></td>
          <td className="px-4 py-3"><div className="h-4 w-16 bg-navy-light rounded" /></td>
          <td className="px-4 py-3"><div className="h-4 w-14 bg-navy-light rounded" /></td>
          <td className="px-4 py-3"><div className="h-4 w-20 bg-navy-light rounded" /></td>
          <td className="px-4 py-3"><div className="h-4 w-14 bg-navy-light rounded" /></td>
          <td className="px-4 py-3"><div className="h-4 w-4 bg-navy-light rounded" /></td>
        </tr>
      ))}
    </>
  );
}

export default function BreakdownTable({
  rows,
  loading,
  onRowClick,
  showAgentCount = false,
  emptyMessage = "No data available",
}: BreakdownTableProps) {
  return (
    <div className="bg-navy rounded-xl border border-slate-700/50 overflow-hidden">
      {/* Mobile Card View */}
      <div className="sm:hidden">
        {loading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="animate-pulse h-16 bg-navy-light rounded-lg" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-12 text-center text-slate-500">{emptyMessage}</div>
        ) : (
          <div className="divide-y divide-slate-700/30">
            {rows.map((row) => (
              <div
                key={row.id}
                onClick={() => onRowClick?.(row)}
                className={`p-4 transition-colors ${onRowClick ? "cursor-pointer active:bg-navy-light/50" : ""}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-white font-medium truncate">{row.name}</p>
                    {row.subtitle && <p className="text-xs text-slate-400 mt-0.5">{row.subtitle}</p>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <GrowthBadge current={row.revenue} previous={row.previousRevenue} />
                    {onRowClick && <ChevronRight size={16} className="text-slate-500" />}
                  </div>
                </div>
                <div className="flex items-center gap-4 mt-2 text-xs">
                  <span className="text-slate-400"><span className="text-white font-semibold">{row.policies}</span> policies</span>
                  <span className="text-slate-400"><span className="text-gold font-semibold">{formatCurrency(row.revenue)}</span> AP</span>
                  {showAgentCount && row.agentCount !== undefined && (
                    <span className="text-slate-400"><span className="text-slate-200">{row.agentCount}</span> agents</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Desktop Table View */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700/50">
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Name</th>
              {showAgentCount && (
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Agents</th>
              )}
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Policies</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Annual Premium</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider hidden md:table-cell">Avg Premium</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-400 uppercase tracking-wider hidden lg:table-cell">Trend</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-400 uppercase tracking-wider">Growth</th>
              {onRowClick && <th className="px-4 py-3 w-8" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/30">
            {loading ? (
              <SkeletonRows />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={onRowClick ? 8 : 7} className="px-4 py-12 text-center text-slate-500">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => onRowClick?.(row)}
                  className={`transition-colors ${
                    onRowClick ? "cursor-pointer hover:bg-navy-light/50" : ""
                  }`}
                >
                  <td className="px-4 py-3">
                    <div>
                      <span className="text-white font-medium">{row.name}</span>
                      {row.subtitle && (
                        <span className="block text-xs text-slate-400 mt-0.5">{row.subtitle}</span>
                      )}
                    </div>
                  </td>
                  {showAgentCount && (
                    <td className="px-4 py-3 text-right text-slate-300">{row.agentCount ?? 0}</td>
                  )}
                  <td className="px-4 py-3 text-right text-slate-300 font-medium">{row.policies}</td>
                  <td className="px-4 py-3 text-right text-white font-semibold">{formatCurrency(row.revenue)}</td>
                  <td className="px-4 py-3 text-right text-slate-300 hidden md:table-cell">{formatCurrency(row.avgPremium)}</td>
                  <td className="px-4 py-3 text-center hidden lg:table-cell">
                    <Sparkline data={row.sparklineData} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <GrowthBadge current={row.revenue} previous={row.previousRevenue} />
                  </td>
                  {onRowClick && (
                    <td className="px-4 py-3 text-center">
                      <ChevronRight size={16} className="text-slate-500" />
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
