import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, Copy, Check, RefreshCw, Pencil, X, Save, Loader2, Search, LayoutDashboard } from "lucide-react";
import {
  adminGetAgencyCredentials,
  adminUpdateAgencyCredential,
  adminResetAgencyCredential,
} from "../../lib/api";

interface Credential {
  id: string;
  username: string;
  password: string;
  agency_id: string;
  agency_name: string;
  agency_slug: string;
  session_duration_days: number;
}

interface AgencyCredentialsPanelProps {
  token: string;
}

function AgencyCredentialsPanel({ token }: AgencyCredentialsPanelProps) {
  const navigate = useNavigate();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPassword, setEditPassword] = useState("");
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchCredentials = useCallback(async () => {
    try {
      setLoading(true);
      const result = await adminGetAgencyCredentials(token);
      setCredentials(result.credentials || []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load credentials");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchCredentials();
  }, [fetchCredentials]);

  const togglePassword = (id: string) => {
    setVisiblePasswords((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleReset = async (id: string) => {
    if (!confirm("Generate a new random password for this agency? The old password will stop working immediately.")) return;
    setResettingId(id);
    try {
      const result = await adminResetAgencyCredential(token, id);
      setCredentials((prev) =>
        prev.map((c) => (c.id === id ? { ...c, password: result.newPassword } : c))
      );
      setVisiblePasswords((prev) => new Set([...prev, id]));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to reset");
    } finally {
      setResettingId(null);
    }
  };

  const startEdit = (cred: Credential) => {
    setEditingId(cred.id);
    setEditPassword(cred.password);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditPassword("");
  };

  const saveEdit = async (id: string) => {
    if (!editPassword.trim()) return;
    setSavingId(id);
    try {
      await adminUpdateAgencyCredential(token, id, editPassword.trim());
      setCredentials((prev) =>
        prev.map((c) => (c.id === id ? { ...c, password: editPassword.trim() } : c))
      );
      setEditingId(null);
      setEditPassword("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setSavingId(null);
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
        <button onClick={fetchCredentials} className="mt-3 text-xs text-gold hover:underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Login credentials for agency admin portals. Share the username and password with agency contacts when they request access.
      </p>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search agencies..."
          className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-gold/60 transition-colors"
        />
      </div>

      {(() => {
        const query = searchQuery.toLowerCase().trim();
        const filtered = query
          ? credentials.filter(
              (c) =>
                c.agency_name.toLowerCase().includes(query) ||
                c.username.toLowerCase().includes(query) ||
                c.agency_slug.toLowerCase().includes(query)
            )
          : credentials;

        if (filtered.length === 0 && query) {
          return (
            <div className="text-center py-12 text-slate-500 text-sm">
              No agencies match "{searchQuery.trim()}"
            </div>
          );
        }

        return (
          <>
            {query && (
              <p className="text-xs text-slate-500">
                Showing {filtered.length} of {credentials.length} agencies
              </p>
            )}
            <div className="grid gap-4">
        {filtered.map((cred) => {
          const isVisible = visiblePasswords.has(cred.id);
          const isEditing = editingId === cred.id;
          const isCopied = copiedId === cred.id;
          const isResetting = resettingId === cred.id;
          const isSaving = savingId === cred.id;

          return (
            <div
              key={cred.id}
              className="bg-navy border border-slate-700/50 rounded-xl p-5 hover:border-slate-600/70 transition-colors"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-semibold text-sm">{cred.agency_name}</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => navigate(`/admin/dashboard/${cred.agency_slug}`, { state: { agencyName: cred.agency_name, agencyId: cred.agency_id } })}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gold bg-gold/10 hover:bg-gold/20 rounded-lg transition-colors"
                    title="View this agency's dashboard"
                  >
                    <LayoutDashboard size={13} />
                    View as Admin
                  </button>
                  <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded">
                    /{cred.agency_slug}
                  </span>
                </div>
              </div>

              <div className="space-y-3">
                {/* Username */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">Username</label>
                    <p className="text-sm text-slate-200 font-mono mt-0.5">{cred.username}</p>
                  </div>
                  <button
                    onClick={() => copyToClipboard(cred.username, `user-${cred.id}`)}
                    className="p-2 text-slate-400 hover:text-gold rounded-lg hover:bg-slate-800 transition-colors"
                    title="Copy username"
                  >
                    {copiedId === `user-${cred.id}` ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                  </button>
                </div>

                {/* Password */}
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <label className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">Password</label>
                    {isEditing ? (
                      <div className="flex items-center gap-2 mt-0.5">
                        <input
                          type="text"
                          value={editPassword}
                          onChange={(e) => setEditPassword(e.target.value)}
                          className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-white font-mono focus:outline-none focus:border-gold"
                          autoFocus
                        />
                        <button
                          onClick={() => saveEdit(cred.id)}
                          disabled={isSaving}
                          className="p-1.5 text-green-400 hover:bg-slate-800 rounded transition-colors disabled:opacity-50"
                          title="Save"
                        >
                          {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="p-1.5 text-slate-400 hover:bg-slate-800 rounded transition-colors"
                          title="Cancel"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-200 font-mono mt-0.5">
                        {isVisible ? cred.password : "\u2022".repeat(12)}
                      </p>
                    )}
                  </div>

                  {!isEditing && (
                    <div className="flex items-center gap-1 ml-3">
                      <button
                        onClick={() => togglePassword(cred.id)}
                        className="p-2 text-slate-400 hover:text-gold rounded-lg hover:bg-slate-800 transition-colors"
                        title={isVisible ? "Hide password" : "Show password"}
                      >
                        {isVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                      <button
                        onClick={() => copyToClipboard(cred.password, cred.id)}
                        className="p-2 text-slate-400 hover:text-gold rounded-lg hover:bg-slate-800 transition-colors"
                        title="Copy password"
                      >
                        {isCopied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                      </button>
                      <button
                        onClick={() => startEdit(cred)}
                        className="p-2 text-slate-400 hover:text-gold rounded-lg hover:bg-slate-800 transition-colors"
                        title="Edit password"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => handleReset(cred.id)}
                        disabled={isResetting}
                        className="p-2 text-slate-400 hover:text-amber-400 rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50"
                        title="Generate new random password"
                      >
                        {isResetting ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
          </>
        );
      })()}

      {credentials.length === 0 && !searchQuery && (
        <div className="text-center py-12 text-slate-500 text-sm">
          No agency credentials configured.
        </div>
      )}
    </div>
  );
}

export default AgencyCredentialsPanel