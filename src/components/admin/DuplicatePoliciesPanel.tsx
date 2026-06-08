import { useState, useEffect, useCallback } from "react";
import {
  Copy,
  CheckCircle2,
  XCircle,
  Loader2,
  ScanSearch,
  Undo2,
  FileText,
  ArrowUpDown,
} from "lucide-react";
import {
  adminGetDuplicatePolicies,
  adminResolveDuplicatePolicy,
  adminRunDuplicateScan,
} from "../../lib/api";

interface DuplicatePolicy {
  id: string;
  agent_number: string;
  agent_first_name: string;
  agent_last_name: string;
  client_first_name: string;
  client_last_name: string;
  zip: string;
  plan_name: string;
  carrier: string;
  policy_effective_date: string;
  plan_premium: number;
  source: string;
  status: string;
  policy_number: string | null;
  created_at: string;
}

interface DuplicatePoliciesPanelProps {
  token: string;
}

export default function DuplicatePoliciesPanel({ token }: DuplicatePoliciesPanelProps) {
  const [policies, setPolicies] = useState<DuplicatePolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState({ total_flagged: 0, duplicate: 0, superseded: 0 });
  const [scanning, setScanning] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<"all" | "duplicate" | "superseded">("all");

  const fetchPolicies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await adminGetDuplicatePolicies(token, "flagged");
      setPolicies(result.policies || []);
      setCounts(result.counts || { total_flagged: 0, duplicate: 0, superseded: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load duplicate policies");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchPolicies();
  }, [fetchPolicies]);

  const handleScan = async () => {
    setScanning(true);
    try {
      await adminRunDuplicateScan(token);
      await fetchPolicies();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const handleResolve = async (policyId: string, resolution: "keep_flagged" | "unflag") => {
    setResolving(policyId);
    try {
      await adminResolveDuplicatePolicy(token, policyId, resolution);
      setPolicies((prev) => prev.filter((p) => p.id !== policyId));
      setCounts((prev) => ({
        ...prev,
        total_flagged: prev.total_flagged - 1,
        duplicate: resolution === "unflag" && policies.find(p => p.id === policyId)?.status === "duplicate" ? prev.duplicate - 1 : prev.duplicate,
        superseded: resolution === "unflag" && policies.find(p => p.id === policyId)?.status === "superseded" ? prev.superseded - 1 : prev.superseded,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to resolve");
    } finally {
      setResolving(null);
    }
  };

  const filteredPolicies = policies.filter((p) => {
    if (filterType === "all") return true;
    return p.status === filterType;
  });

  const grouped = filteredPolicies.reduce<Record<string, DuplicatePolicy[]>>((acc, p) => {
    const key = `${p.agent_number}|${p.client_first_name?.toLowerCase()}|${p.client_last_name?.toLowerCase()}|${p.zip}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(p);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-white">Duplicate Policies</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Policies flagged as duplicates or superseded by data source records
          </p>
        </div>
        <button
          onClick={handleScan}
          disabled={scanning}
          className="flex items-center gap-2 px-3 py-2 bg-slate-700/50 hover:bg-slate-700 border border-slate-600/50 rounded-lg text-sm text-slate-300 hover:text-white transition-colors disabled:opacity-50"
        >
          {scanning ? <Loader2 size={14} className="animate-spin" /> : <ScanSearch size={14} />}
          {scanning ? "Scanning..." : "Run Scan"}
        </button>
      </div>

      {/* Summary Badges */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/50 rounded-lg border border-slate-700/50">
          <Copy size={12} className="text-amber-400" />
          <span className="text-xs text-slate-300">
            <span className="font-semibold text-white">{counts.total_flagged}</span> total flagged
          </span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/50 rounded-lg border border-slate-700/50">
          <ArrowUpDown size={12} className="text-orange-400" />
          <span className="text-xs text-slate-300">
            <span className="font-semibold text-white">{counts.duplicate}</span> duplicates
          </span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/50 rounded-lg border border-slate-700/50">
          <FileText size={12} className="text-sky-400" />
          <span className="text-xs text-slate-300">
            <span className="font-semibold text-white">{counts.superseded}</span> superseded
          </span>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1 bg-slate-800/50 rounded-lg p-1 w-fit">
        {([
          { key: "all" as const, label: "All" },
          { key: "duplicate" as const, label: "Duplicates" },
          { key: "superseded" as const, label: "Superseded" },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilterType(tab.key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              filterType === tab.key
                ? "bg-slate-700 text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <XCircle size={14} className="text-red-400 shrink-0" />
          <p className="text-xs text-red-300">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-xs text-red-400 hover:text-red-300">Dismiss</button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={20} className="animate-spin text-slate-400" />
        </div>
      )}

      {/* Empty */}
      {!loading && filteredPolicies.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <CheckCircle2 size={32} className="text-emerald-400/50 mb-3" />
          <p className="text-sm text-slate-400">No flagged policies found.</p>
        </div>
      )}

      {/* Grouped Policies */}
      {!loading && Object.keys(grouped).length > 0 && (
        <div className="space-y-3">
          {Object.entries(grouped).map(([key, group]) => (
            <div key={key} className="rounded-xl border border-slate-700/50 bg-slate-800/30 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-700/30 bg-slate-800/50">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-white">
                    {group[0].client_first_name} {group[0].client_last_name}
                  </span>
                  <span className="text-[11px] text-slate-400 font-mono">{group[0].zip}</span>
                  <span className="text-[11px] text-slate-500">|</span>
                  <span className="text-[11px] text-slate-400">
                    Agent: {group[0].agent_first_name} {group[0].agent_last_name}
                  </span>
                  <span className="text-[11px] text-slate-500 font-mono">{group[0].agent_number}</span>
                </div>
              </div>
              <div className="divide-y divide-slate-700/30">
                {group.map((policy) => (
                  <div key={policy.id} className="px-4 py-2.5 flex items-center gap-4">
                    <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${
                      policy.status === "superseded"
                        ? "bg-sky-500/10 text-sky-400 border border-sky-500/20"
                        : "bg-orange-500/10 text-orange-400 border border-orange-500/20"
                    }`}>
                      {policy.status}
                    </span>
                    <div className="flex-1 min-w-0 grid grid-cols-[1fr_1fr_auto_auto] gap-x-4 items-center text-xs">
                      <span className="text-slate-300 truncate">{policy.plan_name || "N/A"}</span>
                      <span className="text-slate-400">{policy.policy_effective_date || "No date"}</span>
                      <span className="text-slate-300 font-mono">${(policy.plan_premium * 12).toFixed(0)} AP</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                        policy.source === "Data Source" ? "bg-emerald-500/10 text-emerald-400" :
                        policy.source === "Intake Form" ? "bg-blue-500/10 text-blue-400" :
                        "bg-slate-600/30 text-slate-400"
                      }`}>
                        {policy.source}
                      </span>
                    </div>
                    <button
                      onClick={() => handleResolve(policy.id, "unflag")}
                      disabled={resolving === policy.id}
                      className="shrink-0 flex items-center gap-1 px-2 py-1 bg-slate-700/50 hover:bg-slate-700 border border-slate-600/50 rounded text-[11px] text-slate-400 hover:text-white transition-colors disabled:opacity-50"
                      title="Remove flag and restore to active"
                    >
                      {resolving === policy.id ? <Loader2 size={10} className="animate-spin" /> : <Undo2 size={10} />}
                      Unflag
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
