import { useState, useEffect, useCallback } from "react";
import {
  Upload,
  Download,
  UserPlus,
  Search,
  Shield,
  XCircle,
  RotateCcw,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Clock,
} from "lucide-react";
import {
  agencyGetRoster,
  agencyUploadRoster,
  agencyAddRosterEntry,
  agencyTerminateRosterEntry,
  agencyReactivateRosterEntry,
  agencySetManager,
  agencyAddWritingNumber,
  agencyRemoveWritingNumber,
} from "../../lib/api";
import ConfirmDialog from "../ui/ConfirmDialog";

interface RosterEntry {
  id: string;
  agent_first_name: string;
  agent_last_name: string;
  writing_number: string;
  carrier: string;
  npn: string;
  status: string;
  terminated_at: string | null;
  is_agency_manager: boolean;
  match_status: string;
  matched_agent_id: string | null;
  created_at: string;
  agents?: {
    id: string;
    first_name: string;
    last_name: string;
    unl_writing_number: string;
    gtl_writing_number: string;
    npn: string;
  } | null;
}

interface WritingNumber {
  id: string;
  agent_id: string;
  carrier_name: string;
  writing_number: string;
}

interface AgencyRosterPanelProps {
  token: string;
  overrideAgencyId?: string | null;
}

export default function AgencyRosterPanel({ token, overrideAgencyId }: AgencyRosterPanelProps) {
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [writingNumbers, setWritingNumbers] = useState<WritingNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "terminated">("all");
  const [showUpload, setShowUpload] = useState(false);
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ id: string; type: "terminate" | "reactivate" } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ total: number; matched: number; fuzzy: number; unmatched: number } | null>(null);

  const fetchRoster = useCallback(async () => {
    setLoading(true);
    try {
      const data = await agencyGetRoster(token, statusFilter, search || undefined, overrideAgencyId || undefined);
      setRoster(data.roster || []);
      setWritingNumbers(data.writing_numbers || []);
    } catch {
      // ignore
    }
    setLoading(false);
  }, [token, statusFilter, search, overrideAgencyId]);

  useEffect(() => {
    fetchRoster();
  }, [fetchRoster]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadResult(null);

    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) throw new Error("CSV must have a header and at least one row");

      const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
      const firstNameIdx = headers.findIndex((h) => h.includes("first name") || h === "agent first name");
      const lastNameIdx = headers.findIndex((h) => h.includes("last name") || h === "agent last name");
      const writingNumIdx = headers.findIndex((h) => h.includes("writing number") || h.includes("unl"));
      const npnIdx = headers.findIndex((h) => h === "npn");

      if (firstNameIdx === -1 || lastNameIdx === -1 || writingNumIdx === -1) {
        throw new Error("CSV must contain 'Agent First Name', 'Agent Last Name', and 'UNL Writing Number' columns");
      }

      const rows: Array<Record<string, string>> = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
        if (!cols[firstNameIdx] || !cols[lastNameIdx] || !cols[writingNumIdx]) continue;
        rows.push({
          agent_first_name: cols[firstNameIdx],
          agent_last_name: cols[lastNameIdx],
          writing_number: cols[writingNumIdx],
          npn: npnIdx !== -1 ? cols[npnIdx] || "" : "",
          carrier: "UNL",
        });
      }

      if (rows.length === 0) throw new Error("No valid rows found in CSV");

      const result = await agencyUploadRoster(token, rows, file.name, overrideAgencyId || undefined);
      setUploadResult(result);
      fetchRoster();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Upload failed");
    }
    setUploading(false);
  };

  const downloadTemplate = () => {
    const csv = "Agent First Name,Agent Last Name,UNL Writing Number,NPN\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "agent_roster_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleTerminate = async () => {
    if (!confirmAction || confirmAction.type !== "terminate") return;
    try {
      await agencyTerminateRosterEntry(token, confirmAction.id, overrideAgencyId || undefined);
      fetchRoster();
    } catch { /* ignore */ }
    setConfirmAction(null);
  };

  const handleReactivate = async () => {
    if (!confirmAction || confirmAction.type !== "reactivate") return;
    try {
      await agencyReactivateRosterEntry(token, confirmAction.id, overrideAgencyId || undefined);
      fetchRoster();
    } catch { /* ignore */ }
    setConfirmAction(null);
  };

  const handleToggleManager = async (entry: RosterEntry) => {
    try {
      const res = await agencySetManager(token, entry.id, !entry.is_agency_manager, overrideAgencyId || undefined) as { bridged_manager?: { username?: string; password?: string; is_active?: boolean } | null };
      const bm = res?.bridged_manager;
      if (bm && bm.is_active && bm.username && bm.password) {
        alert(`Manager login created:\n\nUsername: ${bm.username}\nPassword: ${bm.password}\n\nFind it anytime under Settings → Agency Managers. They sign in at /manager.`);
      }
      fetchRoster();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not update manager status");
    }
  };

  const getAgentWritingNumbers = (agentId: string) => {
    return writingNumbers.filter((wn) => wn.agent_id === agentId);
  };

  const matchStatusBadge = (status: string) => {
    switch (status) {
      case "confirmed":
        return <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded"><CheckCircle2 size={10} /> Confirmed</span>;
      case "fuzzy":
        return <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded"><AlertTriangle size={10} /> Pending Review</span>;
      default:
        return <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-400 bg-slate-400/10 px-1.5 py-0.5 rounded"><Clock size={10} /> Unmatched</span>;
    }
  };

  return (
    <div className="space-y-4">
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-white">Agent Roster</h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={downloadTemplate}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-700/50 hover:bg-slate-700 border border-slate-600/50 rounded-lg transition-colors"
          >
            <Download size={14} /> Template
          </button>
          <label className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-sky-600 hover:bg-sky-500 rounded-lg cursor-pointer transition-colors">
            <Upload size={14} /> Upload Roster
            <input
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="hidden"
              disabled={uploading}
            />
          </label>
          <button
            onClick={() => setShowAddAgent(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors"
          >
            <UserPlus size={14} /> Add Agent
          </button>
        </div>
      </div>

      {/* Upload Result */}
      {uploadResult && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <FileText size={14} className="text-sky-400" />
            <span className="text-sm font-medium text-white">Upload Complete</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="bg-slate-700/50 rounded p-2">
              <p className="text-slate-400">Total Rows</p>
              <p className="text-white font-semibold">{uploadResult.total}</p>
            </div>
            <div className="bg-emerald-900/20 border border-emerald-700/30 rounded p-2">
              <p className="text-emerald-400">Matched</p>
              <p className="text-emerald-300 font-semibold">{uploadResult.matched}</p>
            </div>
            <div className="bg-amber-900/20 border border-amber-700/30 rounded p-2">
              <p className="text-amber-400">Fuzzy (Needs Review)</p>
              <p className="text-amber-300 font-semibold">{uploadResult.fuzzy}</p>
            </div>
            <div className="bg-slate-700/50 rounded p-2">
              <p className="text-slate-400">Unmatched</p>
              <p className="text-white font-semibold">{uploadResult.unmatched}</p>
            </div>
          </div>
          <button
            onClick={() => setUploadResult(null)}
            className="mt-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search by name, writing number, or NPN..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-sm bg-slate-800/50 border border-slate-700/50 rounded-lg text-white placeholder-slate-500 focus:border-sky-500/50 focus:outline-none"
          />
        </div>
        <div className="flex gap-1 bg-slate-800/50 rounded-lg border border-slate-700/50 p-0.5">
          {(["all", "active", "terminated"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                statusFilter === s
                  ? "bg-slate-700 text-white"
                  : "text-slate-400 hover:text-slate-300"
              }`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Roster Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin h-6 w-6 border-2 border-sky-500 border-t-transparent rounded-full" />
        </div>
      ) : roster.length === 0 ? (
        <div className="text-center py-12">
          <Upload size={32} className="mx-auto text-slate-600 mb-3" />
          <p className="text-sm text-slate-400">No agents in your roster yet.</p>
          <p className="text-xs text-slate-500 mt-1">Upload a CSV or add agents manually to get started.</p>
        </div>
      ) : (
        <div className="bg-slate-800/30 border border-slate-700/40 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-700/50">
                  <th className="text-left px-3 py-2.5 text-slate-400 font-medium">Agent</th>
                  <th className="text-left px-3 py-2.5 text-slate-400 font-medium">Writing Number</th>
                  <th className="text-left px-3 py-2.5 text-slate-400 font-medium hidden sm:table-cell">NPN</th>
                  <th className="text-left px-3 py-2.5 text-slate-400 font-medium hidden md:table-cell">Match</th>
                  <th className="text-left px-3 py-2.5 text-slate-400 font-medium">Status</th>
                  <th className="text-right px-3 py-2.5 text-slate-400 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((entry) => {
                  const isExpanded = expandedAgent === entry.id;
                  const agentWns = entry.matched_agent_id ? getAgentWritingNumbers(entry.matched_agent_id) : [];
                  return (
                    <RosterRow
                      key={entry.id}
                      entry={entry}
                      isExpanded={isExpanded}
                      agentWns={agentWns}
                      onToggleExpand={() => setExpandedAgent(isExpanded ? null : entry.id)}
                      onTerminate={() => setConfirmAction({ id: entry.id, type: "terminate" })}
                      onReactivate={() => setConfirmAction({ id: entry.id, type: "reactivate" })}
                      onToggleManager={() => handleToggleManager(entry)}
                      matchStatusBadge={matchStatusBadge}
                      token={token}
                      agentId={entry.matched_agent_id}
                      onRefresh={fetchRoster}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Agent Modal */}
      {showAddAgent && (
        <AddAgentModal
          token={token}
          onClose={() => setShowAddAgent(false)}
          onSuccess={() => { setShowAddAgent(false); fetchRoster(); }}
          overrideAgencyId={overrideAgencyId || undefined}
        />
      )}

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={confirmAction?.type === "terminate"}
        title="Terminate Agent"
        message="Are you sure you want to terminate this agent from your roster? Their historical data will remain attributed to your agency."
        confirmLabel="Terminate"
        variant="danger"
        onConfirm={handleTerminate}
        onCancel={() => setConfirmAction(null)}
      />
      <ConfirmDialog
        open={confirmAction?.type === "reactivate"}
        title="Reactivate Agent"
        message="Are you sure you want to reactivate this agent?"
        confirmLabel="Reactivate"
        onConfirm={handleReactivate}
        onCancel={() => setConfirmAction(null)}
      />

      {showUpload && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 max-w-md w-full">
            <h3 className="text-white font-semibold mb-4">Upload Agent Roster</h3>
            <p className="text-sm text-slate-400 mb-3">
              Upload a CSV with columns: Agent First Name, Agent Last Name, UNL Writing Number, NPN
            </p>
            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-slate-600 rounded-lg cursor-pointer hover:border-sky-500/50 transition-colors">
              <Upload size={24} className="text-slate-500 mb-2" />
              <span className="text-sm text-slate-400">Click to select CSV file</span>
              <input
                type="file"
                accept=".csv"
                onChange={(e) => { handleFileUpload(e); setShowUpload(false); }}
                className="hidden"
              />
            </label>
            <button
              onClick={() => setShowUpload(false)}
              className="mt-4 w-full py-2 text-sm text-slate-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RosterRow({
  entry,
  isExpanded,
  agentWns,
  onToggleExpand,
  onTerminate,
  onReactivate,
  onToggleManager,
  matchStatusBadge,
  token,
  agentId,
  onRefresh,
}: {
  entry: RosterEntry;
  isExpanded: boolean;
  agentWns: WritingNumber[];
  onToggleExpand: () => void;
  onTerminate: () => void;
  onReactivate: () => void;
  onToggleManager: () => void;
  matchStatusBadge: (status: string) => JSX.Element;
  token: string;
  agentId: string | null;
  onRefresh: () => void;
}) {
  const [showAddWn, setShowAddWn] = useState(false);
  const [wnCarrier, setWnCarrier] = useState("");
  const [wnNumber, setWnNumber] = useState("");
  const [saving, setSaving] = useState(false);

  const handleAddWritingNumber = async () => {
    if (!agentId || !wnCarrier || !wnNumber) return;
    setSaving(true);
    try {
      await agencyAddWritingNumber(token, agentId, wnCarrier, wnNumber);
      setShowAddWn(false);
      setWnCarrier("");
      setWnNumber("");
      onRefresh();
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleRemoveWn = async (wnId: string) => {
    try {
      await agencyRemoveWritingNumber(token, wnId);
      onRefresh();
    } catch { /* ignore */ }
  };

  return (
    <>
      <tr className="border-b border-slate-700/30 hover:bg-slate-700/20 transition-colors">
        <td className="px-3 py-2.5">
          <button onClick={onToggleExpand} className="flex items-center gap-1.5 text-left">
            {isExpanded ? <ChevronDown size={12} className="text-slate-500" /> : <ChevronRight size={12} className="text-slate-500" />}
            <div>
              <p className="text-white font-medium">
                {entry.agent_first_name} {entry.agent_last_name}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                {entry.is_agency_manager && (
                  <span className="text-[9px] font-semibold text-sky-400 bg-sky-400/10 px-1 py-0.5 rounded">MANAGER</span>
                )}
              </div>
            </div>
          </button>
        </td>
        <td className="px-3 py-2.5 text-slate-300 font-mono text-[11px]">{entry.writing_number}</td>
        <td className="px-3 py-2.5 text-slate-400 hidden sm:table-cell">{entry.npn || "---"}</td>
        <td className="px-3 py-2.5 hidden md:table-cell">{matchStatusBadge(entry.match_status)}</td>
        <td className="px-3 py-2.5">
          {entry.status === "active" ? (
            <span className="text-[10px] font-medium text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded">Active</span>
          ) : (
            <span className="text-[10px] font-medium text-rose-400 bg-rose-400/10 px-1.5 py-0.5 rounded">Terminated</span>
          )}
        </td>
        <td className="px-3 py-2.5 text-right">
          <div className="flex items-center justify-end gap-1">
            <button
              onClick={onToggleManager}
              title={entry.is_agency_manager ? "Remove manager" : "Set as manager"}
              className={`p-1 rounded transition-colors ${entry.is_agency_manager ? "text-sky-400 hover:text-sky-300" : "text-slate-500 hover:text-slate-300"}`}
            >
              <Shield size={13} />
            </button>
            {entry.status === "active" ? (
              <button onClick={onTerminate} title="Terminate" className="p-1 text-slate-500 hover:text-rose-400 rounded transition-colors">
                <XCircle size={13} />
              </button>
            ) : (
              <button onClick={onReactivate} title="Reactivate" className="p-1 text-slate-500 hover:text-emerald-400 rounded transition-colors">
                <RotateCcw size={13} />
              </button>
            )}
          </div>
        </td>
      </tr>
      {isExpanded && (
        <tr className="bg-slate-800/40">
          <td colSpan={6} className="px-4 py-3">
            <div className="space-y-3">
              {/* Agent Details */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div>
                  <p className="text-slate-500">Carrier</p>
                  <p className="text-slate-300">{entry.carrier}</p>
                </div>
                <div>
                  <p className="text-slate-500">Added</p>
                  <p className="text-slate-300">{new Date(entry.created_at).toLocaleDateString()}</p>
                </div>
                {entry.terminated_at && (
                  <div>
                    <p className="text-slate-500">Terminated</p>
                    <p className="text-rose-400">{new Date(entry.terminated_at).toLocaleDateString()}</p>
                  </div>
                )}
                <div>
                  <p className="text-slate-500">Matched Agent ID</p>
                  <p className="text-slate-300 font-mono text-[10px]">{entry.matched_agent_id ? entry.matched_agent_id.slice(0, 8) + "..." : "None"}</p>
                </div>
              </div>

              {/* Additional Writing Numbers */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Additional Writing Numbers</p>
                  {agentId && entry.status === "active" && (
                    <button
                      onClick={() => setShowAddWn(true)}
                      className="flex items-center gap-1 text-[10px] text-sky-400 hover:text-sky-300 transition-colors"
                    >
                      <Plus size={10} /> Add
                    </button>
                  )}
                </div>
                {agentWns.length === 0 && !showAddWn ? (
                  <p className="text-[11px] text-slate-500 italic">No additional writing numbers</p>
                ) : (
                  <div className="space-y-1">
                    {agentWns.map((wn) => (
                      <div key={wn.id} className="flex items-center justify-between bg-slate-700/30 rounded px-2 py-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-medium text-slate-400 uppercase">{wn.carrier_name}</span>
                          <span className="text-[11px] text-slate-300 font-mono">{wn.writing_number}</span>
                        </div>
                        <button onClick={() => handleRemoveWn(wn.id)} className="text-slate-500 hover:text-rose-400 transition-colors">
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {showAddWn && (
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      type="text"
                      placeholder="Carrier (e.g. GTL)"
                      value={wnCarrier}
                      onChange={(e) => setWnCarrier(e.target.value)}
                      className="flex-1 px-2 py-1 text-xs bg-slate-700/50 border border-slate-600/50 rounded text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
                    />
                    <input
                      type="text"
                      placeholder="Writing Number"
                      value={wnNumber}
                      onChange={(e) => setWnNumber(e.target.value)}
                      className="flex-1 px-2 py-1 text-xs bg-slate-700/50 border border-slate-600/50 rounded text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
                    />
                    <button
                      onClick={handleAddWritingNumber}
                      disabled={saving || !wnCarrier || !wnNumber}
                      className="px-2 py-1 text-xs bg-sky-600 hover:bg-sky-500 text-white rounded disabled:opacity-50 transition-colors"
                    >
                      Save
                    </button>
                    <button onClick={() => setShowAddWn(false)} className="px-2 py-1 text-xs text-slate-400 hover:text-white transition-colors">
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function AddAgentModal({
  token,
  onClose,
  onSuccess,
  overrideAgencyId,
}: {
  token: string;
  onClose: () => void;
  onSuccess: () => void;
  overrideAgencyId?: string;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [writingNumber, setWritingNumber] = useState("");
  const [npn, setNpn] = useState("");
  const [carrier, setCarrier] = useState("UNL");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName || !lastName || !writingNumber) {
      setError("First name, last name, and writing number are required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await agencyAddRosterEntry(token, firstName, lastName, writingNumber, npn, carrier, overrideAgencyId);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add agent");
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 max-w-md w-full">
        <h3 className="text-white font-semibold mb-4">Add Agent to Roster</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-slate-400 uppercase tracking-wider mb-1">First Name *</label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-slate-700/50 border border-slate-600/50 rounded-lg text-white focus:outline-none focus:border-sky-500/50"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-400 uppercase tracking-wider mb-1">Last Name *</label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-slate-700/50 border border-slate-600/50 rounded-lg text-white focus:outline-none focus:border-sky-500/50"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 uppercase tracking-wider mb-1">UNL Writing Number *</label>
            <input
              type="text"
              value={writingNumber}
              onChange={(e) => setWritingNumber(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-slate-700/50 border border-slate-600/50 rounded-lg text-white font-mono focus:outline-none focus:border-sky-500/50"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-slate-400 uppercase tracking-wider mb-1">NPN</label>
              <input
                type="text"
                value={npn}
                onChange={(e) => setNpn(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-slate-700/50 border border-slate-600/50 rounded-lg text-white focus:outline-none focus:border-sky-500/50"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-400 uppercase tracking-wider mb-1">Carrier</label>
              <select
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-slate-700/50 border border-slate-600/50 rounded-lg text-white focus:outline-none focus:border-sky-500/50"
              >
                <option value="UNL">UNL</option>
                <option value="GTL">GTL</option>
              </select>
            </div>
          </div>
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <div className="flex items-center gap-2 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg disabled:opacity-50 transition-colors"
            >
              {saving ? "Adding..." : "Add Agent"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 text-sm font-medium text-slate-300 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
