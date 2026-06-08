import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, Check, X, Users } from "lucide-react";
import { adminGetFuzzyMatches, adminApproveFuzzyMatch } from "../../lib/api";

interface FuzzyEntry {
  id: string;
  agent_first_name: string;
  agent_last_name: string;
  writing_number: string;
  carrier: string;
  npn: string;
  agencies?: { id: string; name: string; slug: string } | null;
  agents?: {
    id: string;
    first_name: string;
    last_name: string;
    unl_writing_number: string;
    gtl_writing_number: string;
    npn: string;
  } | null;
  created_at: string;
}

interface FuzzyMatchPanelProps {
  token: string;
}

export default function FuzzyMatchPanel({ token }: FuzzyMatchPanelProps) {
  const [entries, setEntries] = useState<FuzzyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);

  const fetchFuzzy = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminGetFuzzyMatches(token);
      setEntries(data.entries || []);
    } catch {
      // ignore
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    fetchFuzzy();
  }, [fetchFuzzy]);

  const handleApprove = async (entry: FuzzyEntry) => {
    setProcessing(entry.id);
    try {
      await adminApproveFuzzyMatch(token, entry.id, true, entry.agents?.id);
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    } catch {
      // ignore
    }
    setProcessing(null);
  };

  const handleReject = async (entry: FuzzyEntry) => {
    setProcessing(entry.id);
    try {
      await adminApproveFuzzyMatch(token, entry.id, false);
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    } catch {
      // ignore
    }
    setProcessing(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-amber-400" />
          <h3 className="text-sm font-semibold text-white">Pending Roster Approvals</h3>
          {entries.length > 0 && (
            <span className="text-[10px] font-bold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">
              {entries.length}
            </span>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-400">
        These roster entries have fuzzy data (name or writing number mismatch). Review and approve or reject each one.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin h-5 w-5 border-2 border-sky-500 border-t-transparent rounded-full" />
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-8">
          <Users size={24} className="mx-auto text-slate-600 mb-2" />
          <p className="text-sm text-slate-400">No pending approvals.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="bg-slate-800/50 border border-slate-700/40 rounded-lg p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-medium text-sky-400 bg-sky-400/10 px-1.5 py-0.5 rounded">
                      {entry.agencies?.name || "Unknown Agency"}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {new Date(entry.created_at).toLocaleDateString()}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {/* Roster Data */}
                    <div className="bg-amber-900/10 border border-amber-700/20 rounded p-2">
                      <p className="text-[9px] text-amber-500 uppercase tracking-wider font-medium mb-1">From Roster</p>
                      <p className="text-xs text-white font-medium">
                        {entry.agent_first_name} {entry.agent_last_name}
                      </p>
                      <p className="text-[10px] text-slate-400 font-mono">{entry.writing_number}</p>
                      {entry.npn && <p className="text-[10px] text-slate-500">NPN: {entry.npn}</p>}
                    </div>

                    {/* Matched Agent */}
                    {entry.agents && (
                      <div className="bg-slate-700/30 border border-slate-600/30 rounded p-2">
                        <p className="text-[9px] text-slate-500 uppercase tracking-wider font-medium mb-1">Closest Match</p>
                        <p className="text-xs text-white font-medium">
                          {entry.agents.first_name} {entry.agents.last_name}
                        </p>
                        <p className="text-[10px] text-slate-400 font-mono">
                          {entry.agents.unl_writing_number || entry.agents.gtl_writing_number}
                        </p>
                        {entry.agents.npn && <p className="text-[10px] text-slate-500">NPN: {entry.agents.npn}</p>}
                      </div>
                    )}
                  </div>

                  {/* Highlight mismatch */}
                  {entry.agents && (
                    <div className="mt-2 text-[10px] text-amber-400">
                      {entry.agent_first_name.toLowerCase() !== entry.agents.first_name.toLowerCase() ||
                      entry.agent_last_name.toLowerCase() !== entry.agents.last_name.toLowerCase()
                        ? "Name mismatch detected"
                        : "Writing number matched but data differs"}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => handleApprove(entry)}
                    disabled={processing === entry.id}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium text-emerald-400 bg-emerald-400/10 hover:bg-emerald-400/20 border border-emerald-700/30 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <Check size={11} /> Approve
                  </button>
                  <button
                    onClick={() => handleReject(entry)}
                    disabled={processing === entry.id}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium text-rose-400 bg-rose-400/10 hover:bg-rose-400/20 border border-rose-700/30 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <X size={11} /> Reject
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
