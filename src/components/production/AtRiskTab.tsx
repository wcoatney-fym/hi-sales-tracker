import { useState, useEffect, useCallback } from "react";
import {
  AlertTriangle,
  ShieldAlert,
  Users,
  DollarSign,
  Clock,
  ChevronDown,
  ChevronRight,
  MessageSquarePlus,
  Loader2,
  X,
  Activity,
  Building2,
} from "lucide-react";
import {
  adminGetAtRiskAgentsSummary,
  adminGetAtRiskPoliciesForAgent,
  adminGetAtRiskAging,
  adminGetAtRiskTrend,
  adminLogAtRiskActivity,
  adminGetAgencies,
} from "../../lib/api";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface AtRiskAgent {
  agent_number: string;
  agent_first_name: string;
  agent_last_name: string;
  agency: string | null;
  active_count: number;
  at_risk_count: number;
  at_risk_percentage: number;
  total_premium_at_risk: number;
  worst_days_lapsed: number;
  last_activity_date: string | null;
}

interface AtRiskPolicy {
  policy_id: string;
  policy_number: string | null;
  client_first_name: string;
  client_last_name: string;
  plan_name: string;
  carrier: string;
  plan_premium: number;
  policy_effective_date: string;
  paid_to_date: string;
  days_lapsed: number;
  activities: ActivityEntry[] | null;
}

interface ActivityEntry {
  id: string;
  action_type: string;
  note: string;
  admin_user: string | null;
  agent_id: string | null;
  created_at: string;
}

interface AgingData {
  bucket_1_15: number;
  bucket_16_30: number;
  bucket_31_60: number;
  bucket_61_plus: number;
}

interface TrendPoint {
  week_date: string;
  at_risk_count: number;
}

const AMBER_THRESHOLD = 15;
const RED_THRESHOLD = 20;

const ACTION_LABELS: Record<string, string> = {
  called_client: "Called Client",
  called_carrier: "Called Carrier",
  payment_confirmed: "Payment Confirmed",
  lapse_notice_sent: "Lapse Notice Sent",
  other: "Other",
};

const INTERNAL_AGENCIES = ["FYM", "Wisechoice Senior Advisors Llc"];

type Subtab = "internal" | "all";

interface AtRiskTabProps {
  token: string;
  agencyFilter?: string;
  agencies?: string[];
  lockedAgency?: string;
}

export default function AtRiskTab({ token, agencyFilter, agencies, lockedAgency }: AtRiskTabProps) {
  const [subtab, setSubtab] = useState<Subtab>(lockedAgency ? "all" : "internal");
  const [selectedAgency, setSelectedAgency] = useState<string>(lockedAgency || "");
  const [allAgencies, setAllAgencies] = useState<string[]>([]);
  const [agents, setAgents] = useState<AtRiskAgent[]>([]);
  const [aging, setAging] = useState<AgingData | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [agentPolicies, setAgentPolicies] = useState<AtRiskPolicy[]>([]);
  const [policiesLoading, setPoliciesLoading] = useState(false);
  const [activityModal, setActivityModal] = useState<{ policyId: string; clientName: string } | null>(null);

  useEffect(() => {
    adminGetAgencies(token).then((result) => {
      if (Array.isArray(result)) setAllAgencies(result);
    }).catch(() => {});
  }, [token]);

  const effectiveAgencyFilter = lockedAgency
    ? lockedAgency
    : subtab === "internal" ? undefined : (selectedAgency || agencyFilter || undefined);
  const effectiveAgencies = lockedAgency
    ? undefined
    : subtab === "internal" ? INTERNAL_AGENCIES : (agencies || undefined);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [agentsResult, agingResult, trendResult] = await Promise.all([
        adminGetAtRiskAgentsSummary(token, effectiveAgencyFilter, effectiveAgencies),
        adminGetAtRiskAging(token, effectiveAgencyFilter, effectiveAgencies),
        adminGetAtRiskTrend(token, effectiveAgencyFilter, effectiveAgencies),
      ]);
      setAgents(Array.isArray(agentsResult) ? agentsResult : []);
      setAging(agingResult || null);
      setTrend(Array.isArray(trendResult) ? trendResult : []);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [token, effectiveAgencyFilter, effectiveAgencies]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleExpandAgent = async (agentNumber: string) => {
    if (expandedAgent === agentNumber) {
      setExpandedAgent(null);
      setAgentPolicies([]);
      return;
    }
    setExpandedAgent(agentNumber);
    setPoliciesLoading(true);
    try {
      const result = await adminGetAtRiskPoliciesForAgent(token, agentNumber);
      setAgentPolicies(Array.isArray(result) ? result : []);
    } catch {
      setAgentPolicies([]);
    } finally {
      setPoliciesLoading(false);
    }
  };

  const totalAtRisk = agents.reduce((sum, a) => sum + a.at_risk_count, 0);
  const totalPremiumAtRisk = agents.reduce((sum, a) => sum + a.total_premium_at_risk, 0);
  const flaggedAgents = agents.filter((a) => a.at_risk_percentage >= AMBER_THRESHOLD);
  const avgDaysLapsed = agents.length > 0
    ? Math.round(agents.reduce((sum, a) => sum + a.worst_days_lapsed, 0) / agents.length)
    : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-amber-400 animate-spin" />
      </div>
    );
  }

  const agingChartData = aging
    ? [
        { bucket: "1-15 days", count: aging.bucket_1_15, fill: "#fbbf24" },
        { bucket: "16-30 days", count: aging.bucket_16_30, fill: "#f59e0b" },
        { bucket: "31-60 days", count: aging.bucket_31_60, fill: "#ef4444" },
        { bucket: "60+ days", count: aging.bucket_61_plus, fill: "#991b1b" },
      ]
    : [];

  const trendChartData = trend.map((t) => ({
    date: new Date(t.week_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    count: t.at_risk_count,
  }));

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Subtab Navigation */}
      {!lockedAgency && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex gap-1 bg-navy p-1 rounded-lg border border-slate-700/50">
            <button
              onClick={() => { setSubtab("internal"); setSelectedAgency(""); }}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                subtab === "internal"
                  ? "bg-navy-light text-amber-400 shadow-sm border border-amber-500/20"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Building2 size={14} />
              Internal
            </button>
            <button
              onClick={() => setSubtab("all")}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                subtab === "all"
                  ? "bg-navy-light text-amber-400 shadow-sm border border-amber-500/20"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Users size={14} />
              All Agents
            </button>
          </div>

          {subtab === "all" && allAgencies.length > 0 && (
            <select
              value={selectedAgency}
              onChange={(e) => setSelectedAgency(e.target.value)}
              className="bg-navy border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500 max-w-xs"
            >
              <option value="">All Agencies</option>
              {allAgencies.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={AlertTriangle}
          iconColor="text-amber-400"
          iconBg="bg-amber-500/10"
          label="At-Risk Policies"
          value={totalAtRisk.toLocaleString()}
        />
        <KpiCard
          icon={DollarSign}
          iconColor="text-rose-400"
          iconBg="bg-rose-500/10"
          label="Premium at Risk"
          value={`$${totalPremiumAtRisk.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
        />
        <KpiCard
          icon={Users}
          iconColor="text-amber-400"
          iconBg="bg-amber-500/10"
          label="Flagged Agents"
          value={flaggedAgents.length.toString()}
          subtitle={`of ${agents.length} total`}
        />
        <KpiCard
          icon={Clock}
          iconColor="text-sky-400"
          iconBg="bg-sky-500/10"
          label="Avg Worst Gap"
          value={`${avgDaysLapsed}d`}
          subtitle="days past due"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Aging Distribution */}
        <div className="bg-navy rounded-xl border border-slate-700/50 p-5">
          <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
            <Clock size={16} className="text-amber-400" />
            Aging Distribution
          </h3>
          {agingChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={agingChartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="bucket" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 12 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #475569", borderRadius: 8 }}
                  labelStyle={{ color: "#e2e8f0" }}
                  itemStyle={{ color: "#fbbf24" }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {agingChartData.map((entry, index) => (
                    <rect key={index} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-slate-500">No data</div>
          )}
        </div>

        {/* Trend Chart */}
        <div className="bg-navy rounded-xl border border-slate-700/50 p-5">
          <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
            <Activity size={16} className="text-sky-400" />
            90-Day At-Risk Trend
          </h3>
          {trendChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trendChartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 12 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #475569", borderRadius: 8 }}
                  labelStyle={{ color: "#e2e8f0" }}
                  itemStyle={{ color: "#f59e0b" }}
                />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: "#f59e0b" }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-slate-500">No data</div>
          )}
        </div>
      </div>

      {/* Flagged Agents Table */}
      <div className="bg-navy rounded-xl border border-slate-700/50 overflow-hidden">
        <div className="p-5 border-b border-slate-700/50 flex items-center gap-3">
          <ShieldAlert size={18} className="text-amber-400" />
          <h3 className="font-semibold text-white">Agent Risk Scorecard</h3>
          <span className="ml-auto text-xs text-slate-400">
            Amber: {AMBER_THRESHOLD}%+ | Red: {RED_THRESHOLD}%+
          </span>
        </div>

        {agents.length === 0 ? (
          <div className="p-10 text-center text-slate-400">
            No agents with at-risk policies found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 border-b border-slate-700/50">
                  <th className="px-4 py-3 font-medium w-8"></th>
                  <th className="px-4 py-3 font-medium">Agent</th>
                  <th className="px-4 py-3 font-medium">Agency</th>
                  <th className="px-4 py-3 font-medium text-right">Active</th>
                  <th className="px-4 py-3 font-medium text-right">At Risk</th>
                  <th className="px-4 py-3 font-medium text-right">Risk %</th>
                  <th className="px-4 py-3 font-medium text-right">Premium at Risk</th>
                  <th className="px-4 py-3 font-medium text-right">Worst Gap</th>
                  <th className="px-4 py-3 font-medium text-right">Last Activity</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => {
                  const isExpanded = expandedAgent === agent.agent_number;
                  const severity =
                    agent.at_risk_percentage >= RED_THRESHOLD
                      ? "red"
                      : agent.at_risk_percentage >= AMBER_THRESHOLD
                        ? "amber"
                        : "none";

                  return (
                    <AgentRow
                      key={agent.agent_number}
                      agent={agent}
                      severity={severity}
                      isExpanded={isExpanded}
                      onToggle={() => handleExpandAgent(agent.agent_number)}
                      policies={isExpanded ? agentPolicies : []}
                      policiesLoading={isExpanded && policiesLoading}
                      onLogActivity={(policyId, clientName) => setActivityModal({ policyId, clientName })}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Activity Log Modal */}
      {activityModal && (
        <ActivityLogModal
          policyId={activityModal.policyId}
          clientName={activityModal.clientName}
          token={token}
          onClose={() => setActivityModal(null)}
          onSaved={() => {
            setActivityModal(null);
            if (expandedAgent) handleExpandAgent(expandedAgent);
          }}
        />
      )}
    </div>
  );
}

function KpiCard({
  icon: Icon,
  iconColor,
  iconBg,
  label,
  value,
  subtitle,
}: {
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  label: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <div className="bg-navy rounded-xl border border-slate-700/50 p-5 hover:border-slate-600/70 transition-all group">
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-10 h-10 rounded-lg ${iconBg} flex items-center justify-center`}>
          <Icon size={18} className={iconColor} />
        </div>
      </div>
      <p className="text-2xl font-bold text-white tracking-tight">{value}</p>
      <div className="flex items-center justify-between mt-1">
        <span className="text-xs text-slate-400 font-medium">{label}</span>
        {subtitle && <span className="text-xs text-slate-500">{subtitle}</span>}
      </div>
    </div>
  );
}

function AgentRow({
  agent,
  severity,
  isExpanded,
  onToggle,
  policies,
  policiesLoading,
  onLogActivity,
}: {
  agent: AtRiskAgent;
  severity: "red" | "amber" | "none";
  isExpanded: boolean;
  onToggle: () => void;
  policies: AtRiskPolicy[];
  policiesLoading: boolean;
  onLogActivity: (policyId: string, clientName: string) => void;
}) {
  const rowBg =
    severity === "red"
      ? "bg-rose-950/20 hover:bg-rose-950/30"
      : severity === "amber"
        ? "bg-amber-950/15 hover:bg-amber-950/25"
        : "hover:bg-slate-800/30";

  const percentColor =
    severity === "red"
      ? "text-rose-400 font-bold"
      : severity === "amber"
        ? "text-amber-400 font-semibold"
        : "text-slate-300";

  return (
    <>
      <tr
        className={`border-b border-slate-700/30 cursor-pointer transition-colors ${rowBg}`}
        onClick={onToggle}
      >
        <td className="px-4 py-3">
          {isExpanded ? (
            <ChevronDown size={14} className="text-slate-400" />
          ) : (
            <ChevronRight size={14} className="text-slate-400" />
          )}
        </td>
        <td className="px-4 py-3 text-white font-medium">
          {agent.agent_first_name} {agent.agent_last_name}
          <span className="text-slate-500 text-xs ml-2">#{agent.agent_number}</span>
        </td>
        <td className="px-4 py-3 text-slate-300">{agent.agency || "—"}</td>
        <td className="px-4 py-3 text-right text-slate-300">{agent.active_count}</td>
        <td className="px-4 py-3 text-right text-slate-300">{agent.at_risk_count}</td>
        <td className={`px-4 py-3 text-right ${percentColor}`}>
          {agent.at_risk_percentage}%
        </td>
        <td className="px-4 py-3 text-right text-slate-300">
          ${agent.total_premium_at_risk.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
        </td>
        <td className="px-4 py-3 text-right text-slate-300">
          {agent.worst_days_lapsed}d
        </td>
        <td className="px-4 py-3 text-right text-slate-400 text-xs">
          {agent.last_activity_date
            ? new Date(agent.last_activity_date).toLocaleDateString()
            : "Never"}
        </td>
      </tr>

      {isExpanded && (
        <tr>
          <td colSpan={9} className="bg-slate-900/50 px-6 py-4">
            {policiesLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 size={16} className="text-amber-400 animate-spin" />
              </div>
            ) : policies.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-4">No at-risk policies found.</p>
            ) : (
              <div className="space-y-2">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-700/50">
                      <th className="pb-2 font-medium">Policy #</th>
                      <th className="pb-2 font-medium">Client</th>
                      <th className="pb-2 font-medium">Plan</th>
                      <th className="pb-2 font-medium">Carrier</th>
                      <th className="pb-2 font-medium text-right">Premium</th>
                      <th className="pb-2 font-medium text-right">Paid To</th>
                      <th className="pb-2 font-medium text-right">Days Lapsed</th>
                      <th className="pb-2 font-medium text-right">Last Activity</th>
                      <th className="pb-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {policies.map((policy) => {
                      const lastAct = policy.activities?.[0];
                      const daysColor =
                        policy.days_lapsed > 60
                          ? "text-rose-400"
                          : policy.days_lapsed > 30
                            ? "text-amber-400"
                            : "text-yellow-300";

                      return (
                        <tr key={policy.policy_id} className="border-b border-slate-800/50">
                          <td className="py-2 text-slate-300">{policy.policy_number || "—"}</td>
                          <td className="py-2 text-white">
                            {policy.client_first_name} {policy.client_last_name}
                          </td>
                          <td className="py-2 text-slate-300">{policy.plan_name}</td>
                          <td className="py-2 text-slate-300">{policy.carrier}</td>
                          <td className="py-2 text-right text-slate-300">
                            ${policy.plan_premium?.toFixed(2)}
                          </td>
                          <td className="py-2 text-right text-slate-400">
                            {new Date(policy.paid_to_date).toLocaleDateString()}
                          </td>
                          <td className={`py-2 text-right font-semibold ${daysColor}`}>
                            {policy.days_lapsed}d
                          </td>
                          <td className="py-2 text-right text-slate-500">
                            {lastAct ? (
                              <span title={lastAct.note}>
                                {ACTION_LABELS[lastAct.action_type] || lastAct.action_type}{" "}
                                <span className="text-slate-600">
                                  {new Date(lastAct.created_at).toLocaleDateString()}
                                </span>
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="py-2 text-right">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onLogActivity(
                                  policy.policy_id,
                                  `${policy.client_first_name} ${policy.client_last_name}`
                                );
                              }}
                              className="p-1.5 rounded-md hover:bg-amber-500/10 text-amber-400 hover:text-amber-300 transition-colors"
                              title="Log Activity"
                            >
                              <MessageSquarePlus size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function ActivityLogModal({
  policyId,
  clientName,
  token,
  onClose,
  onSaved,
}: {
  policyId: string;
  clientName: string;
  token: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [actionType, setActionType] = useState("called_client");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await adminLogAtRiskActivity(token, policyId, actionType, note);
      onSaved();
    } catch {
      // stay open on error
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-navy-light border border-slate-700 rounded-xl p-6 w-full max-w-md shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold">Log Activity</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <p className="text-sm text-slate-400 mb-4">
          Policy for <span className="text-white font-medium">{clientName}</span>
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 font-medium">Action Type</label>
            <select
              value={actionType}
              onChange={(e) => setActionType(e.target.value)}
              className="w-full bg-navy border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
            >
              {Object.entries(ACTION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5 font-medium">Note</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add details about the follow-up..."
              rows={3}
              className="w-full bg-navy border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500 resize-none"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-slate-600 rounded-lg text-slate-300 text-sm hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
