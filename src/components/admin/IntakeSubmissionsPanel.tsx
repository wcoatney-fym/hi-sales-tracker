import { useState, useEffect, useCallback, useRef } from "react";
import {
  Download,
  ChevronLeft,
  ChevronRight,
  Loader2,
  FileText,
  Filter,
  Calendar,
  ChevronDown,
  Search,
  Pencil,
} from "lucide-react";
import { adminGetIntakeSubmissions, adminExportIntakeSubmissions, adminUpdateIntakeSubmission } from "../../lib/api";
import { getDateRange } from "../../lib/dateUtils";
import type { DatePreset } from "../../types/dashboard";
import IntakeSubmissionEditDrawer from "./IntakeSubmissionEditDrawer";

interface IntakeSubmissionsPanelProps {
  token: string;
}

interface IntakeRow {
  id: string;
  agent_first_name: string;
  agent_last_name: string;
  agent_number: string;
  npn: string;
  carrier: string;
  agency: string | null;
  product_type: string;
  client_first_name: string;
  client_last_name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  plan_name: string;
  plan_premium: number;
  policy_effective_date: string;
  app_submit_date: string | null;
  status: string;
  created_at: string;
  policy_number: string | null;
  duplicate_flag: boolean;
}

interface AgentOption {
  id: string;
  label: string;
}

interface AgencyOption {
  name: string;
}

const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: "allTime", label: "All Time" },
  { key: "thisMonth", label: "This Month" },
  { key: "lastMonth", label: "Last Month" },
  { key: "thisQuarter", label: "This Quarter" },
  { key: "past6Months", label: "Past 6 Months" },
  { key: "pastYear", label: "Past Year" },
];

const PAGE_SIZES = [10, 20, 50, 100];

function StatusBadge({ status, isDuplicate }: { status: string; isDuplicate: boolean }) {
  if (isDuplicate) {
    return (
      <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-900/30 text-rose-300 border border-rose-700/50">
        Duplicate
      </span>
    );
  }
  const styles: Record<string, string> = {
    submitted: "bg-amber-900/30 text-amber-300 border border-amber-700/50",
    pending: "bg-amber-900/30 text-amber-300 border border-amber-700/50",
    approved: "bg-emerald-900/30 text-emerald-300 border border-emerald-700/50",
    active: "bg-emerald-900/30 text-emerald-300 border border-emerald-700/50",
    cancelled: "bg-rose-900/30 text-rose-300 border border-rose-700/50",
    terminated: "bg-rose-900/30 text-rose-300 border border-rose-700/50",
    superseded: "bg-slate-700/40 text-slate-400 border border-slate-600/50",
    duplicate: "bg-rose-900/30 text-rose-300 border border-rose-700/50",
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

export default function IntakeSubmissionsPanel({ token }: IntakeSubmissionsPanelProps) {
  const [datePreset, setDatePreset] = useState<DatePreset>("allTime");
  const [dateRange, setDateRange] = useState(getDateRange("allTime"));
  const [dateOpen, setDateOpen] = useState(false);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const dateRef = useRef<HTMLDivElement>(null);

  const [submissions, setSubmissions] = useState<IntakeRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agencies, setAgencies] = useState<AgencyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [agentFilter, setAgentFilter] = useState("");
  const [npnFilter, setNpnFilter] = useState("");
  const [npnInput, setNpnInput] = useState("");
  const [agencyFilter, setAgencyFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [editingRow, setEditingRow] = useState<IntakeRow | null>(null);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const npnTimeout = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dateRef.current && !dateRef.current.contains(e.target as Node)) setDateOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    clearTimeout(npnTimeout.current);
    npnTimeout.current = setTimeout(() => {
      setNpnFilter(npnInput.trim());
    }, 400);
    return () => clearTimeout(npnTimeout.current);
  }, [npnInput]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await adminGetIntakeSubmissions(
        token,
        dateRange.startDate,
        dateRange.endDate,
        page,
        pageSize,
        agentFilter || undefined,
        npnFilter || undefined,
        agencyFilter || undefined
      );
      setSubmissions(result.submissions || []);
      setTotalCount(result.totalCount || 0);
      setAgents(result.agents || []);
      setAgencies(result.agencies || []);
    } catch {
      setSubmissions([]);
      setTotalCount(0);
    }
    setLoading(false);
  }, [token, dateRange.startDate, dateRange.endDate, page, pageSize, agentFilter, npnFilter, agencyFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [dateRange.startDate, dateRange.endDate, agentFilter, npnFilter, agencyFilter, pageSize]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === submissions.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(submissions.map((s) => s.id)));
    }
  };

  const buildCsv = (rows: IntakeRow[]) => {
    const headers = [
      "Agent First Name",
      "Agent Last Name",
      "Writing Number",
      "NPN",
      "Carrier",
      "Agency",
      "Product Type",
      "Client First Name",
      "Client Last Name",
      "Phone",
      "Email",
      "Address",
      "City",
      "State",
      "ZIP",
      "Plan Name",
      "Monthly Premium",
      "Effective Date",
      "App Submit Date",
      "Status",
      "Duplicate",
      "Policy Number",
      "Upload Date",
    ];
    const csvRows = rows.map((s) => [
      s.agent_first_name,
      s.agent_last_name,
      s.agent_number,
      s.npn,
      s.carrier,
      s.agency || "",
      s.product_type,
      s.client_first_name,
      s.client_last_name,
      s.phone,
      s.email,
      s.address,
      s.city,
      s.state,
      s.zip,
      s.plan_name,
      s.plan_premium,
      s.policy_effective_date ? new Date(s.policy_effective_date).toLocaleDateString() : "",
      s.app_submit_date ? new Date(s.app_submit_date + "T00:00:00").toLocaleDateString() : "",
      s.status,
      s.duplicate_flag ? "Yes" : "No",
      s.policy_number || "",
      new Date(s.created_at).toLocaleDateString(),
    ]);
    return [
      headers.join(","),
      ...csvRows.map((r) =>
        r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\n");
  };

  const exportSelected = () => {
    const rows = submissions.filter((s) => selected.has(s.id));
    if (rows.length === 0) return;
    const csv = buildCsv(rows);
    downloadCsv(csv, `intake-submissions-selected-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const exportAll = async () => {
    setExporting(true);
    try {
      const result = await adminExportIntakeSubmissions(
        token,
        dateRange.startDate,
        dateRange.endDate,
        agentFilter || undefined,
        npnFilter || undefined,
        agencyFilter || undefined
      );
      const rows: IntakeRow[] = result.submissions || [];
      if (rows.length === 0) return;
      const csv = buildCsv(rows);
      downloadCsv(csv, `intake-submissions-all-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch { /* silent */ }
    setExporting(false);
  };

  const downloadCsv = (content: string, filename: string) => {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const applyRowUpdate = (updated: IntakeRow) => {
    setSubmissions((prev) => prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)));
  };

  const showActionMessage = (kind: "success" | "error", text: string) => {
    setActionMessage({ kind, text });
    setTimeout(() => setActionMessage(null), 4000);
  };

  const handleQuickStatus = async (row: IntakeRow, nextStatus: string) => {
    if (nextStatus === row.status) return;
    setStatusUpdatingId(row.id);
    try {
      const res = await adminUpdateIntakeSubmission(token, row.id, { status: nextStatus });
      if (res.error) {
        showActionMessage("error", res.error);
      } else if (res.submission) {
        applyRowUpdate({ ...row, ...res.submission });
        showActionMessage("success", `Status updated for ${row.client_first_name} ${row.client_last_name}`);
      }
    } catch (err: unknown) {
      showActionMessage("error", err instanceof Error ? err.message : "Update failed");
    } finally {
      setStatusUpdatingId(null);
    }
  };

  const handleQuickDuplicate = async (row: IntakeRow, value: boolean) => {
    setStatusUpdatingId(row.id);
    try {
      const res = await adminUpdateIntakeSubmission(token, row.id, { duplicate_flag: value });
      if (res.error) {
        showActionMessage("error", res.error);
      } else if (res.submission) {
        applyRowUpdate({ ...row, ...res.submission });
      }
    } catch (err: unknown) {
      showActionMessage("error", err instanceof Error ? err.message : "Update failed");
    } finally {
      setStatusUpdatingId(null);
    }
  };

  return (
    <div className="bg-navy rounded-xl border border-slate-700/50">
      <div className="p-4 border-b border-slate-700/50">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <FileText size={20} className="text-gold" />
            <h3 className="text-base font-semibold text-white">Intake Form Submissions</h3>
            <span className="text-sm text-slate-400">{totalCount.toLocaleString()} total</span>
          </div>

          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <button
                onClick={exportSelected}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-slate-600 rounded-lg text-slate-300 hover:bg-navy-light hover:text-white transition-colors"
              >
                <Download size={14} />
                <span className="hidden sm:inline">Export Selected</span>
                <span className="ml-1 text-xs text-gold">({selected.size})</span>
              </button>
            )}
            <button
              onClick={exportAll}
              disabled={totalCount === 0 || exporting}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-slate-600 rounded-lg text-slate-300 hover:bg-navy-light hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              <span className="hidden sm:inline">Export All</span>
              <span className="ml-1 text-xs text-slate-400">({totalCount.toLocaleString()})</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-3">
          <div ref={dateRef} className="relative">
            <button
              onClick={() => setDateOpen(!dateOpen)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm border border-slate-600 rounded-lg bg-navy-light text-slate-200 hover:bg-navy-mid transition-colors"
            >
              <Calendar size={14} className="text-gold" />
              <span className="font-medium">{dateRange.label}</span>
              <ChevronDown size={12} className="text-slate-400" />
            </button>
            {dateOpen && (
              <div className="absolute left-0 top-full mt-1 w-56 bg-navy-light rounded-lg border border-slate-700/50 shadow-lg z-50 overflow-hidden">
                <div className="py-1">
                  {DATE_PRESETS.map((p) => (
                    <button
                      key={p.key}
                      onClick={() => {
                        setDatePreset(p.key);
                        setDateRange(getDateRange(p.key));
                        setDateOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
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
                      className="w-full px-2.5 py-2 text-sm border border-slate-600 rounded-lg bg-navy text-white focus:outline-none focus:ring-1 focus:ring-gold"
                    />
                    <input
                      type="date"
                      value={customEnd}
                      onChange={(e) => setCustomEnd(e.target.value)}
                      className="w-full px-2.5 py-2 text-sm border border-slate-600 rounded-lg bg-navy text-white focus:outline-none focus:ring-1 focus:ring-gold"
                    />
                    <button
                      onClick={() => {
                        if (!customStart || !customEnd) return;
                        const start = new Date(customStart);
                        const end = new Date(customEnd);
                        end.setDate(end.getDate() + 1);
                        setDatePreset("custom" as DatePreset);
                        setDateRange({
                          startDate: start.toISOString(),
                          endDate: end.toISOString(),
                          label: `${customStart} \u2013 ${customEnd}`,
                        });
                        setDateOpen(false);
                      }}
                      disabled={!customStart || !customEnd}
                      className="w-full px-2.5 py-2 text-sm font-medium text-navy-dark bg-gold rounded-lg hover:bg-gold-light disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
              className="w-full sm:w-auto pl-8 pr-8 py-2 text-sm border border-slate-600 rounded-lg bg-navy-light text-slate-200 focus:outline-none focus:ring-1 focus:ring-gold appearance-none cursor-pointer"
            >
              <option value="">All Agents</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </div>

          <div className="relative flex-1 min-w-[120px] sm:flex-none">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={npnInput}
              onChange={(e) => setNpnInput(e.target.value)}
              placeholder="Search NPN..."
              className="w-full sm:w-36 pl-8 pr-3 py-2 text-sm border border-slate-600 rounded-lg bg-navy-light text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-gold"
            />
          </div>

          <div className="relative flex-1 min-w-[140px] sm:flex-none">
            <Filter size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <select
              value={agencyFilter}
              onChange={(e) => setAgencyFilter(e.target.value)}
              className="w-full sm:w-auto pl-8 pr-8 py-2 text-sm border border-slate-600 rounded-lg bg-navy-light text-slate-200 focus:outline-none focus:ring-1 focus:ring-gold appearance-none cursor-pointer"
            >
              <option value="">All Agencies</option>
              {agencies.map((ag) => (
                <option key={ag.name} value={ag.name}>{ag.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="h-64 flex items-center justify-center">
          <Loader2 className="animate-spin text-slate-500" size={32} />
        </div>
      ) : submissions.length === 0 ? (
        <div className="h-64 flex flex-col items-center justify-center text-slate-500">
          <FileText size={40} className="mb-3 opacity-40" />
          <p className="text-sm">No intake submissions found for the selected filters</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-navy-light/50 text-left">
                <th className="px-4 py-3 w-10 sticky left-0 bg-navy-light/50 z-10">
                  <input
                    type="checkbox"
                    checked={selected.size === submissions.length && submissions.length > 0}
                    onChange={toggleAll}
                    className="rounded border-slate-600 text-gold focus:ring-gold bg-navy-light"
                  />
                </th>
                <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">Agent Name</th>
                <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">Writing #</th>
                <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">NPN</th>
                <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">Carrier</th>
                <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">Agency</th>
                <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">Type</th>
                <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">Client Name</th>
                <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">Phone</th>
                <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">Email</th>
                <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">Plan</th>
                <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">Premium</th>
                <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">Effective Date</th>
                <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">App Submit Date</th>
                <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider">Upload Date</th>
                <th className="px-4 py-3 font-medium text-gold/80 whitespace-nowrap text-xs uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {submissions.map((s) => (
                <tr
                  key={s.id}
                  className={`transition-colors ${
                    selected.has(s.id) ? "bg-gold/5" : "hover:bg-navy-light/30"
                  } ${s.status === "superseded" || s.duplicate_flag ? "opacity-60" : ""}`}
                >
                  <td className="px-4 py-3 sticky left-0 bg-inherit">
                    <input
                      type="checkbox"
                      checked={selected.has(s.id)}
                      onChange={() => toggleSelect(s.id)}
                      className="rounded border-slate-600 text-gold focus:ring-gold bg-navy-light"
                    />
                  </td>
                  <td className="px-4 py-3 text-white whitespace-nowrap">{s.agent_first_name} {s.agent_last_name}</td>
                  <td className="px-4 py-3 text-slate-300 whitespace-nowrap font-mono text-xs">{s.agent_number}</td>
                  <td className="px-4 py-3 text-slate-300 whitespace-nowrap font-mono text-xs">{s.npn || "\u2014"}</td>
                  <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{s.carrier}</td>
                  <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{s.agency || "\u2014"}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-slate-700/30 text-slate-300 border border-slate-600">
                      {s.product_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-white whitespace-nowrap">{s.client_first_name} {s.client_last_name}</td>
                  <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{s.phone}</td>
                  <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{s.email}</td>
                  <td className="px-4 py-3 text-slate-300 whitespace-nowrap max-w-[150px] truncate" title={s.plan_name}>{s.plan_name}</td>
                  <td className="px-4 py-3 text-gold font-medium whitespace-nowrap">${Number(s.plan_premium).toFixed(2)}</td>
                  <td className="px-4 py-3 text-slate-300 whitespace-nowrap">
                    {s.policy_effective_date ? new Date(s.policy_effective_date).toLocaleDateString() : "\u2014"}
                  </td>
                  <td className="px-4 py-3 text-slate-300 whitespace-nowrap">
                    {s.app_submit_date ? new Date(s.app_submit_date + "T00:00:00").toLocaleDateString() : "\u2014"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={s.status} isDuplicate={s.duplicate_flag} />
                      <select
                        value={s.duplicate_flag ? "__dup__" : (s.status === "submitted" ? "pending" : s.status)}
                        disabled={statusUpdatingId === s.id || s.duplicate_flag}
                        onChange={(e) => handleQuickStatus(s, e.target.value)}
                        title="Quick status change"
                        className="px-1.5 py-1 text-xs border border-slate-600 rounded bg-navy-light text-slate-200 focus:outline-none focus:ring-1 focus:ring-gold disabled:opacity-50"
                      >
                        <option value="pending">Submitted</option>
                        <option value="approved">Approved</option>
                        <option value="active">Active</option>
                        <option value="cancelled">Cancelled</option>
                        <option value="terminated">Terminated</option>
                        <option value="superseded">Superseded</option>
                        {s.duplicate_flag && <option value="__dup__">Duplicate</option>}
                      </select>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{new Date(s.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-right">
                    <div className="flex items-center justify-end gap-1">
                      <label className="inline-flex items-center gap-1 text-xs text-slate-400 mr-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={s.duplicate_flag}
                          disabled={statusUpdatingId === s.id}
                          onChange={(e) => handleQuickDuplicate(s, e.target.checked)}
                          className="rounded border-slate-600 text-gold focus:ring-gold bg-navy-light"
                        />
                        Dup
                      </label>
                      <button
                        onClick={() => setEditingRow(s)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gold border border-gold/40 rounded-lg hover:bg-gold/10 transition-colors"
                        title="Edit submission"
                      >
                        {statusUpdatingId === s.id ? <Loader2 size={12} className="animate-spin" /> : <Pencil size={12} />}
                        Edit
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-700/50">
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

      {actionMessage && (
        <div
          className={`fixed bottom-6 right-6 z-[60] px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-fade-in ${
            actionMessage.kind === "success"
              ? "bg-emerald-900/90 text-emerald-200 border border-emerald-700"
              : "bg-red-900/90 text-red-200 border border-red-700"
          }`}
        >
          {actionMessage.text}
        </div>
      )}

      <IntakeSubmissionEditDrawer
        open={editingRow !== null}
        token={token}
        row={editingRow}
        onClose={() => setEditingRow(null)}
        onSaved={(updated) => {
          applyRowUpdate(updated as IntakeRow);
          showActionMessage("success", `Saved changes for ${updated.client_first_name} ${updated.client_last_name}`);
        }}
      />
    </div>
  );
}
