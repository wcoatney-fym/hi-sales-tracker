import { useState, useEffect, useCallback } from "react";
import {
  DollarSign,
  FileText,
  TrendingUp,
  Users,
  BarChart3,
  Building2,
  CalendarRange,
  BookOpen,
} from "lucide-react";
import KpiRow, { type KpiMetric } from "./KpiRow";
import PolicyStatusKpiRow, { type PolicyStatusKpiData } from "./PolicyStatusKpiRow";
import TrendChart from "./TrendChart";
import ProductionForecastChart from "./ProductionForecastChart";
import MonthlyProductionChart from "./MonthlyProductionChart";
import WeeklyHeatmap from "./WeeklyHeatmap";
import BreadcrumbNav, { type BreadcrumbSegment } from "./BreadcrumbNav";
import BreakdownTable, { type BreakdownRow } from "./BreakdownTable";
import AgentProductionPanel from "./AgentProductionPanel";
import BillingModeSection from "./BillingModeSection";
import MetricSection, { formatRangeLabel } from "./MetricSection";
import QualityMetrics from "../QualityMetrics";
import ProductionPieChart, { type PieSlice } from "./ProductionPieChart";
import {
  adminGetDashboardKpis,
  adminGetSalesChart,
  adminGetAgencyBreakdown,
  adminGetAgentBreakdown,
  adminGetPlanBreakdown,
  adminGetPolicyStatusKpis,
} from "../../lib/api";
import { resolvePlanName } from "../../lib/planCodes";
import type { DateRange, ChartDataPoint } from "../../types/dashboard";
import { getPreviousPeriod } from "../../lib/dateUtils";

type Level = "org" | "agency" | "agent";

interface AgencyData {
  agency: string;
  policies: number;
  revenue: number;
  avg_premium: number;
  agent_count: number;
  prev_revenue: number;
}

interface AgentData {
  agent_first_name: string;
  agent_last_name: string;
  agent_number: string;
  policies: number;
  revenue: number;
  avg_premium: number;
  prev_revenue: number;
}

interface OverviewTabProps {
  token: string;
  dateRange: DateRange;
  lockedAgency?: string;
  onNavigatePolicies?: (agentNumber: string) => void;
}

export default function OverviewTab({
  token,
  dateRange,
  lockedAgency,
  onNavigatePolicies,
}: OverviewTabProps) {
  const [level, setLevel] = useState<Level>(lockedAgency ? "agency" : "org");
  const [selectedAgency, setSelectedAgency] = useState<string>(lockedAgency || "");
  const [selectedAgent, setSelectedAgent] = useState<AgentData | null>(null);

  const [kpiMetrics, setKpiMetrics] = useState<KpiMetric[]>([]);
  const [statusKpis, setStatusKpis] = useState<PolicyStatusKpiData | null>(null);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [breakdownRows, setBreakdownRows] = useState<BreakdownRow[]>([]);
  const [agencyPieData, setAgencyPieData] = useState<PieSlice[]>([]);
  const [planPieData, setPlanPieData] = useState<PieSlice[]>([]);
  const [pieLoading, setPieLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(true);

  const fetchOrgLevel = useCallback(async () => {
    setLoading(true);
    setTableLoading(true);
    setPieLoading(true);
    const prev = getPreviousPeriod(dateRange);

    const referenceDate = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

    try {
      const [kpis, chart, breakdown, planBreakdown, statusResult] = await Promise.all([
        adminGetDashboardKpis(token, dateRange.startDate, dateRange.endDate, prev.startDate, prev.endDate),
        adminGetSalesChart(token, dateRange.startDate, dateRange.endDate),
        adminGetAgencyBreakdown(token, dateRange.startDate, dateRange.endDate, prev.startDate, prev.endDate),
        adminGetPlanBreakdown(token, dateRange.startDate, dateRange.endDate),
        adminGetPolicyStatusKpis(token, referenceDate).catch(() => null),
      ]);

      setKpiMetrics([
        { label: "Policies Sold", value: kpis.policiesSold || 0, previousValue: kpis.prevPoliciesSold || 0, format: "number", icon: FileText },
        { label: "Total Revenue", value: kpis.totalRevenue || 0, previousValue: kpis.prevTotalRevenue || 0, format: "currency", icon: DollarSign },
        { label: "Active Agents", value: kpis.activeAgents || 0, previousValue: kpis.prevActiveAgents || 0, format: "number", icon: Users },
        { label: "Avg Premium", value: kpis.avgPolicyValue || 0, previousValue: kpis.prevAvgPolicyValue || 0, format: "currency", icon: TrendingUp },
        { label: "Revenue/Agent", value: kpis.revenuePerAgent || 0, previousValue: kpis.prevRevenuePerAgent || 0, format: "currency", icon: BarChart3 },
      ]);
      setChartData(chart.chartData || []);

      if (statusResult) {
        setStatusKpis({
          activeCount: Number(statusResult.active_count) || 0,
          terminatedCount: Number(statusResult.terminated_count) || 0,
          pendingCount: Number(statusResult.pending_count) || 0,
          atRiskCount: Number(statusResult.at_risk_count) || 0,
          totalCount: Number(statusResult.total_count) || 0,
        });
      }

      const agencies: AgencyData[] = breakdown.agencies || [];
      const rows: BreakdownRow[] = agencies.map((a: AgencyData) => ({
        id: a.agency,
        name: a.agency,
        policies: a.policies,
        revenue: a.revenue,
        avgPremium: a.avg_premium,
        previousRevenue: a.prev_revenue,
        sparklineData: [],
        agentCount: a.agent_count,
      }));
      setBreakdownRows(rows);

      const agencySlices: PieSlice[] = agencies
        .filter((a) => a.agent_count > 1 || /\b(inc|llc|group|agency|benefits|advisors|insurance|direct|solutions|services|medicare|fym|wisechoice)\b/i.test(a.agency))
        .map((a) => ({ name: a.agency, policies: a.policies, revenue: Number(a.revenue) }));
      setAgencyPieData(agencySlices);

      const planSlices: PieSlice[] = (planBreakdown.plans || []).map((p: { plan_name: string; policies: number; revenue: number }) => ({
        name: resolvePlanName(p.plan_name),
        policies: Number(p.policies),
        revenue: Number(p.revenue),
      }));
      setPlanPieData(planSlices);
    } catch {
      // handled
    }

    setLoading(false);
    setTableLoading(false);
    setPieLoading(false);
  }, [token, dateRange]);

  const fetchAgencyLevel = useCallback(async (agency: string) => {
    setLoading(true);
    setTableLoading(true);
    setPieLoading(true);
    const prev = getPreviousPeriod(dateRange);
    const referenceDate = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

    try {
      const [kpis, chart, breakdown, planBreakdown, statusResult] = await Promise.all([
        adminGetDashboardKpis(token, dateRange.startDate, dateRange.endDate, prev.startDate, prev.endDate, agency),
        adminGetSalesChart(token, dateRange.startDate, dateRange.endDate, agency),
        adminGetAgentBreakdown(token, dateRange.startDate, dateRange.endDate, prev.startDate, prev.endDate, agency),
        adminGetPlanBreakdown(token, dateRange.startDate, dateRange.endDate, agency),
        adminGetPolicyStatusKpis(token, referenceDate, agency).catch(() => null),
      ]);

      setKpiMetrics([
        { label: "Policies Sold", value: kpis.policiesSold || 0, previousValue: kpis.prevPoliciesSold || 0, format: "number", icon: FileText },
        { label: "Total Revenue", value: kpis.totalRevenue || 0, previousValue: kpis.prevTotalRevenue || 0, format: "currency", icon: DollarSign },
        { label: "Active Agents", value: kpis.activeAgents || 0, previousValue: kpis.prevActiveAgents || 0, format: "number", icon: Users },
        { label: "Avg Premium", value: kpis.avgPolicyValue || 0, previousValue: kpis.prevAvgPolicyValue || 0, format: "currency", icon: TrendingUp },
        { label: "Revenue/Agent", value: kpis.revenuePerAgent || 0, previousValue: kpis.prevRevenuePerAgent || 0, format: "currency", icon: BarChart3 },
      ]);
      setChartData(chart.chartData || []);

      if (statusResult) {
        setStatusKpis({
          activeCount: Number(statusResult.active_count) || 0,
          terminatedCount: Number(statusResult.terminated_count) || 0,
          pendingCount: Number(statusResult.pending_count) || 0,
          atRiskCount: Number(statusResult.at_risk_count) || 0,
          totalCount: Number(statusResult.total_count) || 0,
        });
      }

      const rows: BreakdownRow[] = (breakdown.agents || []).map((a: AgentData) => ({
        id: a.agent_number,
        name: `${a.agent_first_name} ${a.agent_last_name}`,
        subtitle: `#${a.agent_number}`,
        policies: a.policies,
        revenue: a.revenue,
        avgPremium: a.avg_premium,
        previousRevenue: a.prev_revenue,
        sparklineData: [],
      }));
      setBreakdownRows(rows);

      const planSlices: PieSlice[] = (planBreakdown.plans || []).map((p: { plan_name: string; policies: number; revenue: number }) => ({
        name: resolvePlanName(p.plan_name),
        policies: Number(p.policies),
        revenue: Number(p.revenue),
      }));
      setPlanPieData(planSlices);
    } catch {
      // handled
    }

    setLoading(false);
    setTableLoading(false);
    setPieLoading(false);
  }, [token, dateRange]);

  useEffect(() => {
    if (level === "org") fetchOrgLevel();
    else if (level === "agency") fetchAgencyLevel(selectedAgency);
  }, [level, selectedAgency, fetchOrgLevel, fetchAgencyLevel]);

  const handleAgencyClick = (row: BreakdownRow) => {
    setSelectedAgency(row.id);
    setLevel("agency");
  };

  const handleAgentClick = (row: BreakdownRow) => {
    setSelectedAgent({
      agent_first_name: row.name.split(" ")[0] || "",
      agent_last_name: row.name.split(" ").slice(1).join(" ") || "",
      agent_number: row.id,
      policies: row.policies,
      revenue: row.revenue,
      avg_premium: row.avgPremium,
      prev_revenue: row.previousRevenue,
    });
    setLevel("agent");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goToOrg = () => { if (!lockedAgency) { setLevel("org"); setSelectedAgency(""); setSelectedAgent(null); } };
  const goToAgency = () => { setLevel("agency"); setSelectedAgent(null); };

  const breadcrumbs: BreadcrumbSegment[] = [];
  if (!lockedAgency) {
    breadcrumbs.push({ label: "All Production", onClick: goToOrg });
  }
  if (level === "agency" || level === "agent") {
    breadcrumbs.push({ label: selectedAgency, onClick: level === "agent" ? goToAgency : undefined });
  }
  if (level === "agent" && selectedAgent) breadcrumbs.push({ label: `${selectedAgent.agent_first_name} ${selectedAgent.agent_last_name}` });

  const currentAgencyFilter = level === "org" ? undefined : selectedAgency;

  return (
    <div className="space-y-6 animate-fade-in">
      <BreadcrumbNav segments={breadcrumbs} />

      {level === "agent" && selectedAgent ? (
        <AgentProductionPanel
          token={token}
          agentName={`${selectedAgent.agent_first_name} ${selectedAgent.agent_last_name}`}
          agentNumber={selectedAgent.agent_number}
          agency={selectedAgency}
          dateRange={dateRange}
          onClose={goToAgency}
          onViewPolicies={onNavigatePolicies ? () => onNavigatePolicies(selectedAgent.agent_number) : undefined}
        />
      ) : (
        <>
          <div data-tour="admin-kpi-cards">
            <MetricSection
              icon={<CalendarRange size={14} className="text-gold" />}
              title="Production for Selected Dates"
              subtitle={formatRangeLabel(dateRange)}
            >
              <KpiRow metrics={kpiMetrics} loading={loading} />
            </MetricSection>
          </div>
          <MetricSection
            icon={<BookOpen size={14} className="text-sky-400" />}
            title="Book of Business"
            subtitle="entire current book, as of today — not affected by the date picker"
          >
            <PolicyStatusKpiRow data={statusKpis} loading={loading} />
          </MetricSection>

          {level === "org" ? (
            <QualityMetrics agencyId={null} />
          ) : (
            <QualityMetrics agencyName={selectedAgency} />
          )}

          <TrendChart
            data={chartData}
            loading={loading}
            title={level === "org" ? "All Production" : `${selectedAgency} Production`}
          />

          <ProductionForecastChart
            token={token}
            agencyFilter={currentAgencyFilter}
            title={level === "org" ? "Revenue Forecast (All)" : `${selectedAgency} Forecast`}
          />

          <div className={`grid gap-6 ${level === "org" ? "lg:grid-cols-2" : ""}`}>
            {level === "org" && (
              <ProductionPieChart
                data={agencyPieData}
                loading={pieLoading}
                title="Production by Agency"
              />
            )}
            <ProductionPieChart
              data={planPieData}
              loading={pieLoading}
              title="Production by Plan"
            />
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <MonthlyProductionChart
              token={token}
              agencyFilter={currentAgencyFilter}
              title={level === "org" ? "Monthly Production" : `${selectedAgency} Monthly`}
            />
            <WeeklyHeatmap
              token={token}
              agencyFilter={currentAgencyFilter}
              title={level === "org" ? "Day-of-Week Patterns" : `${selectedAgency} Day Patterns`}
            />
          </div>

          <BillingModeSection
            token={token}
            dateRange={dateRange}
            agencyFilter={currentAgencyFilter}
          />

          <div className="mt-2">
            <div className="flex items-center gap-2 mb-3">
              <Building2 size={16} className="text-gold" />
              <h3 className="text-sm font-semibold text-white">
                {level === "org" ? "Agencies" : "Agents"}
              </h3>
            </div>
            <BreakdownTable
              rows={breakdownRows}
              loading={tableLoading}
              onRowClick={level === "org" ? handleAgencyClick : handleAgentClick}
              showAgentCount={level === "org"}
              emptyMessage={level === "org" ? "No agency data available" : "No agents found for this agency"}
            />
          </div>
        </>
      )}
    </div>
  );
}
