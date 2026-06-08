import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Search,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Users,
  AlertCircle,
  RefreshCw,
  Trash2,
  Pencil,
  UserPlus,
  Type,
  DatabaseZap,
  Filter,
} from "lucide-react";
import { adminGetAgents, adminDeleteAgent, adminUpdateAgent, adminCreateAgent, adminBulkFixNames, adminResyncAgents } from "../../lib/api";
import ConfirmDialog from "../ui/ConfirmDialog";
import AgentEditModal from "./AgentEditModal";
import AgentAddModal from "./AgentAddModal";
import NameFixPreviewModal from "./NameFixPreviewModal";
import type { AgentRow } from "../../types";
import { isNameMalformatted } from "../../lib/nameFormat";

interface AgentsTableProps {
  token: string;
}

type SortField = "firstName" | "lastName" | "npn" | "unlWritingNumber" | "gtlWritingNumber" | "agency" | "source";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 20;

const COLUMNS: { key: SortField; label: string }[] = [
  { key: "firstName", label: "First Name" },
  { key: "lastName", label: "Last Name" },
  { key: "npn", label: "NPN" },
  { key: "unlWritingNumber", label: "UNL Writing Number" },
  { key: "gtlWritingNumber", label: "GTL Writing Number" },
  { key: "agency", label: "Agency" },
  { key: "source", label: "Source" },
];

export default function AgentsTable({ token }: AgentsTableProps) {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("source");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<AgentRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editTarget, setEditTarget] = useState<AgentRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [fixNamesOpen, setFixNamesOpen] = useState(false);
  const [fixingNames, setFixingNames] = useState(false);
  const [agencyFilter, setAgencyFilter] = useState("FYM");
  const [resyncing, setResyncing] = useState(false);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await adminGetAgents(token);
      setAgents(result.agents || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const agencyOptions = useMemo(() => {
    const set = new Set<string>();
    for (const a of agents) {
      if (a.agency) set.add(a.agency);
    }
    return Array.from(set).sort();
  }, [agents]);

  const filtered = useMemo(() => {
    let result = agents;
    if (agencyFilter !== "__all__") {
      if (agencyFilter === "FYM") {
        result = result.filter((a) => !a.agency || a.agency === "FYM");
      } else {
        result = result.filter((a) => a.agency === agencyFilter);
      }
    }
    if (!search.trim()) return result;
    const q = search.toLowerCase();
    return result.filter(
      (a) =>
        a.firstName.toLowerCase().includes(q) ||
        a.lastName.toLowerCase().includes(q) ||
        a.npn.toLowerCase().includes(q) ||
        a.unlWritingNumber.toLowerCase().includes(q) ||
        a.gtlWritingNumber.toLowerCase().includes(q) ||
        a.agency.toLowerCase().includes(q) ||
        a.source.toLowerCase().includes(q)
    );
  }, [agents, search, agencyFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const aVal = (a[sortField] || "").toLowerCase();
      const bVal = (b[sortField] || "").toLowerCase();
      const cmp = aVal.localeCompare(bVal);
      const primary = sortDir === "asc" ? cmp : -cmp;
      if (primary !== 0 || sortField === "lastName") return primary;
      return (a.lastName || "").toLowerCase().localeCompare((b.lastName || "").toLowerCase());
    });
  }, [filtered, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = sorted.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );

  useEffect(() => {
    setPage(1);
  }, [search, sortField, sortDir, agencyFilter]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ChevronsUpDown size={14} className="text-slate-500" />;
    }
    return sortDir === "asc" ? (
      <ChevronUp size={14} className="text-gold" />
    ) : (
      <ChevronDown size={14} className="text-gold" />
    );
  };

  const handleDeleteAgent = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await adminDeleteAgent(token, deleteTarget.agentTableId, deleteTarget.rosterEntryIds);
      setDeleteTarget(null);
      fetchAgents();
    } catch {
      setError("Failed to delete agent");
    } finally {
      setDeleting(false);
    }
  };

  const handleSaveAgent = async (fields: {
    firstName: string;
    lastName: string;
    npn: string;
    unlWritingNumber: string;
    gtlWritingNumber: string;
    agency: string;
  }) => {
    if (!editTarget) return;
    setSaving(true);
    try {
      await adminUpdateAgent(token, editTarget.agentTableId, editTarget.rosterEntryIds, fields);
      setEditTarget(null);
      fetchAgents();
    } catch {
      setError("Failed to update agent");
    } finally {
      setSaving(false);
    }
  };

  const malformattedCount = useMemo(
    () => agents.filter((a) => isNameMalformatted(a.firstName) || isNameMalformatted(a.lastName)).length,
    [agents]
  );

  const handleFixNames = async (
    corrections: { agent: AgentRow; firstName: string; lastName: string }[]
  ) => {
    setFixingNames(true);
    try {
      await adminBulkFixNames(
        token,
        corrections.map((c) => ({
          agentTableId: c.agent.agentTableId,
          rosterEntryIds: c.agent.rosterEntryIds,
          firstName: c.firstName,
          lastName: c.lastName,
        }))
      );
      setFixNamesOpen(false);
      fetchAgents();
    } catch {
      setError("Failed to apply name corrections");
    } finally {
      setFixingNames(false);
    }
  };

  const handleAddAgent = async (fields: {
    firstName: string;
    lastName: string;
    npn: string;
    unlWritingNumber: string;
    gtlWritingNumber: string;
    agency: string;
  }) => {
    setAdding(true);
    try {
      await adminCreateAgent(token, fields);
      setAddOpen(false);
      fetchAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add agent");
    } finally {
      setAdding(false);
    }
  };

  const handleResync = async () => {
    setResyncing(true);
    try {
      await adminResyncAgents(token);
      fetchAgents();
    } catch {
      setError("Failed to resync agents from data sources");
    } finally {
      setResyncing(false);
    }
  };

  const displayVal = (val: string) => val || "-";

  if (loading) {
    return (
      <div className="bg-navy rounded-xl shadow-sm border border-slate-700/50 p-16">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="animate-spin text-gold" size={32} />
          <span className="text-sm text-slate-400">Loading agents...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-navy rounded-xl shadow-sm border border-slate-700/50 p-10">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 bg-rose-900/20 rounded-xl flex items-center justify-center">
            <AlertCircle className="text-rose-400" size={24} />
          </div>
          <p className="text-sm text-rose-400">{error}</p>
          <button
            onClick={fetchAgents}
            className="text-sm font-medium text-gold hover:text-gold-light transition-colors"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-navy rounded-xl shadow-sm border border-slate-700/50">
      <div className="px-5 py-4 border-b border-slate-700/30 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gold/10 flex items-center justify-center">
            <Users size={20} className="text-gold" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">
              Agent Directory
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {filtered.length} agent{filtered.length !== 1 ? "s" : ""}{" "}
              {search && `matching "${search}"`}
            </p>
          </div>
        </div>

        <div className="sm:ml-auto flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agents..."
              className="w-full sm:w-64 pl-9 pr-3 py-2 text-sm text-white border border-slate-600 rounded-lg bg-navy-light placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-gold focus:border-gold transition-all"
            />
          </div>
          <div className="relative">
            <Filter
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
            />
            <select
              value={agencyFilter}
              onChange={(e) => setAgencyFilter(e.target.value)}
              className="pl-8 pr-8 py-2 text-sm text-white border border-slate-600 rounded-lg bg-navy-light focus:outline-none focus:ring-1 focus:ring-gold focus:border-gold transition-all appearance-none cursor-pointer"
            >
              <option value="__all__">All Agencies</option>
              {agencyOptions.map((ag) => (
                <option key={ag} value={ag}>
                  {ag}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={handleResync}
            disabled={resyncing}
            title="Resync agents from data sources"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-600 bg-navy-light text-white hover:bg-navy-mid disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <DatabaseZap size={15} className={resyncing ? "animate-pulse" : ""} />
            Sync
          </button>
          {malformattedCount > 0 && (
            <button
              onClick={() => setFixNamesOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
            >
              <Type size={15} />
              Fix Names
              <span className="ml-0.5 px-1.5 py-0.5 text-xs font-semibold rounded-full bg-amber-200 text-amber-800">
                {malformattedCount}
              </span>
            </button>
          )}
          <button
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-gold text-navy-dark hover:bg-gold-light transition-colors"
          >
            <UserPlus size={15} />
            Add Agent
          </button>
          <button
            onClick={fetchAgents}
            disabled={loading}
            title="Refresh agents"
            className="p-2 rounded-lg border border-slate-600 bg-navy-light hover:bg-navy-mid disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw size={16} className={`text-slate-400 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {agents.length === 0 ? (
        <div className="py-16 text-center">
          <div className="w-14 h-14 bg-navy-light rounded-xl flex items-center justify-center mx-auto mb-3">
            <Users size={26} className="text-slate-500" />
          </div>
          <p className="text-sm font-medium text-slate-300">No agents found</p>
          <p className="text-xs text-slate-500 mt-1">
            Upload a roster or add agents via the contracting portal
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-slate-400">
            No agents match your search
          </p>
        </div>
      ) : (
        <>
          {/* Mobile Card View */}
          <div className="md:hidden divide-y divide-slate-700/30">
            {paginated.map((agent, idx) => (
              <div
                key={`${agent.firstName}-${agent.lastName}-${idx}`}
                className="p-4 hover:bg-navy-light/20 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-white font-medium">
                      {displayVal(agent.firstName)} {displayVal(agent.lastName)}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {agent.agency && (
                        <span className="text-xs text-slate-300 bg-navy-light px-2 py-0.5 rounded">{agent.agency}</span>
                      )}
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          agent.source === "Contracting Portal"
                            ? "bg-gold/10 text-gold border border-gold/30"
                            : agent.source === "Data Source"
                            ? "bg-blue-900/30 text-blue-300 border border-blue-700/50"
                            : "bg-navy-light/50 text-slate-300 border border-slate-700/50"
                        }`}
                      >
                        {agent.source}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-xs">
                      {agent.npn && (
                        <div><span className="text-slate-500">NPN:</span> <span className="text-slate-300 font-mono">{agent.npn}</span></div>
                      )}
                      {agent.unlWritingNumber && (
                        <div><span className="text-slate-500">UNL:</span> <span className="text-sky-300">{agent.unlWritingNumber}</span></div>
                      )}
                      {agent.gtlWritingNumber && (
                        <div><span className="text-slate-500">GTL:</span> <span className="text-emerald-300">{agent.gtlWritingNumber}</span></div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => setEditTarget(agent)}
                      className="p-2 rounded-md text-slate-500 hover:text-gold hover:bg-gold/10 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                      title="Edit agent"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(agent)}
                      className="p-2 rounded-md text-slate-500 hover:text-rose-400 hover:bg-rose-900/20 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                      title="Delete agent"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-navy-light/50">
                  {COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      className="text-left px-5 py-3 text-xs font-semibold text-gold/80 uppercase tracking-wider cursor-pointer select-none hover:bg-navy-light/30 transition-colors whitespace-nowrap"
                      onClick={() => handleSort(col.key)}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {col.label}
                        {renderSortIcon(col.key)}
                      </span>
                    </th>
                  ))}
                  <th className="w-20 px-3 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {paginated.map((agent, idx) => (
                  <tr
                    key={`${agent.firstName}-${agent.lastName}-${idx}`}
                    className="hover:bg-navy-light/30 transition-colors"
                  >
                    <td className="px-5 py-3.5 text-sm text-white font-medium whitespace-nowrap">{displayVal(agent.firstName)}</td>
                    <td className="px-5 py-3.5 text-sm text-white font-medium whitespace-nowrap">{displayVal(agent.lastName)}</td>
                    <td className="px-5 py-3.5 text-sm text-slate-300 whitespace-nowrap font-mono">{displayVal(agent.npn)}</td>
                    <td className="px-5 py-3.5 text-sm whitespace-nowrap">
                      {agent.unlWritingNumber ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-sky-900/30 text-sky-300 border border-sky-700/50">{agent.unlWritingNumber}</span>
                      ) : (
                        <span className="text-slate-500">-</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-sm whitespace-nowrap">
                      {agent.gtlWritingNumber ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-emerald-900/30 text-emerald-300 border border-emerald-700/50">{agent.gtlWritingNumber}</span>
                      ) : (
                        <span className="text-slate-500">-</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-sm whitespace-nowrap">
                      {agent.agency ? <span className="text-slate-200">{agent.agency}</span> : <span className="text-slate-500">-</span>}
                    </td>
                    <td className="px-5 py-3.5 text-sm whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium ${
                          agent.source === "Contracting Portal"
                            ? "bg-gold/10 text-gold border border-gold/30"
                            : agent.source === "Data Source"
                            ? "bg-blue-900/30 text-blue-300 border border-blue-700/50"
                            : "bg-navy-light/50 text-slate-300 border border-slate-700/50"
                        }`}
                      >
                        {agent.source}
                      </span>
                    </td>
                    <td className="px-3 py-3.5 text-sm whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setEditTarget(agent)}
                          className="p-1.5 rounded-md text-slate-500 hover:text-gold hover:bg-gold/10 transition-colors"
                          title="Edit agent"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(agent)}
                          className="p-1.5 rounded-md text-slate-500 hover:text-rose-400 hover:bg-rose-900/20 transition-colors"
                          title="Delete agent"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="px-4 sm:px-5 py-3 border-t border-slate-700/30 flex items-center justify-between">
              <p className="text-xs text-slate-400">
                <span className="hidden sm:inline">Showing </span>{(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, sorted.length)} of {sorted.length}
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className="p-2 rounded-md hover:bg-navy-light disabled:opacity-30 disabled:cursor-not-allowed transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                >
                  <ChevronLeft size={16} className="text-slate-300" />
                </button>
                <span className="hidden sm:contents">
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
                    .reduce<(number | "ellipsis")[]>((acc, p, i, arr) => {
                      if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push("ellipsis");
                      acc.push(p);
                      return acc;
                    }, [])
                    .map((item, i) =>
                      item === "ellipsis" ? (
                        <span key={`e-${i}`} className="px-1 text-xs text-slate-500">...</span>
                      ) : (
                        <button
                          key={item}
                          onClick={() => setPage(item as number)}
                          className={`min-w-[28px] h-7 rounded-md text-xs font-medium transition-colors ${
                            safePage === item ? "bg-gold text-navy-dark" : "text-slate-300 hover:bg-navy-light"
                          }`}
                        >
                          {item}
                        </button>
                      )
                    )}
                </span>
                <span className="sm:hidden text-xs text-slate-400 px-2">{safePage}/{totalPages}</span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                  className="p-2 rounded-md hover:bg-navy-light disabled:opacity-30 disabled:cursor-not-allowed transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                >
                  <ChevronRight size={16} className="text-slate-300" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Agent"
        message={
          deleteTarget
            ? `Are you sure you want to delete ${deleteTarget.firstName} ${deleteTarget.lastName}? This will remove them from the agent directory.`
            : ""
        }
        confirmLabel="Delete"
        variant="danger"
        loading={deleting}
        onConfirm={handleDeleteAgent}
        onCancel={() => setDeleteTarget(null)}
      />

      <AgentEditModal
        agent={editTarget}
        saving={saving}
        onSave={handleSaveAgent}
        onClose={() => setEditTarget(null)}
      />

      <AgentAddModal
        open={addOpen}
        saving={adding}
        onSave={handleAddAgent}
        onClose={() => setAddOpen(false)}
      />

      <NameFixPreviewModal
        open={fixNamesOpen}
        agents={agents}
        saving={fixingNames}
        onApply={handleFixNames}
        onClose={() => setFixNamesOpen(false)}
      />
    </div>
  );
}
