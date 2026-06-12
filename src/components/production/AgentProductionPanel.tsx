import { useState, useEffect, useCallback } from "react";
import MetricSection, { formatRangeLabel } from "./MetricSection";
import { CalendarRange } from "lucide-react";
import {
  DollarSign,
  FileText,
  TrendingUp,
  Users,
  BarChart3,
  Loader2,
  X,
  ExternalLink,
} from "lucide-react";
import KpiRow, { type KpiMetric } from "./KpiRow";
import TrendChart from "./TrendChart";
import ProductionForecastChart from "./ProductionForecastChart";
import MonthlyProductionChart from "./MonthlyProductionChart";
import WeeklyHeatmap from "./WeeklyHeatmap";
import {
  adminGetDashboardKpis,
  adminGetSalesChart,
  adminGetPolicies,
} from "../../lib/api";
import type { DateRange, ChartDataPoint, PolicyRow } from "../../types/dashboard";
import { getPreviousPeriod } from "../../lib/dateUtils";
import { resolvePlanName } from "../../lib/planCodes";

interface AgentProductionPanelProps {
  token: string;
  agentName: string;
  agentNumber: string;
  agency: string;
  dateRange: DateRange;
  onClose?: () => void;
  onViewPolicies?: () => void;
  inline?: boolean;
}

export default function AgentProductionPanel({
  token,
  agentName,
  agentNumber,
  agency,
  dateRange,
  onClose,
  onViewPolicies,
  inline = false,
}: AgentProductionPanelProps) {
  const [loading, setLoading] = useState(true);
  const [kpiMetrics, setKpiMetrics] = useState<KpiMetric[]>([]);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [policiesLoading, setPoliciesLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setPoliciesLoading(true);
    const prev = getPreviousPeriod(dateRange);

    try {
      const [kpis, chart, policyRes] = await Promise.all([
        adminGetDashboardKpis(token, dateRange.startDate, dateRange.endDate, prev.startDate, prev.endDate, agency, undefined, agentNumber).catch(() => null),
        adminGetSalesChart(token, dateRange.startDate, dateRange.endDate, agency, undefined, agentNumber).catch(() => ({ chartData: [] })),
        adminGetPolicies(token, dateRange.startDate, dateRange.endDate, 1, 20, agentNumber).catch(() => ({ policies: [], total: 0 })),
      ]);

      if (kpis) {
        setKpiMetrics([
          { label: "Policies Sold", value: kpis.policiesSold || 0, previousValue: kpis.prevPoliciesSold || 0, format: "number", icon: FileText },
          { label: "Total Revenue", value: kpis.totalRevenue || 0, previousValue: kpis.prevTotalRevenue || 0, format: "currency", icon: DollarSign },
          { label: "Avg Premium", value: kpis.avgPolicyValue || 0, previousValue: kpis.prevAvgPolicyValue || 0, format: "currency", icon: TrendingUp },
          { label: "New Clients", value: kpis.newClients || 0, previousValue: kpis.prevNewClients || 0, format: "number", icon: Users },
          { label: "Revenue/Agent", value: kpis.revenuePerAgent || 0, previousValue: kpis.prevRevenuePerAgent || 0, format: "currency", icon: BarChart3 },
        ]);
      }

      setChartData(chart.chartData || []);
      setPolicies(policyRes.policies || []);
    } catch {
      // handled
    }

    setLoading(false);
    setPoliciesLoading(false);
  }, [token, dateRange, agency, agentNumber]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const containerClass = inline
    ? "bg-navy-dark/50 border border-slate-700/30 rounded-xl p-6 animate-fade-in"
    : "space-y-6 animate-fade-in";

  return (
    <div className={containerClass}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-bold text-white">{agentName}</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {agency} &middot; Writing #{agentNumber}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onViewPolicies && (
            <button onClick={onViewPolicies} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-gold transition-colors px-2.5 py-1.5 rounded-lg border border-slate-700/50 hover:border-gold/30">
              <ExternalLink size={12} /> All Policies
            </button>
          )}
          {onClose && (
            <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-navy-light transition-colors">
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      <MetricSection
        icon={<CalendarRange size={14} className="text-gold" />}
        title="Production for Selected Dates"
        subtitle={formatRangeLabel(dateRange)}
      >
        <KpiRow metrics={kpiMetrics} loading={loading} />
      </MetricSection>

      <div className="mt-6">
        <TrendChart data={chartData} loading={loading} title={`${agentName} Production`} height={220} />
      </div>

      <div className="mt-6">
        <ProductionForecastChart
          token={token}
          agentNumber={agentNumber}
          title={`${agentName} Forecast`}
          compact={inline}
        />
      </div>

      <div className={`mt-6 grid ${inline ? "grid-cols-1" : "lg:grid-cols-2"} gap-6`}>
        <MonthlyProductionChart
          token={token}
          agentNumber={agentNumber}
          title={`${agentName} Monthly`}
          compact={inline}
        />
        <WeeklyHeatmap
          token={token}
          agentNumber={agentNumber}
          title={`${agentName} Day Patterns`}
        />
      </div>

      <div className="mt-6">
        <div className="bg-navy rounded-xl border border-slate-700/50 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700/50">
            <h4 className="text-sm font-semibold text-white">Recent Policies</h4>
          </div>
          {policiesLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="animate-spin text-slate-500" size={24} />
            </div>
          ) : policies.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500">No policies in this period</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700/30">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-400 uppercase">Client</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-400 uppercase">Policy #</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-400 uppercase">Carrier</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-400 uppercase">Plan</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-400 uppercase">Premium</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-slate-400 uppercase">Status</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-400 uppercase">Eff. Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/20">
                  {policies.slice(0, 15).map((p) => (
                    <tr key={p.id} className="hover:bg-navy-light/30 transition-colors">
                      <td className="px-3 py-2 text-white">{p.client_first_name} {p.client_last_name}</td>
                      <td className="px-3 py-2 text-slate-300 font-mono text-xs">{p.policy_number || "\u2014"}</td>
                      <td className="px-3 py-2 text-slate-300">{p.carrier}</td>
                      <td className="px-3 py-2 text-slate-300 max-w-[140px] truncate">{resolvePlanName(p.plan_name)}</td>
                      <td className="px-3 py-2 text-right text-white font-medium">${p.plan_premium?.toFixed(2)}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                          p.status === "active" ? "bg-emerald-500/10 text-emerald-400" :
                          p.status === "cancelled" ? "bg-rose-500/10 text-rose-400" :
                          "bg-amber-500/10 text-amber-400"
                        }`}>
                          {p.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-slate-400 text-xs">
                        {new Date(p.policy_effective_date).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
