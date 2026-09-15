import { useState, useEffect, useCallback } from "react";
import {
  Columns2 as Columns,
  Plus,
  Trash2,
  Save,
  Loader2,
  RefreshCw,
  Search,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  X,
  Edit3,
  Zap,
} from "lucide-react";
import {
  adminListCarrierColumnMappings,
  adminUpsertCarrierColumnMapping,
  adminDeleteCarrierColumnMapping,
  type CarrierColumnMapping,
} from "../../lib/api";

// UNL canonical column names — the standard everything maps TO
const UNL_COLUMNS = [
  { value: "policy_nbr", label: "Policy Number" },
  { value: "first_name", label: "First Name" },
  { value: "last_name", label: "Last Name" },
  { value: "phone_nbr", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "address", label: "Address" },
  { value: "state", label: "State" },
  { value: "zip", label: "Zip" },
  { value: "issue_date", label: "Issue Date" },
  { value: "app_recvd_date", label: "App Received Date" },
  { value: "paid_to_date", label: "Paid To Date" },
  { value: "billing_mode", label: "Billing Mode" },
  { value: "cntrct_code", label: "Contract Code" },
  { value: "cntrct_reason", label: "Contract Reason" },
  { value: "annual_premium", label: "Annual Premium" },
  { value: "plan_code", label: "Plan Code" },
  { value: "mga", label: "MGA" },
  { value: "mga_name", label: "MGA Name" },
  { value: "ga", label: "GA" },
  { value: "ga_name", label: "GA Name" },
  { value: "wa", label: "Writing Agent Code" },
  { value: "wa_name", label: "Writing Agent Name" },
  { value: "agent_ga_level_01", label: "Agent GA Level 01" },
  { value: "agent_ga_level_02", label: "Agent GA Level 02" },
  { value: "agent_ga_level_03", label: "Agent GA Level 03" },
  { value: "agent_ga_level_04", label: "Agent GA Level 04" },
  { value: "agent_ga_level_05", label: "Agent GA Level 05" },
  { value: "agent_ga_level_06", label: "Agent GA Level 06" },
  { value: "agent_ga_level_07", label: "Agent GA Level 07" },
  { value: "agent_ga_level_08", label: "Agent GA Level 08" },
  { value: "agent_ga_level_09", label: "Agent GA Level 09" },
  { value: "agent_ga_level_10", label: "Agent GA Level 10" },
  { value: "at_risk_policy", label: "At Risk Policy" },
  { value: "term_date", label: "Term Date" },
  { value: "issue_state", label: "Issue State" },
  { value: "roster_hierarchy_json", label: "Roster Hierarchy JSON" },
];

const CARRIERS = ["AHL", "GTL", "Heartland", "Manhattan"] as const;
type CarrierTab = (typeof CARRIERS)[number];

interface CarrierColumnMappingPanelProps {
  token: string;
}

export default function CarrierColumnMappingPanel({ token }: CarrierColumnMappingPanelProps) {
  const [activeCarrier, setActiveCarrier] = useState<CarrierTab>("AHL");
  const [mappings, setMappings] = useState<CarrierColumnMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  // Add/edit state
  const [showAddRow, setShowAddRow] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ carrier_column: "", unl_column: "", description: "", needs_transform: false, transform_note: "" });

  // Stats per carrier
  const [carrierCounts, setCarrierCounts] = useState<Record<string, number>>({});

  const fetchMappings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminListCarrierColumnMappings(token);
      setMappings(res.mappings || []);
      // Compute counts per carrier
      const counts: Record<string, number> = {};
      for (const m of res.mappings || []) {
        counts[m.carrier] = (counts[m.carrier] || 0) + 1;
      }
      setCarrierCounts(counts);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchMappings();
  }, [fetchMappings]);

  const carrierMappings = mappings
    .filter((m) => m.carrier === activeCarrier)
    .filter((m) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        m.carrier_column.toLowerCase().includes(q) ||
        m.unl_column.toLowerCase().includes(q) ||
        (m.description || "").toLowerCase().includes(q)
      );
    });

  const handleSave = async () => {
    if (!editForm.carrier_column.trim() || !editForm.unl_column.trim()) return;
    setSaving(true);
    try {
      await adminUpsertCarrierColumnMapping(token, {
        ...(editingId ? { id: editingId } : {}),
        carrier: activeCarrier,
        carrier_column: editForm.carrier_column.trim(),
        unl_column: editForm.unl_column.trim(),
        description: editForm.description.trim(),
        needs_transform: editForm.needs_transform,
        transform_note: editForm.transform_note.trim(),
      });
      setShowAddRow(false);
      setEditingId(null);
      setEditForm({ carrier_column: "", unl_column: "", description: "" });
      await fetchMappings();
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this column mapping?")) return;
    try {
      await adminDeleteCarrierColumnMapping(token, id);
      await fetchMappings();
    } catch {
      /* ignore */
    }
  };

  const startEdit = (m: CarrierColumnMapping) => {
    setEditingId(m.id);
    setEditForm({
      carrier_column: m.carrier_column,
      unl_column: m.unl_column,
      description: m.description || "",
      needs_transform: m.needs_transform || false,
      transform_note: m.transform_note || "",
    });
    setShowAddRow(false);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setShowAddRow(false);
    setEditForm({ carrier_column: "", unl_column: "", description: "", needs_transform: false, transform_note: "" });
  };

  const transformCount = carrierMappings.filter((m) => m.needs_transform).length;

  const unmappedUNLColumns = UNL_COLUMNS.filter(
    (col) => !carrierMappings.some((m) => m.unl_column === col.value)
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Columns size={20} className="text-gold" />
            Carrier Column Mapping
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Map each carrier's source column names to UNL standard columns. Non-UNL data flows through this mapping before reaching production views.
          </p>
        </div>
        <button
          onClick={fetchMappings}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-navy-dark bg-gold rounded-lg hover:bg-gold-light disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Carrier tabs */}
      <div className="flex items-center gap-1 bg-navy rounded-lg border border-slate-700/50 p-1">
        {CARRIERS.map((c) => (
          <button
            key={c}
            onClick={() => {
              setActiveCarrier(c);
              cancelEdit();
            }}
            className={`px-4 py-2 text-xs font-medium rounded-md transition-colors relative ${
              activeCarrier === c
                ? "bg-gold text-navy-dark"
                : "text-slate-400 hover:text-white hover:bg-slate-800/50"
            }`}
          >
            {c}
            {(carrierCounts[c] || 0) > 0 && (
              <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${
                activeCarrier === c
                  ? "bg-navy-dark/20 text-navy-dark"
                  : "bg-slate-700 text-slate-300"
              }`}>
                {carrierCounts[c]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-navy rounded-xl border border-slate-700/50 p-3">
          <div className="flex items-center gap-2 mb-1">
            <Columns size={14} className="text-slate-500" />
            <span className="text-xs text-slate-500">Mapped Columns</span>
          </div>
          <p className="text-lg font-semibold text-white">{carrierMappings.length}</p>
        </div>
        <div className="bg-navy rounded-xl border border-slate-700/50 p-3">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 size={14} className="text-slate-500" />
            <span className="text-xs text-slate-500">UNL Coverage</span>
          </div>
          <p className={`text-lg font-semibold ${
            unmappedUNLColumns.length === 0 ? "text-green-400" : "text-yellow-400"
          }`}>
            {UNL_COLUMNS.length - unmappedUNLColumns.length}/{UNL_COLUMNS.length}
          </p>
        </div>
        <div className="bg-navy rounded-xl border border-slate-700/50 p-3">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={14} className="text-slate-500" />
            <span className="text-xs text-slate-500">Unmapped UNL Cols</span>
          </div>
          <p className={`text-lg font-semibold ${unmappedUNLColumns.length === 0 ? "text-green-400" : "text-amber-400"}`}>
            {unmappedUNLColumns.length}
          </p>
        </div>
        <div className="bg-navy rounded-xl border border-slate-700/50 p-3">
          <div className="flex items-center gap-2 mb-1">
            <Zap size={14} className="text-slate-500" />
            <span className="text-xs text-slate-500">Needs Transform</span>
          </div>
          <p className={`text-lg font-semibold ${transformCount > 0 ? "text-orange-400" : "text-green-400"}`}>
            {transformCount}
          </p>
        </div>
      </div>

      {/* Search + Add */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search columns..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-navy border border-slate-700/50 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-gold/50"
          />
        </div>
        <button
          onClick={() => {
            setShowAddRow(true);
            setEditingId(null);
            setEditForm({ carrier_column: "", unl_column: "", description: "" });
          }}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-navy-dark bg-gold rounded-lg hover:bg-gold-light transition-colors"
        >
          <Plus size={14} />
          Add Mapping
        </button>
      </div>

      {/* Unmapped UNL columns warning */}
      {unmappedUNLColumns.length > 0 && !loading && carrierMappings.length > 0 && (
        <div className="p-3 bg-amber-900/20 border border-amber-700/30 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-amber-300">
                {unmappedUNLColumns.length} UNL column{unmappedUNLColumns.length > 1 ? "s" : ""} not mapped for {activeCarrier}
              </p>
              <p className="text-[10px] text-amber-400/80 mt-1">
                {unmappedUNLColumns.slice(0, 6).map((c) => c.label).join(", ")}
                {unmappedUNLColumns.length > 6 && ` +${unmappedUNLColumns.length - 6} more`}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="bg-navy rounded-xl border border-slate-700/50 p-8 text-center">
          <Loader2 className="animate-spin mx-auto text-gold" size={24} />
          <p className="text-sm text-slate-400 mt-2">Loading mappings...</p>
        </div>
      ) : (
        /* Mapping table */
        <div className="bg-navy rounded-xl border border-slate-700/50 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-navy-light/50 border-b border-slate-700/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gold/80 text-xs uppercase tracking-wider">
                  {activeCarrier} Column
                </th>
                <th className="px-2 py-3 w-8"></th>
                <th className="text-left px-4 py-3 font-medium text-gold/80 text-xs uppercase tracking-wider">
                  UNL Column
                </th>
                <th className="text-left px-4 py-3 font-medium text-gold/80 text-xs uppercase tracking-wider">
                  UNL Label
                </th>
                <th className="text-center px-2 py-3 font-medium text-gold/80 text-xs uppercase tracking-wider w-24">
                  Transform
                </th>
                <th className="text-left px-4 py-3 font-medium text-gold/80 text-xs uppercase tracking-wider">
                  Notes
                </th>
                <th className="px-4 py-3 w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {/* Add new row */}
              {showAddRow && (
                <tr className="bg-gold/5 border-l-2 border-l-gold">
                  <td className="px-4 py-2">
                    <input
                      type="text"
                      value={editForm.carrier_column}
                      onChange={(e) => setEditForm({ ...editForm, carrier_column: e.target.value })}
                      placeholder={`${activeCarrier} column name...`}
                      className="w-full px-2 py-1.5 text-xs font-mono bg-navy-light border border-gold/50 rounded-md text-white focus:outline-none focus:border-gold"
                      autoFocus
                    />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <ArrowRight size={12} className="text-gold mx-auto" />
                  </td>
                  <td className="px-4 py-2">
                    <select
                      value={editForm.unl_column}
                      onChange={(e) => setEditForm({ ...editForm, unl_column: e.target.value })}
                      className="w-full px-2 py-1.5 text-xs bg-navy-light border border-gold/50 rounded-md text-white focus:outline-none focus:border-gold"
                    >
                      <option value="">Select UNL column...</option>
                      {UNL_COLUMNS.map((col) => (
                        <option key={col.value} value={col.value}>
                          {col.value} — {col.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-400">
                    {editForm.unl_column
                      ? UNL_COLUMNS.find((c) => c.value === editForm.unl_column)?.label || "—"
                      : "—"}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => setEditForm({ ...editForm, needs_transform: !editForm.needs_transform })}
                      className={`p-1.5 rounded-md transition-colors ${
                        editForm.needs_transform
                          ? "bg-orange-500/20 text-orange-400 border border-orange-500/50"
                          : "text-slate-500 hover:text-slate-300 border border-slate-700/50"
                      }`}
                      title={editForm.needs_transform ? "Values need transformation" : "Values map directly"}
                    >
                      <Zap size={14} />
                    </button>
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="text"
                      value={editForm.needs_transform ? editForm.transform_note : editForm.description}
                      onChange={(e) => editForm.needs_transform
                        ? setEditForm({ ...editForm, transform_note: e.target.value })
                        : setEditForm({ ...editForm, description: e.target.value })
                      }
                      placeholder={editForm.needs_transform ? "What needs transforming..." : "Optional notes..."}
                      className="w-full px-2 py-1.5 text-xs bg-navy-light border border-slate-600 rounded-md text-white focus:outline-none focus:border-gold/50"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={handleSave}
                        disabled={saving || !editForm.carrier_column.trim() || !editForm.unl_column}
                        className="p-1.5 text-green-400 hover:text-green-300 disabled:opacity-30 transition-colors"
                        title="Save"
                      >
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="p-1.5 text-slate-400 hover:text-red-300 transition-colors"
                        title="Cancel"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              )}

              {/* Existing mappings */}
              {carrierMappings.length === 0 && !showAddRow ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center">
                    <Columns size={24} className="mx-auto text-slate-500 mb-2" />
                    <p className="text-sm text-slate-400">
                      No column mappings for {activeCarrier} yet
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      Click "Add Mapping" to define how {activeCarrier} columns map to UNL standard columns
                    </p>
                  </td>
                </tr>
              ) : (
                carrierMappings.map((m) =>
                  editingId === m.id ? (
                    <tr key={m.id} className="bg-gold/5 border-l-2 border-l-gold">
                      <td className="px-4 py-2">
                        <input
                          type="text"
                          value={editForm.carrier_column}
                          onChange={(e) => setEditForm({ ...editForm, carrier_column: e.target.value })}
                          className="w-full px-2 py-1.5 text-xs font-mono bg-navy-light border border-gold/50 rounded-md text-white focus:outline-none focus:border-gold"
                        />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <ArrowRight size={12} className="text-gold mx-auto" />
                      </td>
                      <td className="px-4 py-2">
                        <select
                          value={editForm.unl_column}
                          onChange={(e) => setEditForm({ ...editForm, unl_column: e.target.value })}
                          className="w-full px-2 py-1.5 text-xs bg-navy-light border border-gold/50 rounded-md text-white focus:outline-none focus:border-gold"
                        >
                          <option value="">Select UNL column...</option>
                          {UNL_COLUMNS.map((col) => (
                            <option key={col.value} value={col.value}>
                              {col.value} — {col.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-400">
                        {editForm.unl_column
                          ? UNL_COLUMNS.find((c) => c.value === editForm.unl_column)?.label || "—"
                          : "—"}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => setEditForm({ ...editForm, needs_transform: !editForm.needs_transform })}
                          className={`p-1.5 rounded-md transition-colors ${
                            editForm.needs_transform
                              ? "bg-orange-500/20 text-orange-400 border border-orange-500/50"
                              : "text-slate-500 hover:text-slate-300 border border-slate-700/50"
                          }`}
                          title={editForm.needs_transform ? "Values need transformation" : "Values map directly"}
                        >
                          <Zap size={14} />
                        </button>
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="text"
                          value={editForm.needs_transform ? editForm.transform_note : editForm.description}
                          onChange={(e) => editForm.needs_transform
                            ? setEditForm({ ...editForm, transform_note: e.target.value })
                            : setEditForm({ ...editForm, description: e.target.value })
                          }
                          placeholder={editForm.needs_transform ? "What needs transforming..." : "Optional notes..."}
                          className="w-full px-2 py-1.5 text-xs bg-navy-light border border-slate-600 rounded-md text-white focus:outline-none focus:border-gold/50"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={handleSave}
                            disabled={saving || !editForm.carrier_column.trim() || !editForm.unl_column}
                            className="p-1.5 text-green-400 hover:text-green-300 disabled:opacity-30 transition-colors"
                          >
                            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="p-1.5 text-slate-400 hover:text-red-300 transition-colors"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={m.id} className={`hover:bg-slate-800/30 transition-colors ${m.needs_transform ? "border-l-2 border-l-orange-500/50" : ""}`}>
                      <td className="px-4 py-2.5">
                        <span className="text-xs font-mono text-slate-200">{m.carrier_column}</span>
                      </td>
                      <td className="px-2 py-2.5 text-center">
                        <ArrowRight size={12} className="text-slate-500 mx-auto" />
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs font-mono text-emerald-300">{m.unl_column}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs text-slate-400">
                          {UNL_COLUMNS.find((c) => c.value === m.unl_column)?.label || "—"}
                        </span>
                      </td>
                      <td className="px-2 py-2.5 text-center">
                        {m.needs_transform ? (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30 cursor-help"
                            title={m.transform_note || "Values need transformation"}
                          >
                            <Zap size={10} />
                            Transform
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs text-slate-500">
                          {m.needs_transform ? m.transform_note || m.description || "—" : m.description || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => startEdit(m)}
                            className="p-1.5 text-slate-400 hover:text-gold transition-colors"
                            title="Edit"
                          >
                            <Edit3 size={13} />
                          </button>
                          <button
                            onClick={() => handleDelete(m.id)}
                            className="p-1.5 text-slate-400 hover:text-red-400 transition-colors"
                            title="Delete"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                )
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Flow diagram */}
      <div className="bg-navy rounded-xl border border-slate-700/50 p-4">
        <p className="text-xs font-medium text-slate-300 mb-3">Data Normalization Flow</p>
        <div className="flex items-center gap-3 text-xs">
          <div className="px-3 py-2 bg-blue-900/30 border border-blue-700/30 rounded-lg text-blue-300 font-medium">
            {activeCarrier} Source
          </div>
          <ArrowRight size={14} className="text-slate-500" />
          <div className="px-3 py-2 bg-gold/10 border border-gold/30 rounded-lg text-gold font-medium">
            Carrier Mapping
          </div>
          <ArrowRight size={14} className="text-slate-500" />
          <div className="px-3 py-2 bg-emerald-900/30 border border-emerald-700/30 rounded-lg text-emerald-300 font-medium">
            UNL Columns
          </div>
          <ArrowRight size={14} className="text-slate-500" />
          <div className="px-3 py-2 bg-purple-900/30 border border-purple-700/30 rounded-lg text-purple-300 font-medium">
            Human Labels
          </div>
          <ArrowRight size={14} className="text-slate-500" />
          <div className="px-3 py-2 bg-slate-800 border border-slate-600/30 rounded-lg text-slate-300 font-medium">
            Production Views
          </div>
        </div>
      </div>
    </div>
  );
}
