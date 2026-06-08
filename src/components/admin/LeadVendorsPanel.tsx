import { useState, useEffect } from "react";
import { Plus, Pencil, Trash2, Check, X, ToggleLeft, ToggleRight, Loader2 } from "lucide-react";
import {
  adminGetLeadVendors,
  adminCreateLeadVendor,
  adminUpdateLeadVendor,
  adminDeleteLeadVendor,
  adminToggleLeadForm,
  adminGetLeadFormStatus,
} from "../../lib/api";

interface Vendor {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

export default function LeadVendorsPanel({ token }: { token: string }) {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [formEnabled, setFormEnabled] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [newVendor, setNewVendor] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [error, setError] = useState("");

  const loadData = async () => {
    try {
      const [vendorsRes, statusRes] = await Promise.all([
        adminGetLeadVendors(token),
        adminGetLeadFormStatus(token),
      ]);
      setVendors(vendorsRes.vendors || []);
      setFormEnabled(statusRes.enabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [token]);

  const handleToggle = async () => {
    setToggling(true);
    try {
      await adminToggleLeadForm(token, !formEnabled);
      setFormEnabled(!formEnabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Toggle failed");
    } finally {
      setToggling(false);
    }
  };

  const handleAdd = async () => {
    if (!newVendor.trim()) return;
    setAdding(true);
    setError("");
    try {
      const res = await adminCreateLeadVendor(token, newVendor.trim());
      setVendors((prev) => [...prev, res.vendor].sort((a, b) => a.name.localeCompare(b.name)));
      setNewVendor("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add vendor");
    } finally {
      setAdding(false);
    }
  };

  const handleSaveEdit = async (id: string) => {
    if (!editValue.trim()) return;
    setError("");
    try {
      const res = await adminUpdateLeadVendor(token, id, { name: editValue.trim() });
      setVendors((prev) => prev.map((v) => (v.id === id ? res.vendor : v)).sort((a, b) => a.name.localeCompare(b.name)));
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    }
  };

  const handleToggleActive = async (vendor: Vendor) => {
    setError("");
    try {
      const res = await adminUpdateLeadVendor(token, vendor.id, { is_active: !vendor.is_active });
      setVendors((prev) => prev.map((v) => (v.id === vendor.id ? res.vendor : v)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    }
  };

  const handleDelete = async (id: string) => {
    setError("");
    try {
      await adminDeleteLeadVendor(token, id);
      setVendors((prev) => prev.map((v) => (v.id === id ? { ...v, is_active: false } : v)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  const activeVendors = vendors.filter((v) => v.is_active);
  const inactiveVendors = vendors.filter((v) => !v.is_active);

  return (
    <div className="space-y-6">
      {/* Form Toggle */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-800">Lead Form Visibility</h3>
            <p className="text-sm text-slate-500 mt-0.5">
              {formEnabled ? "The lead form is visible to FYM agents" : "The lead form is hidden from all users"}
            </p>
          </div>
          <button
            onClick={handleToggle}
            disabled={toggling}
            className="flex items-center gap-2 px-4 py-2 rounded-lg transition-all font-medium text-sm"
            style={{
              background: formEnabled ? "#ecfdf5" : "#f1f5f9",
              color: formEnabled ? "#059669" : "#64748b",
            }}
          >
            {toggling ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : formEnabled ? (
              <ToggleRight className="w-5 h-5" />
            ) : (
              <ToggleLeft className="w-5 h-5" />
            )}
            {formEnabled ? "Enabled" : "Disabled"}
          </button>
        </div>
      </div>

      {/* Add Vendor */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="font-semibold text-slate-800 mb-3">Lead Vendors</h3>
        <p className="text-sm text-slate-500 mb-4">Manage the dropdown options shown to agents in the lead form.</p>

        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={newVendor}
            onChange={(e) => setNewVendor(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder="New vendor name"
            className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
          <button
            onClick={handleAdd}
            disabled={adding || !newVendor.trim()}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-all flex items-center gap-1"
          >
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Active vendors */}
        {activeVendors.length > 0 && (
          <div className="space-y-1">
            {activeVendors.map((vendor) => (
              <div key={vendor.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50 group">
                {editingId === vendor.id ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveEdit(vendor.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="flex-1 px-2 py-1 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      autoFocus
                    />
                    <button onClick={() => handleSaveEdit(vendor.id)} className="text-emerald-600 hover:text-emerald-700">
                      <Check className="w-4 h-4" />
                    </button>
                    <button onClick={() => setEditingId(null)} className="text-slate-400 hover:text-slate-600">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="text-sm text-slate-700">{vendor.name}</span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => { setEditingId(vendor.id); setEditValue(vendor.name); }}
                        className="p-1 text-slate-400 hover:text-blue-600 rounded"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleToggleActive(vendor)}
                        className="p-1 text-slate-400 hover:text-amber-600 rounded"
                        title="Deactivate"
                      >
                        <ToggleRight className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(vendor.id)}
                        className="p-1 text-slate-400 hover:text-red-600 rounded"
                        title="Deactivate"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {activeVendors.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-4">No vendors configured yet. Add one above.</p>
        )}

        {/* Inactive vendors */}
        {inactiveVendors.length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Inactive</p>
            <div className="space-y-1">
              {inactiveVendors.map((vendor) => (
                <div key={vendor.id} className="flex items-center justify-between py-2 px-3 rounded-lg opacity-50 hover:opacity-100 transition-opacity">
                  <span className="text-sm text-slate-500 line-through">{vendor.name}</span>
                  <button
                    onClick={() => handleToggleActive(vendor)}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                  >
                    Reactivate
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
