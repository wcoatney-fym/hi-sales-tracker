import { useState, useEffect, useCallback } from "react";
import {
  Eye,
  EyeOff,
  Copy,
  Check,
  RefreshCw,
  Loader2,
  Search,
  UserPlus,
  Power,
  X,
} from "lucide-react";
import {
  adminListAgencyManagers,
  adminCreateAgencyManager,
  adminResetAgencyManagerPassword,
  adminToggleAgencyManager,
  adminListAgenciesDirectory,
  adminGetAgents,
} from "../../lib/api";
import type { AgencyManager } from "../../lib/api";
import { useAdminAuth } from "../../hooks/useAdminAuth";

interface AgencyOption {
  id: string;
  name: string;
  slug?: string;
}

interface AgentOption {
  id: string;
  firstName: string;
  lastName: string;
  agency: string;
}

interface AgencyManagersPanelProps {
  token: string;
  // When set (e.g. FYM viewing a specific agency), force-scope the list to this
  // agency. Agency admins are already auto-scoped server-side.
  scopeAgencyId?: string | null;
}

export default function AgencyManagersPanel({ token, scopeAgencyId }: AgencyManagersPanelProps) {
  const { isGlobalAdmin, agencyId: adminAgencyId } = useAdminAuth();

  const [managers, setManagers] = useState<AgencyManager[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  // Global admins can filter the password log by agency; agency admins are auto-scoped.
  const [agencyFilter, setAgencyFilter] = useState<string>("");

  const fetchManagers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminListAgencyManagers(
        token,
        scopeAgencyId || (isGlobalAdmin && agencyFilter ? agencyFilter : undefined)
      );
      setManagers((res.managers as AgencyManager[]) || []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load managers");
    } finally {
      setLoading(false);
    }
  }, [token, isGlobalAdmin, agencyFilter, scopeAgencyId]);

  useEffect(() => {
    fetchManagers();
  }, [fetchManagers]);

  const toggleVisible = (id: string) => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleReset = async (id: string) => {
    if (!confirm("Generate a new password for this manager? The old one stops working immediately.")) return;
    setResettingId(id);
    try {
      const res = await adminResetAgencyManagerPassword(token, id);
      const newPassword = res.password as string;
      setManagers((prev) => prev.map((m) => (m.id === id ? { ...m, password: newPassword } : m)));
      setVisible((prev) => new Set([...prev, id]));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to reset password");
    } finally {
      setResettingId(null);
    }
  };

  const handleToggle = async (m: AgencyManager) => {
    const next = !m.is_active;
    setTogglingId(m.id);
    try {
      await adminToggleAgencyManager(token, m.id, next);
      setManagers((prev) => prev.map((x) => (x.id === m.id ? { ...x, is_active: next } : x)));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setTogglingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="animate-spin text-gold" size={28} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-400 text-sm">{error}</p>
        <button onClick={fetchManagers} className="mt-3 text-xs text-gold hover:underline">
          Retry
        </button>
      </div>
    );
  }

  const query = search.toLowerCase().trim();
  const filtered = query
    ? managers.filter(
        (m) =>
          m.username.toLowerCase().includes(query) ||
          m.display_name.toLowerCase().includes(query) ||
          (m.agency_name || "").toLowerCase().includes(query)
      )
    : managers;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-400 max-w-xl">
          Per-person agency manager logins (separate from the agent roster). Passwords are
          shown here as a log so they can be resent or reset.
        </p>
        <button
          onClick={() => setShowCreate(true)}
          className="btn-primary flex items-center gap-2 text-sm !px-4 !py-2 shrink-0"
        >
          <UserPlus size={15} />
          Add Manager
        </button>
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search managers..."
            className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-gold/60"
          />
        </div>
        {isGlobalAdmin && (
          <AgencyFilterSelect token={token} value={agencyFilter} onChange={setAgencyFilter} />
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm">
          {query ? `No managers match "${search.trim()}"` : "No agency managers yet."}
        </div>
      ) : (
        <div className="grid gap-4">
          {filtered.map((m) => {
            const isVisible = visible.has(m.id);
            return (
              <div
                key={m.id}
                className={`bg-navy border rounded-xl p-5 transition-colors ${
                  m.is_active ? "border-slate-700/50 hover:border-slate-600/70" : "border-slate-800 opacity-70"
                }`}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="min-w-0">
                    <h3 className="text-white font-semibold text-sm truncate">{m.display_name}</h3>
                    {m.agency_name && (
                      <p className="text-[11px] text-slate-500 mt-0.5">{m.agency_name}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {!m.is_active && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">
                        Inactive
                      </span>
                    )}
                    {m.agent_id && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">
                        Promoted agent
                      </span>
                    )}
                    <button
                      onClick={() => handleToggle(m)}
                      disabled={togglingId === m.id}
                      className={`p-2 rounded-lg transition-colors disabled:opacity-50 ${
                        m.is_active ? "text-emerald-400 hover:bg-slate-800" : "text-slate-500 hover:bg-slate-800"
                      }`}
                      title={m.is_active ? "Deactivate manager" : "Activate manager"}
                    >
                      {togglingId === m.id ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />}
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">Username</label>
                      <p className="text-sm text-slate-200 font-mono mt-0.5">{m.username}</p>
                    </div>
                    <button
                      onClick={() => copy(m.username, `u-${m.id}`)}
                      className="p-2 text-slate-400 hover:text-gold rounded-lg hover:bg-slate-800"
                      title="Copy username"
                    >
                      {copiedId === `u-${m.id}` ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                    </button>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <label className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">Password</label>
                      <p className="text-sm text-slate-200 font-mono mt-0.5">
                        {isVisible ? m.password : "\u2022".repeat(12)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 ml-3">
                      <button
                        onClick={() => toggleVisible(m.id)}
                        className="p-2 text-slate-400 hover:text-gold rounded-lg hover:bg-slate-800"
                        title={isVisible ? "Hide password" : "Show password"}
                      >
                        {isVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                      <button
                        onClick={() => copy(m.password, `p-${m.id}`)}
                        className="p-2 text-slate-400 hover:text-gold rounded-lg hover:bg-slate-800"
                        title="Copy password"
                      >
                        {copiedId === `p-${m.id}` ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                      </button>
                      <button
                        onClick={() => handleReset(m.id)}
                        disabled={resettingId === m.id}
                        className="p-2 text-slate-400 hover:text-amber-400 rounded-lg hover:bg-slate-800 disabled:opacity-50"
                        title="Generate new password"
                      >
                        {resettingId === m.id ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCreate && (
        <CreateManagerModal
          token={token}
          isGlobalAdmin={isGlobalAdmin}
          adminAgencyId={adminAgencyId}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            fetchManagers();
          }}
        />
      )}
    </div>
  );
}

function normalizeAgencies(result: unknown): AgencyOption[] {
  if (Array.isArray(result)) return result as AgencyOption[];
  if (result && typeof result === "object" && "agencies" in result) {
    const list = (result as { agencies?: AgencyOption[] }).agencies;
    return Array.isArray(list) ? list : [];
  }
  return [];
}

function AgencyFilterSelect({
  token,
  value,
  onChange,
}: {
  token: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [agencies, setAgencies] = useState<AgencyOption[]>([]);

  useEffect(() => {
    adminListAgenciesDirectory(token)
      .then((res) => setAgencies(normalizeAgencies(res)))
      .catch(() => {});
  }, [token]);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-gold/60"
    >
      <option value="">All agencies</option>
      {agencies.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
  );
}

function CreateManagerModal({
  token,
  isGlobalAdmin,
  adminAgencyId,
  onClose,
  onCreated,
}: {
  token: string;
  isGlobalAdmin: boolean;
  adminAgencyId: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [mode, setMode] = useState<"promote" | "nonagent">("promote");
  const [agencyId, setAgencyId] = useState<string>(isGlobalAdmin ? "" : adminAgencyId || "");
  const [agencies, setAgencies] = useState<AgencyOption[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agentId, setAgentId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null);

  useEffect(() => {
    if (isGlobalAdmin) {
      adminListAgenciesDirectory(token).then((res) => setAgencies(normalizeAgencies(res))).catch(() => {});
    }
    adminGetAgents(token)
      .then((res) => setAgents((res.agents as AgentOption[]) || []))
      .catch(() => {});
  }, [token, isGlobalAdmin]);

  const handleSave = async () => {
    setError("");
    if (isGlobalAdmin && !agencyId) {
      setError("Select an agency.");
      return;
    }
    if (mode === "promote" && !agentId) {
      setError("Select an agent to promote.");
      return;
    }
    if (mode === "nonagent" && !displayName.trim()) {
      setError("Enter a display name.");
      return;
    }
    setSaving(true);
    try {
      const res = await adminCreateAgencyManager(token, {
        agencyId: isGlobalAdmin ? agencyId : undefined,
        agentId: mode === "promote" ? agentId : undefined,
        displayName: mode === "nonagent" ? displayName.trim() : undefined,
      });
      const mgr = (res.manager || {}) as { username?: string; password?: string };
      setCreated({ username: mgr.username || "", password: mgr.password || "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create manager");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-navy-light border border-slate-700 rounded-xl p-6 w-full max-w-md shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold">Add Agency Manager</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        {created ? (
          <div className="space-y-4">
            <p className="text-sm text-emerald-400">Manager created. Share these credentials:</p>
            <div className="bg-navy border border-slate-700 rounded-lg p-4 space-y-2">
              <p className="text-xs text-slate-400">
                Username: <span className="text-white font-mono">{created.username}</span>
              </p>
              <p className="text-xs text-slate-400">
                Password: <span className="text-white font-mono">{created.password}</span>
              </p>
            </div>
            <button onClick={onCreated} className="btn-primary w-full">
              Done
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {isGlobalAdmin && (
              <div>
                <label className="block text-xs text-slate-400 mb-1.5 font-medium">Agency</label>
                <select
                  value={agencyId}
                  onChange={(e) => setAgencyId(e.target.value)}
                  className="w-full bg-navy border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gold"
                >
                  <option value="">Select an agency...</option>
                  {agencies.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setMode("promote")}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                  mode === "promote" ? "bg-gold/15 border-gold/30 text-gold" : "bg-navy border-slate-600/50 text-slate-400"
                }`}
              >
                Promote Agent
              </button>
              <button
                onClick={() => setMode("nonagent")}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                  mode === "nonagent" ? "bg-gold/15 border-gold/30 text-gold" : "bg-navy border-slate-600/50 text-slate-400"
                }`}
              >
                Add Non-Agent
              </button>
            </div>

            {mode === "promote" ? (
              <div>
                <label className="block text-xs text-slate-400 mb-1.5 font-medium">Agent</label>
                <select
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  className="w-full bg-navy border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gold"
                >
                  <option value="">Select an agent...</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.firstName} {a.lastName}
                      {a.agency ? ` - ${a.agency}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-xs text-slate-400 mb-1.5 font-medium">Display Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Jane Manager"
                  className="w-full bg-navy border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-gold"
                />
              </div>
            )}

            {error && <p className="text-sm text-red-400">{error}</p>}

            <div className="flex gap-3 pt-2">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-slate-600 rounded-lg text-slate-300 text-sm hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 btn-primary flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                Create
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
