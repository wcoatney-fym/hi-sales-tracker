import { useState, useEffect, useCallback, useRef } from "react";
import {
  Download,
  ChevronLeft,
  ChevronRight,
  Loader2,
  FileSpreadsheet,
  Filter,
  Trash2,
  AlertTriangle,
  X,
  Calendar,
  ChevronDown,
  SlidersHorizontal,
  Trophy,
} from "lucide-react";
import { adminGetPolicies, adminDeletePolicies, adminExportAllPolicies, adminExportLeaderboard } from "../../lib/api";
import { getDateRange } from "../../lib/dateUtils";
import { resolvePlanName } from "../../lib/planCodes";
import type { PolicyRow, DatePreset } from "../../types/dashboard";

interface PoliciesTableProps {
  token: string;
  lockedAgency?: string;
}

const POLICY_DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: "allTime", label: "All Time" },
  { key: "thisMonth", label: "This Month" },
  { key: "lastMonth", label: "Last Month" },
  { key: "thisQuarter", label: "This Quarter" },
  { key: "past6Months", label: "Past 6 Months" },
  { key: "pastYear", label: "Past Year" },
];

interface AgentOption {
  id: string;
  label: string;
}

interface CarrierOption {
  name: string;
}

interface ProductTypeOption {
  name: string;
}

interface AgencyOption {
  name: string;
}

const PRODUCT_TYPE_STYLES: Record<string, string> = {
  HI: "bg-sky-900/30 text-sky-300 border border-sky-700/50",
  HHC: "bg-emerald-900/30 text-emerald-300 border border-emerald-700/50",
  LIFE: "bg-amber-900/30 text-amber-300 border border-amber-700/50",
  DENTAL: "bg-teal-900/30 text-teal-300 border border-teal-700/50",
  CANCER: "bg-rose-900/30 text-rose-300 border border-rose-700/50",
};

const PAGE_SIZES = [10, 20, 50, 100];

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    submitted: "bg-amber-900/30 text-amber-300 border border-amber-700/50",
    pending: "bg-amber-900/30 text-amber-300 border border-amber-700/50",
    approved: "bg-emerald-900/30 text-emerald-300 border border-emerald-700/50",
    active: "bg-emerald-900/30 text-emerald-300 border border-emerald-700/50",
    cancelled: "bg-rose-900/30 text-rose-300 border border-rose-700/50",
    terminated: "bg-rose-900/30 text-rose-300 border border-rose-700/50",
    suspended: "bg-orange-900/30 text-orange-300 border border-orange-700/50",
  };
  const label = status.toLowerCase() === "pending" ? "Submitted" : status;
  return (
    <span
      className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${
        styles[status.toLowerCase()] || "bg-slate-700/30 text-slate-300 border border-slate-600"
      }`}
    >
      {label}
    </span>
  );
}

export default function PoliciesTable({ token, lockedAgency }: PoliciesTableProps) {
  const [datePreset, setDatePreset] = useState<DatePreset>("allTime");
  const [dateRange, setDateRange] = useState(getDateRange("allTime"));
  const [dateOpen, setDateOpen] = useState(false);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const dateRef = useRef<HTMLDivElement>(null);

  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [carriers, setCarriers] = useState<CarrierOption[]>([]);
  const [productTypes, setProductTypes] = useState<ProductTypeOption[]>([]);
  const [agencies, setAgencies] = useState<AgencyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [agentFilter, setAgentFilter] = useState("");
  const [carrierFilter, setCarrierFilter] = useState("");
  const [productTypeFilter, setProductTypeFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [agencyFilter, setAgencyFilter] = useState(lockedAgency || "");

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dateRef.current && !dateRef.current.contains(e.target as Node)) setDateOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportingAll, setExportingAll] = useState(false);
  const [exportingLeaderboard, setExportingLeaderboard] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  const toggleCardExpand = (id: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const fetchPolicies = useCallback(async () => {
    setLoading(true);
    try {
      const result = await adminGetPolicies(
        token,
        dateRange.startDate,
        dateRange.endDate,
        page,
        pageSize,
        agentFilter || undefined,
        carrierFilter || undefined,
        productTypeFilter || undefined,
        agencyFilter || undefined,
        sourceFilter || undefined
      );
      setPolicies(result.policies || []);
      setTotalCount(result.totalCount || 0);
      setAgents(result.agents || []);
      setCarriers(result.carriers || []);
      setProductTypes(result.productTypes || []);
      setAgencies(result.agencies || []);
    } catch {
      setPolicies([]);
      setTotalCount(0);
    }
    setLoading(false);
  }, [token, dateRange.startDate, dateRange.endDate, page, pageSize, agentFilter, carrierFilter, productTypeFilter, agencyFilter, sourceFilter]);

  useEffect(() => {
    fetchPolicies();
  }, [fetchPolicies]);

  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [dateRange.startDate, dateRange.endDate, agentFilter, carrierFilter, productTypeFilter, agencyFilter, sourceFilter, pageSize]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === policies.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(policies.map((p) => p.id)));
    }
  };

  const exportCsv = () => {
    const rows = selected.size > 0
      ? policies.filter((p) => selected.has(p.id))
      : policies;

    const headers = [
      "Writing Number",
      "Agent First Name",
      "Agent Last Name",
      "Carrier",
      "Agency",
      "Product Type",
      "Client First Name",
      "Client Last Name",
      "Policy Number",
      "Phone",
      "Email",
      "Address",
      "City",
      "State",
      "ZIP",
      "Plan Name",
      "Effective Date",
      "Monthly Premium",
      "Status",
      "Upload Date",
      "App Submit Date",
    ];
    const csvRows = rows.map((p) => [
      p.agent_number,
      p.agent_first_name,
      p.agent_last_name,
      p.carrier,
      p.agency || "",
      p.product_type,
      p.client_first_name,
      p.client_last_name,
      p.policy_number || "",
      p.phone,
      p.email,
      p.address,
      p.city,
      p.state,
      p.zip,
      resolvePlanName(p.plan_name),
      p.policy_effective_date ? new Date(p.policy_effective_date).toLocaleDateString() : "",
      p.plan_premium,
      p.status,
      new Date(p.created_at).toLocaleDateString(),
      p.app_submit_date ? new Date(p.app_submit_date + "T00:00:00").toLocaleDateString() : "",
    ]);

    const csvContent = [
      headers.join(","),
      ...csvRows.map((r) =>
        r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `policies-export-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportAllCsv = async () => {
    setExportingAll(true);
    try {
      const result = await adminExportAllPolicies(
        token,
        dateRange.startDate,
        dateRange.endDate,
        agentFilter || undefined,
        carrierFilter || undefined,
        productTypeFilter || undefined,
        agencyFilter || undefined
      );
      const allRows: PolicyRow[] = result.policies || [];
      if (allRows.length === 0) return;

      const headers = [
        "Writing Number",
        "Agent First Name",
        "Agent Last Name",
        "Carrier",
        "Agency",
        "Product Type",
        "Client First Name",
        "Client Last Name",
        "Policy Number",
        "Phone",
        "Email",
        "Address",
        "City",
        "State",
        "ZIP",
        "Plan Name",
        "Effective Date",
        "Monthly Premium",
        "Status",
        "Upload Date",
        "App Submit Date",
      ];
      const csvRows = allRows.map((p) => [
        p.agent_number,
        p.agent_first_name,
        p.agent_last_name,
        p.carrier,
        p.agency || "",
        p.product_type,
        p.client_first_name,
        p.client_last_name,
        p.policy_number || "",
        p.phone,
        p.email,
        p.address,
        p.city,
        p.state,
        p.zip,
        resolvePlanName(p.plan_name),
        p.policy_effective_date ? new Date(p.policy_effective_date).toLocaleDateString() : "",
        p.plan_premium,
        p.status,
        new Date(p.created_at).toLocaleDateString(),
        p.app_submit_date ? new Date(p.app_submit_date + "T00:00:00").toLocaleDateString() : "",
      ]);

      const csvContent = [
        headers.join(","),
        ...csvRows.map((r) =>
          r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")
        ),
      ].join("\n");

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `policies-export-all-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      // silent fail
    } finally {
      setExportingAll(false);
    }
  };

  const exportLeaderboardCsv = async () => {
    setExportingLeaderboard(true);
    try {
      const result = await adminExportLeaderboard(
        token,
        dateRange.startDate,
        dateRange.endDate,
        agencyFilter || undefined
      );
      const leaderboard: { firstName: string; lastName: string; agentNumber: string; npn: string; agency: string; count: number; totalAnnualizedPremium: number }[] = result.leaderboard || [];
      if (leaderboard.length === 0) return;

      const headers = ["Rank", "Agent Name", "Writing Number", "NPN", "Agency", "Policies Sold", "Total Annualized Premium"];
      const csvRows = leaderboard.map((a, i) => [
        i + 1,
        `${a.firstName} ${a.lastName}`.trim(),
        a.agentNumber,
        a.npn,
        a.agency,
        a.count,
        a.totalAnnualizedPremium.toFixed(2),
      ]);

      const csvContent = [
        headers.join(","),
        ...csvRows.map((r) =>
          r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")
        ),
      ].join("\n");

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `leaderboard-export-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      // silent fail
    } finally {
      setExportingLeaderboard(false);
    }
  };

  const selectedPolicies = policies.filter((p) => selected.has(p.id));

  const handleDelete = async () => {
    if (selectedPolicies.length === 0) return;
    setDeleting(true);
    try {
      await adminDeletePolicies(token, Array.from(selected));
      setSelected(new Set());
      setShowDeleteConfirm(false);
      await fetchPolicies();
    } catch {
      /* handled by API layer */
    }
    setDeleting(false);
  };

  return (
    <div className="bg-navy rounded-xl border border-slate-700/50">
      <div className="p-4 border-b border-slate-700/50">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <FileSpreadsheet size={20} className="text-gold" />
            <h3 className="text-base font-semibold text-white">Policies</h3>
            <span className="text-sm text-slate-400">{totalCount.toLocaleString()} total</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setFiltersOpen(!filtersOpen)}
              className="md:hidden flex items-center gap-1.5 px-3 py-2 text-sm border border-slate-600 rounded-lg bg-navy-light text-slate-200 hover:bg-navy-mid transition-colors min-h-[44px]"
            >
              <SlidersHorizontal size={14} />
              Filters
              {(agentFilter || carrierFilter || productTypeFilter || agencyFilter || sourceFilter) && (
                <span className="w-2 h-2 rounded-full bg-gold" />
              )}
            </button>
            <button
              onClick={exportCsv}
              disabled={policies.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-slate-600 rounded-lg text-slate-300 hover:bg-navy-light hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors min-h-[44px]"
            >
              <Download size={14} />
              <span className="hidden sm:inline">Export Page</span>
              {selected.size > 0 && (
                <span className="ml-1 text-xs text-gold">({selected.size})</span>
              )}
            </button>
            <button
              onClick={exportAllCsv}
              disabled={totalCount === 0 || exportingAll}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-slate-600 rounded-lg text-slate-300 hover:bg-navy-light hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors min-h-[44px]"
            >
              {exportingAll ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
              <span className="hidden sm:inline">Export All</span>
              <span className="ml-1 text-xs text-slate-400">({totalCount.toLocaleString()})</span>
            </button>
            <button
              onClick={exportLeaderboardCsv}
              disabled={totalCount === 0 || exportingLeaderboard}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-gold/40 rounded-lg text-gold hover:bg-gold/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors min-h-[44px]"
            >
              {exportingLeaderboard ? <Loader2 size={14} className="animate-spin" /> : <Trophy size={14} />}
              <span className="hidden sm:inline">Export Leaderboard</span>
            </button>
            {selected.size > 0 && (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-rose-700/50 rounded-lg text-rose-400 bg-rose-900/20 hover:bg-rose-900/40 transition-colors min-h-[44px]"
              >
                <Trash2 size={14} />
                <span className="hidden sm:inline">Delete</span>
                <span className="text-xs">({selected.size})</span>
              </button>
            )}
          </div>
        </div>

        <div className={`${filtersOpen ? "flex" : "hidden"} md:flex flex-wrap items-center gap-2 mt-3`}>
          <div ref={dateRef} className="relative">
            <button
              onClick={() => setDateOpen(!dateOpen)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm border border-slate-600 rounded-lg bg-navy-light text-slate-200 hover:bg-navy-mid transition-colors min-h-[44px]"
            >
              <Calendar size={14} className="text-gold" />
              <span className="font-medium">{dateRange.label}</span>
              <ChevronDown size={12} className="text-slate-400" />
            </button>
            {dateOpen && (
              <div className="absolute left-0 sm:left-0 right-0 sm:right-auto top-full mt-1 w-full sm:w-56 bg-navy-light rounded-lg border border-slate-700/50 shadow-lg z-50 overflow-hidden">
                <div className="py-1">
                  {POLICY_DATE_PRESETS.map((p) => (
                    <button
                      key={p.key}
                      onClick={() => {
                        setDatePreset(p.key);
                        setDateRange(getDateRange(p.key));
                        setDateOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors min-h-[44px] ${
                        datePreset === p.key && datePreset !== "custom"
                          ? "bg-gold/10 text-gold font-medium"
                          : "text-slate-300 hover:bg-navy-mid"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="border-t border-slate-700/50 p-3">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Custom</p>
                  <div className="space-y-1.5">
                    <input
                      type="date"
                      value={customStart}
                      onChange={(e) => setCustomStart(e.target.value)}
                      className="w-full px-2.5 py-2.5 text-sm border border-slate-600 rounded-lg bg-navy text-white focus:outline-none focus:ring-1 focus:ring-gold min-h-[44px]"
                    />
                    <input
                      type="date"
                      value={customEnd}
                      onChange={(e) => setCustomEnd(e.target.value)}
                      className="w-full px-2.5 py-2.5 text-sm border border-slate-600 rounded-lg bg-navy text-white focus:outline-none focus:ring-1 focus:ring-gold min-h-[44px]"
                    />
                    <button
                      onClick={() => {
                        if (!customStart || !customEnd) return;
                        const start = new Date(customStart);
                        const end = new Date(customEnd);
                        end.setDate(end.getDate() + 1);
                        setDatePreset("custom");
                        setDateRange({
                          startDate: start.toISOString(),
                          endDate: end.toISOString(),
                          label: `${customStart} \u2013 ${customEnd}`,
                        });
                        setDateOpen(false);
                      }}
                      disabled={!customStart || !customEnd}
                      className="w-full px-2.5 py-2.5 text-sm font-medium text-navy-dark bg-gold rounded-lg hover:bg-gold-light disabled:opacity-40 disabled:cursor-not-allowed transition-colors min-h-[44px]"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="relative flex-1 min-w-[140px] sm:flex-none">
            <Filter size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <select
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              className="w-full sm:w-auto pl-8 pr-8 py-2 text-sm border border-slate-600 rounded-lg bg-navy-light text-slate-200 focus:outline-none focus:ring-1 focus:ring-gold appearance-none cursor-pointer min-h-[44px]"
            >
              <option value="">All Agents</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </div>

          <div className="relative flex-1 min-w-[140px] sm:flex-none">
            <Filter size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <select
              value={carrierFilter}
              onChange={(e) => setCarrierFilter(e.target.value)}
              className="w-full sm:w-auto pl-8 pr-8 py-2 text-sm border border-slate-600 rounded-lg bg-navy-light text-slate-200 focus:outline-none focus:ring-1 focus:ring-gold appearance-none cursor-pointer min-h-[44px]"
            >
              <option value="">All Carriers</option>
              {carriers.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="relative flex-1 min-w-[140px] sm:flex-none">
            <Filter size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <select
              value={productTypeFilter}
              onChange={(e) => setProductTypeFilter(e.target.value)}
              className="w-full sm:w-auto pl-8 pr-8 py-2 text-sm border border-slate-600 rounded-lg bg-navy-light text-slate-200 focus:outline-none focus:ring-1 focus:ring-gold appearance-none cursor-pointer min-h-[44px]"
            >
              <option value="">All Types</option>
              {productTypes.map((pt) => (
                <option key={pt.name} value={pt.name}>{pt.name === "HI" ? "HI - Hospital Indemnity" : pt.name === "HHC" ? "HHC - Home Health Care" : pt.name === "LIFE" ? "Life Insurance" : pt.name === "DENTAL" ? "Dental" : pt.name === "CANCER" ? "Cancer/Stroke" : pt.name}</option>
              ))}
            </select>
          </div>

          {!lockedAgency && (
            <div className="relative flex-1 min-w-[140px] sm:flex-none">
              <Filter size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <select
                value={agencyFilter}
                onChange={(e) => setAgencyFilter(e.target.value)}
                className="w-full sm:w-auto pl-8 pr-8 py-2 text-sm border border-slate-600 rounded-lg bg-navy-light text-slate-200 focus:outline-none focus:ring-1 focus:ring-gold appearance-none cursor-pointer min-h-[44px]"
              >
                <option value="">All Agencies</option>
                {agencies.map((ag) => (
                  <option key={ag.name} value={ag.name}>{ag.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="relative flex-1 min-w-[140px] sm:flex-none">
            <Filter size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="w-full sm:w-auto pl-8 pr-8 py-2 text-sm border border-slate-600 rounded-lg bg-navy-light text-slate-200 focus:outline-none focus:ring-1 focus:ring-gold appearance-none cursor-pointer min-h-[44px]"
            >
              <option value="">All Sources</option>
              <option value="Intake Form">Intake Form</option>
              <option value="Data Source">Data Source</option>
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="h-64 flex items-center justify-center">
          <Loader2 className="animate-spin text-slate-500" size={32} />
        </div>
      ) : policies.length === 0 ? (
        <div className="h-64 flex flex-col items-center justify-center text-slate-500">
          <FileSpreadsheet size={40} className="mb-3 opacity-40" />
          <p className="text-sm">No policies found for the selected filters</p>
        </div>
      ) : (
        <>
          {/* Mobile Card View */}
          <div className="md:hidden divide-y divide-slate-700/30">
            {policies.map((p) => (
              <div
                key={p.id}
                className={`p-4 transition-colors ${selected.has(p.id) ? "bg-gold/5" : ""}`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => toggleSelect(p.id)}
                    className="rounded border-slate-600 text-gold focus:ring-gold bg-navy-light mt-1 w-4 h-4"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-white font-medium truncate">
                        {p.client_first_name} {p.client_last_name}
                      </p>
                      <span className="text-gold font-semibold text-sm whitespace-nowrap">
                        ${Number(p.plan_premium).toFixed(2)}/mo
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <StatusBadge status={p.status} />
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${PRODUCT_TYPE_STYLES[p.product_type] || "bg-slate-700/30 text-slate-300 border border-slate-600"}`}>
                        {p.product_type}
                      </span>
                      <span className="text-xs text-slate-400">{p.carrier}</span>
                      <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${
                        p.source === "Data Source"
                          ? "bg-cyan-900/30 text-cyan-300 border border-cyan-700/50"
                          : "bg-amber-900/30 text-amber-300 border border-amber-700/50"
                      }`}>
                        {p.source === "Data Source" ? "DS" : "IF"}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-400">
                      <span>Agent: {p.agent_first_name} {p.agent_last_name}</span>
                      <span>{p.policy_effective_date ? new Date(p.policy_effective_date).toLocaleDateString() : ""}</span>
                    </div>

                    {expandedCards.has(p.id) && (
                      <div className="mt-3 pt-3 border-t border-slate-700/30 grid grid-cols-2 gap-2 text-xs animate-fade-in">
                        <div><span className="text-slate-500">Writing #</span><p className="text-white">{p.agent_number}</p></div>
                        <div><span className="text-slate-500">Agency</span><p className="text-slate-300">{p.agency || "\u2014"}</p></div>
                        <div><span className="text-slate-500">Phone</span><p className="text-slate-300">{p.phone}</p></div>
                        <div><span className="text-slate-500">Email</span><p className="text-slate-300 truncate">{p.email}</p></div>
                        <div className="col-span-2"><span className="text-slate-500">Address</span><p className="text-slate-300">{p.address}, {p.city}, {p.state} {p.zip}</p></div>
                        <div><span className="text-slate-500">Plan</span><p className="text-slate-300">{resolvePlanName(p.plan_name)}</p></div>
                        <div><span className="text-slate-500">Upload Date</span><p className="text-slate-300">{new Date(p.created_at).toLocaleDateString()}</p></div>
                      </div>
                    )}

                    <button
                      onClick={() => toggleCardExpand(p.id)}
                      className="mt-2 text-xs text-gold hover:text-gold-light transition-colors"
                    >
                      {expandedCards.has(p.id) ? "Show less" : "Show details"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-navy-light/50 text-left">
                  <th className="px-4 py-3 w-10 sticky left-0 bg-navy-light/50 z-10">
                    <input
                      type="checkbox"
                      checked={selected.size === policies.length && policies.length > 0}
                      onChange={toggleAll}
                      className="rounded border-slate-600 text-gold focus:ring-gold bg-navy-light"
                    />
                  </th>
                  <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">Writing #</th>
                  <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">Agent Name</th>
                  <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">Carrier</th>
                  <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">Agency</th>
                  <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">Type</th>
                  <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">Client Name</th>
                  <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">Policy #</th>
                  <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">Phone</th>
                  <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">Email</th>
                  <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">Address</th>
                  <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">City</th>
                  <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">State</th>
                  <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">ZIP</th>
                  <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">Plan Name</th>
                  <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">Effective Date</th>
                  <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">Monthly Premium</th>
                  <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">Source</th>
                  <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">Upload Date</th>
                  <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">App Submit Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {policies.map((p) => (
                  <tr
                    key={p.id}
                    className={`transition-colors ${
                      selected.has(p.id) ? "bg-gold/5" : "hover:bg-navy-light/30"
                    }`}
                  >
                    <td className="px-4 py-3 sticky left-0 bg-inherit">
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        className="rounded border-slate-600 text-gold focus:ring-gold bg-navy-light"
                      />
                    </td>
                    <td className="px-4 py-3 text-white font-medium whitespace-nowrap">{p.agent_number}</td>
                    <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{p.agent_first_name} {p.agent_last_name}</td>
                    <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{p.carrier}</td>
                    <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{p.agency || "\u2014"}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${PRODUCT_TYPE_STYLES[p.product_type] || "bg-slate-700/30 text-slate-300 border border-slate-600"}`}>
                        {p.product_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-white whitespace-nowrap">{p.client_first_name} {p.client_last_name}</td>
                    <td className="px-4 py-3 text-slate-300 font-mono text-xs whitespace-nowrap">{p.policy_number || "\u2014"}</td>
                    <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{p.phone}</td>
                    <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{p.email}</td>
                    <td className="px-4 py-3 text-slate-300 whitespace-nowrap max-w-[200px] truncate" title={p.address}>{p.address}</td>
                    <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{p.city}</td>
                    <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{p.state}</td>
                    <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{p.zip}</td>
                    <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{resolvePlanName(p.plan_name)}</td>
                    <td className="px-4 py-3 text-slate-300 whitespace-nowrap">
                      {p.policy_effective_date ? new Date(p.policy_effective_date).toLocaleDateString() : "\u2014"}
                    </td>
                    <td className="px-4 py-3 text-gold font-medium whitespace-nowrap">${Number(p.plan_premium).toFixed(2)}</td>
                    <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        p.source === "Data Source"
                          ? "bg-cyan-900/30 text-cyan-300 border border-cyan-700/50"
                          : "bg-amber-900/30 text-amber-300 border border-amber-700/50"
                      }`}>
                        {p.source === "Data Source" ? "Data Source" : "Intake Form"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{new Date(p.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                      {p.app_submit_date ? new Date(p.app_submit_date + "T00:00:00").toLocaleDateString() : "\u2014"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-slate-700/50">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <span>Rows per page:</span>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="px-2 py-1 border border-slate-600 rounded text-sm bg-navy-light text-slate-200 focus:outline-none focus:ring-1 focus:ring-gold"
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-400">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1.5 rounded-lg border border-slate-600 text-slate-400 hover:bg-navy-light hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1.5 rounded-lg border border-slate-600 text-slate-400 hover:bg-navy-light hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget && !deleting) setShowDeleteConfirm(false);
          }}
        >
          <div className="bg-navy rounded-xl shadow-xl max-w-lg w-full mx-4 overflow-hidden animate-scale-in border border-slate-700/50">
            <div className="flex items-start gap-4 p-6 pb-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-900/30 flex items-center justify-center">
                <AlertTriangle size={20} className="text-red-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-white">
                  Delete {selectedPolicies.length} {selectedPolicies.length === 1 ? "Policy" : "Policies"}
                </h3>
                <p className="mt-1 text-sm text-slate-400">
                  This will permanently remove the following policies and all associated client information. This action cannot be undone.
                </p>
              </div>
              <button
                onClick={() => !deleting && setShowDeleteConfirm(false)}
                className="flex-shrink-0 text-slate-500 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="px-6 pb-4">
              <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-700/50 divide-y divide-slate-700/30">
                {selectedPolicies.map((p) => (
                  <div key={p.id} className="flex items-center justify-between px-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-white truncate">
                        {p.client_first_name} {p.client_last_name}
                      </p>
                      <p className="text-xs text-slate-500">
                        Agent: {p.agent_first_name} {p.agent_last_name} &middot; #{p.agent_number} &middot; {resolvePlanName(p.plan_name)}
                      </p>
                    </div>
                    <span className="flex-shrink-0 ml-4 text-sm font-medium text-gold">
                      ${Number(p.plan_premium).toFixed(2)}/mo
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 bg-navy-light/50 border-t border-slate-700/50">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="btn-secondary text-sm px-4 py-2"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="text-sm px-4 py-2.5 rounded-lg font-medium bg-red-600 text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-navy focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
