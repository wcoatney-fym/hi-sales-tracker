import { useState, useEffect, useCallback } from "react";
import MetricSection, { formatRangeLabel } from "./MetricSection";
import { CalendarRange, BookOpen } from "lucide-react";
import {
  DollarSign,
  FileText,
  TrendingUp,
  Users,
  BarChart3,
  Search,
  Loader2,
} from "lucide-react";
import KpiRow, { type KpiMetric } from "./KpiRow";
import PolicyStatusKpiRow, { type PolicyStatusKpiData } from "./PolicyStatusKpiRow";
import TrendChart from "./TrendChart";
import ProductionForecastChart from "./ProductionForecastChart";
import MonthlyProductionChart from "./MonthlyProductionChart";
import WeeklyHeatmap from "./WeeklyHeatmap";
import GrowthBadge from "./GrowthBadge";
import AgentProductionPanel from "./AgentProductionPanel";
import BillingModeSection from "./BillingModeSection";
import ProductionPieChart, { type PieSlice } from "./ProductionPieChart";
import {
  adminGetDashboardKpis,
  adminGetSalesChart,
  adminGetAgentBreakdown,
  adminGetPlanBreakdown,
  adminGetPolicyStatusKpis,
} from "../../lib/api";
import { resolvePlanName } from "../../lib/planCodes";
import type { DateRange, ChartDataPoint } from "../../types/dashboard";
import { getPreviousPeriod } from "../../lib/dateUtils";

const INTERNAL_AGENCIES = ["FYM", "Wisechoice Senior Advisors Llc"];

type Scope = "all" | "fym" | "wisechoice";

interface AgentRow {
  agent_first_name: string;
  agent_last_name: string;
  agent_number: string;
  policies: number;
  revenue: number;
  avg_premium: number;
  prev_revenue: number;
  agency?: string;
}

interface InternalTabProps {
  token: string;
  dateRange: DateRange;
  onNavigatePolicies?: (agentNumber: string) => void;
}

export default function InternalTab({
  token,
  dateRange,
  onNavigatePolicies,
}: InternalTabProps) {
  const [scope, setScope] = useState<Scope>("all");
  const [search, setSearch] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<AgentRow | null>(null);

  const [kpiMetrics, setKpiMetrics] = useState<KpiMetric[]>([]);
  const [statusKpis, setStatusKpis] = useState<PolicyStatusKpiData | null>(null);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [planPieData, setPlanPieData] = useState<PieSlice[]>([]);
  const [pieLoading, setPieLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [agentsLoading, setAgentsLoading] = useState(true);

  const getAgencyFilter = useCallback((s: Scope): string | undefined => {
    if (s === "fym") return "FYM";
    if (s === "wisechoice") return "Wisechoice Senior Advisors Llc";
    return undefined;
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setAgentsLoading(true);
    setPieLoading(true);

    const prev = getPreviousPeriod(dateRange);
    const agencyForKpi = getAgencyFilter(scope);

    try {
      const kpiPromise = scope === "all"
        ? adminGetDashboardKpis(token, dateRange.startDate, dateRange.endDate, prev.startDate, prev.endDate, undefined, INTERNAL_AGENCIES)
        : adminGetDashboardKpis(token, dateRange.startDate, dateRange.endDate, prev.startDate, prev.endDate, agencyForKpi);

      const planPromise = scope === "all"
        ? adminGetPlanBreakdown(token, dateRange.startDate, dateRange.endDate, undefined, INTERNAL_AGENCIES)
        : adminGetPlanBreakdown(token, dateRange.startDate, dateRange.endDate, agencyForKpi);

      const referenceDate = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      const statusPromise = scope === "all"
        ? adminGetPolicyStatusKpis(token, referenceDate, undefined, INTERNAL_AGENCIES)
        : adminGetPolicyStatusKpis(token, referenceDate, agencyForKpi);

      const [chart, agentsFym, agentsWc, kpiResult, planBreakdown, statusResult] = await Promise.all([
        adminGetSalesChart(token, dateRange.startDate, dateRange.endDate, scope === "all" ? undefined : agencyForKpi, scope === "all" ? INTERNAL_AGENCIES : undefined).catch(() => ({ chartData: [] })),
        adminGetAgentBreakdown(token, dateRange.startDate, dateRange.endDate, prev.startDate, prev.endDate, "FYM").catch(() => ({ agents: [] })),
        adminGetAgentBreakdown(token, dateRange.startDate, dateRange.endDate, prev.startDate, prev.endDate, "Wisechoice Senior Advisors Llc").catch(() => ({ agents: [] })),
        kpiPromise,
        planPromise,
        statusPromise.catch(() => null),
      ]);

      setChartData(chart.chartData || []);

      const allAgents: AgentRow[] = [
        ...(agentsFym.agents || []).map((a: AgentRow) => ({ ...a, agency: "FYM" })),
        ...(agentsWc.agents || []).map((a: AgentRow) => ({ ...a, agency: "Wisechoice" })),
      ].sort((a, b) => b.revenue - a.revenue);
      setAgents(allAgents);

      setKpiMetrics([
        { label: "Policies Sold", value: kpiResult.policiesSold || 0, previousValue: kpiResult.prevPoliciesSold || 0, format: "number", icon: FileText },
        { label: "Total Revenue", value: kpiResult.totalRevenue || 0, previousValue: kpiResult.prevTotalRevenue || 0, format: "currency", icon: DollarSign },
        { label: "Active Agents", value: kpiResult.activeAgents || 0, previousValue: kpiResult.prevActiveAgents || 0, format: "number", icon: Users },
        { label: "Avg Premium", value: kpiResult.avgPolicyValue || 0, previousValue: kpiResult.prevAvgPolicyValue || 0, format: "currency", icon: TrendingUp },
        { label: "Revenue/Agent", value: kpiResult.revenuePerAgent || 0, previousValue: kpiResult.prevRevenuePerAgent || 0, format: "currency", icon: BarChart3 },
      ]);

      const planSlices: PieSlice[] = (planBreakdown.plans || []).map((p: { plan_name: string; policies: number; revenue: number }) => ({
        name: resolvePlanName(p.plan_name),
        policies: Number(p.policies),
        revenue: Number(p.revenue),
      }));
      setPlanPieData(planSlices);

      if (statusResult) {
        setStatusKpis({
          activeCount: Number(statusResult.active_count) || 0,
          terminatedCount: Number(statusResult.terminated_count) || 0,
          pendingCount: Number(statusResult.pending_count) || 0,
          atRiskCount: Number(statusResult.at_risk_count) || 0,
          totalCount: Number(statusResult.total_count) || 0,
        });
      }
    } catch {
      // handled
    }

    setLoading(false);
    setAgentsLoading(false);
    setPieLoading(false);
  }, [token, dateRange, scope, getAgencyFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredAgents = agents.filter((a) => {
    if (scope === "fym" && a.agency !== "FYM") return false;
    if (scope === "wisechoice" && a.agency !== "Wisechoice") return false;
    if (search) {
      const q = search.toLowerCase();
      const name = `${a.agent_first_name} ${a.agent_last_name}`.toLowerCase();
      return name.includes(q) || a.agent_number.toLowerCase().includes(q);
    }
    return true;
  });

  const forecastAgencyFilter = scope === "fym" ? "FYM" : scope === "wisechoice" ? "Wisechoice Senior Advisors Llc" : undefined;
  const forecastAgencies = scope === "all" ? INTERNAL_AGENCIES : undefined;

  function formatCurrency(value: number): string {
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
    return `$${value.toFixed(0)}`;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-1 bg-navy p-1 rounded-lg border border-slate-700/50 w-fit">
          {([
            { key: "all", label: "All Internal" },
            { key: "fym", label: "FYM Direct" },
            { key: "wisechoice", label: "Wisechoice" },
          ] as { key: Scope; label: string }[]).map((s) => (
            <button
              key={s.key}
              onClick={() => { setScope(s.key); setSelectedAgent(null); }}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                scope === s.key
                  ? "bg-navy-light text-gold border border-gold/20"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {selectedAgent ? (
        <AgentProductionPanel
          token={token}
          agentName={`${selectedAgent.agent_first_name} ${selectedAgent.agent_last_name}`}
          agentNumber={selectedAgent.agent_number}
          agency={selectedAgent.agency || "FYM"}
          dateRange={dateRange}
          onClose={() => setSelectedAgent(null)}
          onViewPolicies={onNavigatePolicies ? () => onNavigatePolicies(selectedAgent.agent_number) : undefined}
          inline
        />
      ) : (
        <>
          <MetricSection
            icon={<CalendarRange size={14} className="text-gold" />}
            title="Production for Selected Dates"
            subtitle={formatRangeLabel(dateRange)}
          >
            <KpiRow metrics={kpiMetrics} loading={loading} />
          </MetricSection>
          <MetricSection
            icon={<BookOpen size={14} className="text-sky-400" />}
            title="Book of Business"
            subtitle="entire current book, as of today — not affected by the date picker"
          >
            <PolicyStatusKpiRow data={statusKpis} loading={loading} />
          </MetricSection>

          <TrendChart
            data={chartData}
            loading={loading}
            title={scope === "all" ? "Internal Team Production" : scope === "fym" ? "FYM Direct Production" : "Wisechoice Production"}
          />

          <ProductionForecastChart
            token={token}
            agencyFilter={forecastAgencyFilter}
            agencies={forecastAgencies}
            title={scope === "all" ? "Internal Team Forecast" : scope === "fym" ? "FYM Forecast" : "Wisechoice Forecast"}
          />

          <ProductionPieChart
            data={planPieData}
            loading={pieLoading}
            title="Production by Plan"
          />

          <div className="grid lg:grid-cols-2 gap-6">
            <MonthlyProductionChart
              token={token}
              agencyFilter={forecastAgencyFilter}
              agencies={forecastAgencies}
              title={scope === "all" ? "Monthly Production" : `${scope === "fym" ? "FYM" : "Wisechoice"} Monthly`}
            />
            <WeeklyHeatmap
              token={token}
              agencyFilter={forecastAgencyFilter}
              agencies={forecastAgencies}
              title={scope === "all" ? "Day-of-Week Patterns" : `${scope === "fym" ? "FYM" : "Wisechoice"} Day Patterns`}
            />
          </div>
        </>
      )}

      {!selectedAgent && (
        <BillingModeSection
          token={token}
          dateRange={dateRange}
          agencyFilter={forecastAgencyFilter}
          agencies={forecastAgencies}
        />
      )}

      <div className="bg-navy rounded-xl border border-slate-700/50 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700/50 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-white">Agent Roster</h3>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agents..."
              className="pl-8 pr-3 py-1.5 text-sm bg-navy-light border border-slate-700/50 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-gold/50 w-56"
            />
          </div>
        </div>

        {agentsLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="animate-spin text-slate-500" size={28} />
          </div>
        ) : filteredAgents.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">No agents found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700/30">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Agent</th>
                  {scope === "all" && (
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Sub-Agency</th>
                  )}
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Policies</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Revenue</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Avg Premium</th>
                  <th className="px-4 py-2.5 text-center text-xs font-semibold text-slate-400 uppercase tracking-wider">Growth</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/20">
                {filteredAgents.map((agent) => {
                  const isSelected = selectedAgent?.agent_number === agent.agent_number;
                  return (
                    <tr
                      key={agent.agent_number}
                      onClick={() => { setSelectedAgent(isSelected ? null : agent); if (!isSelected) window.scrollTo({ top: 0, behavior: "smooth" }); }}
                      className={`cursor-pointer transition-colors ${isSelected ? "bg-navy-light/70" : "hover:bg-navy-light/30"}`}
                    >
                      <td className="px-4 py-3 text-white font-medium">
                        {agent.agent_first_name} {agent.agent_last_name}
                        <span className="text-xs text-slate-500 ml-2">#{agent.agent_number}</span>
                      </td>
                      {scope === "all" && (
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            agent.agency === "FYM" ? "bg-gold/10 text-gold" : "bg-sky-500/10 text-sky-400"
                          }`}>
                            {agent.agency}
                          </span>
                        </td>
                      )}
                      <td className="px-4 py-3 text-right text-slate-300">{agent.policies}</td>
                      <td className="px-4 py-3 text-right text-white font-semibold">{formatCurrency(agent.revenue)}</td>
                      <td className="px-4 py-3 text-right text-slate-300">{formatCurrency(agent.avg_premium)}</td>
                      <td className="px-4 py-3 text-center">
                        <GrowthBadge current={agent.revenue} previous={agent.prev_revenue} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
