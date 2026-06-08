import { useState, useEffect, useCallback } from "react";
import {
  Megaphone,
  Plus,
  Pencil,
  Trash2,
  Power,
  PowerOff,
  Loader2,
  Calendar,
  Target,
  Gift,
  X,
  Hash,
} from "lucide-react";
import {
  adminGetPromotions,
  adminCreatePromotion,
  adminUpdatePromotion,
  adminDeletePromotion,
  adminTogglePromotion,
} from "../../lib/api";
import ConfirmDialog from "../ui/ConfirmDialog";

interface Promotion {
  id: string;
  title: string;
  goal: string;
  goal_tokens: number;
  incentive: string;
  message: string | null;
  start_date: string;
  end_date: string;
  is_active: boolean;
  period_type: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface PromotionFormData {
  period_type: string;
  title: string;
  goal_tokens: string;
  incentive: string;
  message: string;
  start_date: string;
  end_date: string;
  sort_order: string;
}

const EMPTY_FORM: PromotionFormData = {
  period_type: "weekly",
  title: "",
  goal_tokens: "",
  incentive: "",
  message: "",
  start_date: "",
  end_date: "",
  sort_order: "1",
};

const PERIOD_OPTIONS = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

const PERIOD_COLORS: Record<string, string> = {
  daily: "bg-orange-500/10 text-orange-300 border-orange-500/30",
  weekly: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  monthly: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  yearly: "bg-amber-500/10 text-amber-300 border-amber-500/30",
};

interface PromotionsPanelProps {
  token: string;
}

export default function PromotionsPanel({ token }: PromotionsPanelProps) {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<PromotionFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const fetchPromotions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminGetPromotions(token);
      setPromotions(res.promotions || []);
    } catch (err) {
      console.error("Failed to fetch promotions:", err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchPromotions();
  }, [fetchPromotions]);

  function openCreate() {
    setEditingId(null);
    setFormData(EMPTY_FORM);
    setShowForm(true);
  }

  function openEdit(promo: Promotion) {
    setEditingId(promo.id);
    setFormData({
      period_type: promo.period_type,
      title: promo.title,
      goal_tokens: String(promo.goal_tokens),
      incentive: promo.incentive,
      message: promo.message || "",
      start_date: promo.start_date.slice(0, 16),
      end_date: promo.end_date.slice(0, 16),
      sort_order: String(promo.sort_order),
    });
    setShowForm(true);
  }

  async function handleSave() {
    if (!formData.title || !formData.goal_tokens || !formData.incentive || !formData.start_date || !formData.end_date) return;
    setSaving(true);
    try {
      const payload = {
        title: formData.title,
        goal_tokens: Number(formData.goal_tokens),
        incentive: formData.incentive,
        start_date: formData.start_date,
        end_date: formData.end_date,
        message: formData.message || undefined,
        period_type: formData.period_type,
        sort_order: Number(formData.sort_order) || 0,
      };
      if (editingId) {
        await adminUpdatePromotion(token, { id: editingId, ...payload });
      } else {
        await adminCreatePromotion(token, payload);
      }
      setShowForm(false);
      setEditingId(null);
      setFormData(EMPTY_FORM);
      await fetchPromotions();
    } catch (err) {
      console.error("Failed to save promotion:", err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await adminDeletePromotion(token, id);
      setConfirmDelete(null);
      await fetchPromotions();
    } catch (err) {
      console.error("Failed to delete promotion:", err);
    }
  }

  async function handleToggle(id: string, activate: boolean) {
    try {
      await adminTogglePromotion(token, id, activate);
      await fetchPromotions();
    } catch (err) {
      console.error("Failed to toggle promotion:", err);
    }
  }

  function getStatus(promo: Promotion): { label: string; color: string } {
    const now = new Date();
    const start = new Date(promo.start_date);
    const end = new Date(promo.end_date);
    if (promo.is_active && now >= start && now <= end) {
      return { label: "Active", color: "bg-emerald-900/30 text-emerald-300 border border-emerald-700/50" };
    }
    if (promo.is_active && now > end) {
      return { label: "Expired", color: "bg-red-900/30 text-red-400 border border-red-700/50" };
    }
    if (promo.is_active && now < start) {
      return { label: "Scheduled", color: "bg-blue-900/30 text-blue-300 border border-blue-700/50" };
    }
    if (!promo.is_active && now > end) {
      return { label: "Ended", color: "bg-navy-light text-slate-400 border border-slate-700/50" };
    }
    return { label: "Draft", color: "bg-amber-900/30 text-amber-300 border border-amber-700/50" };
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-gold" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gold/10 flex items-center justify-center">
            <Megaphone size={20} className="text-gold" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">
              Promotions & Incentives
            </h2>
            <p className="text-sm text-slate-400">
              Create token goal campaigns with rewards for each period
            </p>
          </div>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-gold text-navy-dark text-sm font-medium rounded-lg hover:bg-gold-light transition-colors"
        >
          <Plus size={16} />
          New Promotion
        </button>
      </div>

      {/* Active promotions summary */}
      {promotions.filter((p) => p.is_active).length > 0 && (
        <div className="bg-gradient-to-r from-emerald-900/20 to-gold/5 border border-emerald-700/40 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Power size={14} className="text-emerald-400" />
            <span className="text-xs font-bold text-emerald-300 uppercase tracking-wider">
              Currently Active ({promotions.filter((p) => p.is_active).length})
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {promotions
              .filter((p) => p.is_active)
              .map((promo) => (
                <div key={promo.id} className="bg-navy/40 rounded-lg p-3 border border-slate-700/40">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded border ${PERIOD_COLORS[promo.period_type] || PERIOD_COLORS.weekly}`}>
                      {promo.period_type}
                    </span>
                    <span className="text-xs text-slate-500">#{promo.sort_order}</span>
                  </div>
                  <p className="text-sm font-semibold text-white">{promo.title}</p>
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-400">
                    <span className="flex items-center gap-1">
                      <Target size={10} className="text-gold" />
                      {promo.goal_tokens.toLocaleString()} tokens
                    </span>
                    <span className="flex items-center gap-1">
                      <Gift size={10} className="text-gold" />
                      {promo.incentive}
                    </span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Promotions list */}
      {promotions.length === 0 ? (
        <div className="text-center py-16 bg-navy-light/50 rounded-xl border border-dashed border-slate-700/50">
          <Megaphone size={40} className="mx-auto text-slate-500 mb-3" />
          <p className="text-slate-400 font-medium">No promotions yet</p>
          <p className="text-sm text-slate-400 mt-1">
            Create your first promotion to motivate your agents
          </p>
        </div>
      ) : (
        <div className="bg-navy rounded-xl border border-slate-700/50 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-navy-light/50 border-b border-slate-700/50">
                <th className="text-left px-5 py-3 font-medium text-gold/80 text-xs uppercase tracking-wider">
                  #
                </th>
                <th className="text-left px-5 py-3 font-medium text-gold/80 text-xs uppercase tracking-wider">
                  Period
                </th>
                <th className="text-left px-5 py-3 font-medium text-gold/80 text-xs uppercase tracking-wider">
                  Promotion
                </th>
                <th className="text-left px-5 py-3 font-medium text-gold/80 text-xs uppercase tracking-wider">
                  Goal
                </th>
                <th className="text-left px-5 py-3 font-medium text-gold/80 text-xs uppercase tracking-wider">
                  Duration
                </th>
                <th className="text-left px-5 py-3 font-medium text-gold/80 text-xs uppercase tracking-wider">
                  Status
                </th>
                <th className="text-right px-5 py-3 font-medium text-gold/80 text-xs uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {promotions.map((promo) => {
                const status = getStatus(promo);
                return (
                  <tr
                    key={promo.id}
                    className="hover:bg-navy-light/30 transition-colors"
                  >
                    <td className="px-5 py-4 text-sm text-slate-400 font-mono">
                      {promo.sort_order}
                    </td>
                    <td className="px-5 py-4">
                      <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded border ${PERIOD_COLORS[promo.period_type] || PERIOD_COLORS.weekly}`}>
                        {promo.period_type}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-medium text-white">{promo.title}</p>
                      <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">
                        {promo.incentive}
                      </p>
                    </td>
                    <td className="px-5 py-4">
                      <span className="text-sm text-white font-semibold">
                        {promo.goal_tokens.toLocaleString()}
                      </span>
                      <span className="text-xs text-slate-400 ml-1">tokens</span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1.5 text-sm text-slate-300">
                        <Calendar size={14} className="text-slate-400" />
                        {formatDate(promo.start_date)}
                      </div>
                      <div className="text-sm text-slate-400 mt-0.5 ml-5">
                        to {formatDate(promo.end_date)}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${status.color}`}
                      >
                        {status.label}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleToggle(promo.id, !promo.is_active)}
                          className={`p-2 rounded-lg transition-colors ${
                            promo.is_active
                              ? "text-amber-400 hover:bg-amber-900/30"
                              : "text-emerald-400 hover:bg-emerald-900/30"
                          }`}
                          title={promo.is_active ? "Deactivate" : "Activate"}
                        >
                          {promo.is_active ? (
                            <PowerOff size={16} />
                          ) : (
                            <Power size={16} />
                          )}
                        </button>
                        <button
                          onClick={() => openEdit(promo)}
                          className="p-2 rounded-lg text-slate-400 hover:bg-navy-light transition-colors"
                          title="Edit"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          onClick={() => setConfirmDelete(promo.id)}
                          className="p-2 rounded-lg text-red-400 hover:bg-red-900/30 transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-navy rounded-2xl shadow-2xl w-full max-w-lg border border-slate-700/50">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/30">
              <h3 className="text-lg font-semibold text-white">
                {editingId ? "Edit Promotion" : "Create Promotion"}
              </h3>
              <button
                onClick={() => setShowForm(false)}
                className="p-1.5 rounded-lg hover:bg-navy-light transition-colors"
              >
                <X size={18} className="text-slate-400" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-1">
                    Period
                  </label>
                  <select
                    value={formData.period_type}
                    onChange={(e) => setFormData({ ...formData, period_type: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gold focus:border-transparent bg-navy-light text-white"
                  >
                    {PERIOD_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-1">
                    <span className="flex items-center gap-1.5">
                      <Hash size={14} className="text-gold" />
                      Sort Order
                    </span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={formData.sort_order}
                    onChange={(e) => setFormData({ ...formData, sort_order: e.target.value })}
                    placeholder="1"
                    className="w-full px-3 py-2 border border-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gold focus:border-transparent bg-navy-light text-white"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-200 mb-1">
                  Title
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="e.g. May Madness Sprint"
                  className="w-full px-3 py-2 border border-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gold focus:border-transparent bg-navy-light text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-200 mb-1">
                  <span className="flex items-center gap-1.5">
                    <Target size={14} className="text-gold" />
                    Goal (tokens required)
                  </span>
                </label>
                <input
                  type="number"
                  min="0"
                  value={formData.goal_tokens}
                  onChange={(e) => setFormData({ ...formData, goal_tokens: e.target.value })}
                  placeholder="e.g. 500"
                  className="w-full px-3 py-2 border border-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gold focus:border-transparent bg-navy-light text-white"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Tokens the agent must earn within the start/end date window
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-200 mb-1">
                  <span className="flex items-center gap-1.5">
                    <Gift size={14} className="text-gold" />
                    Incentive
                  </span>
                </label>
                <textarea
                  value={formData.incentive}
                  onChange={(e) => setFormData({ ...formData, incentive: e.target.value })}
                  placeholder="e.g. $500 bonus + PTO day"
                  rows={2}
                  className="w-full px-3 py-2 border border-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gold focus:border-transparent bg-navy-light text-white resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-200 mb-1">
                  Message (automation)
                </label>
                <textarea
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                  placeholder="e.g. Congrats! You hit the goal -- your reward is on the way!"
                  rows={2}
                  className="w-full px-3 py-2 border border-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gold focus:border-transparent bg-navy-light text-white resize-none"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Sent via Zap when triggered. Not displayed on the leaderboard.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-1">
                    Start Date
                  </label>
                  <input
                    type="datetime-local"
                    value={formData.start_date}
                    onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gold focus:border-transparent bg-navy-light text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-1">
                    End Date
                  </label>
                  <input
                    type="datetime-local"
                    value={formData.end_date}
                    onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gold focus:border-transparent bg-navy-light text-white"
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-700/30">
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-sm font-medium text-slate-300 hover:bg-navy-light rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !formData.title || !formData.goal_tokens || !formData.incentive || !formData.start_date || !formData.end_date}
                className="flex items-center gap-2 px-4 py-2 bg-gold text-navy-dark text-sm font-medium rounded-lg hover:bg-gold-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {editingId ? "Update" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete */}
      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete Promotion"
        message="Are you sure you want to delete this promotion? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
