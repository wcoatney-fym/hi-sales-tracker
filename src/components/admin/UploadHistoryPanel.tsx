import { useState, useEffect, useCallback } from "react";
import {
  History,
  ChevronDown,
  ChevronRight,
  Loader2,
  XCircle,
  Upload,
  Replace,
  FileCheck,
  CheckCircle2,
  AlertTriangle,
  PlayCircle,
} from "lucide-react";
import { adminGetUploadHistory, adminGetUploadHistoryDetail } from "../../lib/api";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

interface UploadHistoryLog {
  id: string;
  source_upload_id: string | null;
  source: string;
  action: string;
  carrier: string | null;
  filename: string | null;
  records_inserted: number;
  records_replaced: number;
  records_superseded: number;
  uploaded_by: string | null;
  created_at: string;
  details: Json;
}

// Friendly label + visual treatment for each action type. The auto-import and
// reconciliation actions didn't exist when this panel was first built.
const ACTION_META: Record<string, { label: string; tone: "ok" | "warn" | "err" | "info" }> = {
  upload: { label: "CSV Upload", tone: "ok" },
  replace: { label: "Records Replaced", tone: "warn" },
  supersede: { label: "Records Superseded", tone: "info" },
  auto_import_init: { label: "Import Started", tone: "info" },
  auto_import_complete: { label: "Import Complete", tone: "ok" },
  auto_import_error: { label: "Import Failed", tone: "err" },
  auto_import_paused: { label: "Auto-Import Paused", tone: "warn" },
  reconciliation_complete: { label: "Reconciliation Complete", tone: "ok" },
  reconciliation_aborted: { label: "Reconciliation Aborted (safety cap)", tone: "warn" },
};

// Pulls a human-readable one-liner out of the details JSON for the collapsed row.
function summarize(log: UploadHistoryLog): string | null {
  const d = log.details;
  if (!d || typeof d !== "object") return null;
  if (typeof d.error === "string") return d.error;
  if (typeof d.reason === "string") return d.reason;
  if (typeof d.policies_synced === "number") {
    return `${d.policies_synced.toLocaleString()} policies synced${typeof d.orphans_deleted === "number" ? `, ${d.orphans_deleted} removed` : ""}`;
  }
  if (Array.isArray(d.results)) {
    const r = d.results.find((x: Json) => x?.message)?.message;
    return r || `${d.results.length} source(s) checked`;
  }
  return null;
}

interface UploadHistoryPanelProps {
  token: string;
}

export default function UploadHistoryPanel({ token }: UploadHistoryPanelProps) {
  const [logs, setLogs] = useState<UploadHistoryLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [detailData, setDetailData] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await adminGetUploadHistory(token);
      setLogs((result.logs as UploadHistoryLog[]) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load upload history");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleExpand = async (logId: string) => {
    if (expandedId === logId) {
      setExpandedId(null);
      setDetailData(null);
      return;
    }
    setExpandedId(logId);
    setDetailLoading(true);
    try {
      const result = await adminGetUploadHistoryDetail(token, logId);
      setDetailData(result.log || null);
    } catch {
      setDetailData(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const getActionIcon = (action: string) => {
    switch (action) {
      case "upload": return <Upload size={12} className="text-emerald-400" />;
      case "replace": return <Replace size={12} className="text-amber-400" />;
      case "supersede": return <FileCheck size={12} className="text-sky-400" />;
      case "auto_import_complete":
      case "reconciliation_complete": return <CheckCircle2 size={12} className="text-emerald-400" />;
      case "auto_import_error": return <XCircle size={12} className="text-red-400" />;
      case "auto_import_paused":
      case "reconciliation_aborted": return <AlertTriangle size={12} className="text-amber-400" />;
      case "auto_import_init": return <PlayCircle size={12} className="text-sky-400" />;
      default: return <History size={12} className="text-slate-400" />;
    }
  };

  const TONE_TEXT: Record<string, string> = {
    ok: "text-emerald-400", warn: "text-amber-400", err: "text-red-400", info: "text-sky-400",
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h3 className="text-base font-bold text-white">Upload History</h3>
        <p className="text-xs text-slate-400 mt-0.5">
          History of data source uploads including replaced and superseded records
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <XCircle size={14} className="text-red-400 shrink-0" />
          <p className="text-xs text-red-300">{error}</p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={20} className="animate-spin text-slate-400" />
        </div>
      )}

      {/* Empty */}
      {!loading && logs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <History size={32} className="text-slate-500/50 mb-3" />
          <p className="text-sm text-slate-400">No upload history yet.</p>
          <p className="text-xs text-slate-500 mt-1">History will appear after the next data source upload.</p>
        </div>
      )}

      {/* Logs list */}
      {!loading && logs.length > 0 && (
        <div className="space-y-2">
          {logs.map((log) => (
            <div key={log.id} className="rounded-xl border border-slate-700/50 bg-slate-800/30 overflow-hidden">
              <button
                onClick={() => handleExpand(log.id)}
                className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-800/50 transition-colors"
              >
                {expandedId === log.id ? (
                  <ChevronDown size={14} className="text-slate-400 shrink-0" />
                ) : (
                  <ChevronRight size={14} className="text-slate-400 shrink-0" />
                )}
                {getActionIcon(log.action)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium truncate ${TONE_TEXT[ACTION_META[log.action]?.tone] || "text-white"}`}>
                      {log.filename || ACTION_META[log.action]?.label || log.action}
                    </span>
                    {log.carrier && (
                      <span className="px-1.5 py-0.5 bg-slate-700/50 rounded text-[10px] text-slate-400 font-mono">
                        {log.carrier}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-[11px] text-slate-500">
                      {new Date(log.created_at).toLocaleDateString()} {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {log.uploaded_by && (
                      <span className="text-[11px] text-slate-500">by {log.uploaded_by}</span>
                    )}
                    {summarize(log) && (
                      <span className={`text-[11px] truncate ${log.action.includes("error") ? "text-red-400/80" : "text-slate-400"}`}>
                        {summarize(log)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  {log.records_inserted > 0 && (
                    <span className="text-[11px] text-emerald-400">
                      +{log.records_inserted} inserted
                    </span>
                  )}
                  {log.records_replaced > 0 && (
                    <span className="text-[11px] text-amber-400">
                      {log.records_replaced} replaced
                    </span>
                  )}
                  {log.records_superseded > 0 && (
                    <span className="text-[11px] text-sky-400">
                      {log.records_superseded} superseded
                    </span>
                  )}
                </div>
              </button>

              {/* Expanded detail */}
              {expandedId === log.id && (
                <div className="border-t border-slate-700/30 px-4 py-3 bg-slate-900/30">
                  {detailLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 size={16} className="animate-spin text-slate-400" />
                    </div>
                  ) : detailData ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-3 gap-4">
                        <div className="p-2.5 bg-slate-800/50 rounded-lg border border-slate-700/30">
                          <p className="text-[10px] text-slate-500 uppercase tracking-wide">Source</p>
                          <p className="text-sm font-medium text-white mt-0.5">{detailData.source}</p>
                        </div>
                        <div className="p-2.5 bg-slate-800/50 rounded-lg border border-slate-700/30">
                          <p className="text-[10px] text-slate-500 uppercase tracking-wide">Action</p>
                          <p className="text-sm font-medium text-white mt-0.5">{ACTION_META[detailData.action]?.label || detailData.action}</p>
                        </div>
                        <div className="p-2.5 bg-slate-800/50 rounded-lg border border-slate-700/30">
                          <p className="text-[10px] text-slate-500 uppercase tracking-wide">When</p>
                          <p className="text-sm font-medium text-white mt-0.5">
                            {new Date(detailData.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                      </div>

                      {/* Error banner for failed runs */}
                      {typeof detailData.details?.error === "string" && (
                        <div className="flex items-start gap-2 p-2.5 bg-red-500/10 border border-red-500/20 rounded-lg">
                          <XCircle size={13} className="text-red-400 shrink-0 mt-0.5" />
                          <p className="text-xs text-red-300 break-words">{detailData.details.error}</p>
                        </div>
                      )}

                      {/* Per-source results (auto-import / poll runs) */}
                      {Array.isArray(detailData.details?.results) && (
                        <div className="space-y-1">
                          {detailData.details.results.map((r: Json, i: number) => (
                            <div key={i} className="flex items-center gap-2 text-[11px]">
                              <span className={`px-1.5 py-0.5 rounded font-mono ${
                                r.status === "started" || r.status === "complete" ? "bg-emerald-500/10 text-emerald-400" :
                                r.status === "error" ? "bg-red-500/10 text-red-400" :
                                r.status === "paused" ? "bg-amber-500/10 text-amber-400" :
                                "bg-slate-700/50 text-slate-400"
                              }`}>{r.status}</span>
                              <span className="text-slate-300 break-words">{r.message}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Raw details payload for full transparency */}
                      {detailData.details && (
                        <details className="group">
                          <summary className="text-[11px] text-slate-500 cursor-pointer hover:text-slate-300 select-none">
                            Raw details
                          </summary>
                          <pre className="mt-1.5 max-h-48 overflow-auto rounded-lg border border-slate-700/30 bg-slate-900/50 p-2.5 text-[10px] text-slate-400 font-mono whitespace-pre-wrap break-words">
                            {JSON.stringify(detailData.details, null, 2)}
                          </pre>
                        </details>
                      )}

                      {/* Replaced data summary */}
                      {detailData.replaced_data && (
                        <div>
                          <p className="text-xs font-medium text-amber-400 mb-1.5">
                            Replaced Records ({detailData.replaced_data.length})
                          </p>
                          <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-700/30 bg-slate-900/50">
                            <table className="w-full text-[11px]">
                              <thead className="sticky top-0 bg-slate-800">
                                <tr className="text-slate-500">
                                  <th className="text-left px-2 py-1.5">Policy #</th>
                                  <th className="text-left px-2 py-1.5">Client</th>
                                  <th className="text-left px-2 py-1.5">Plan</th>
                                  <th className="text-left px-2 py-1.5">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-700/20">
                                {detailData.replaced_data.slice(0, 20).map((row: Record<string, string>, i: number) => (
                                  <tr key={i} className="text-slate-300">
                                    <td className="px-2 py-1 font-mono">{row.policy_number || "N/A"}</td>
                                    <td className="px-2 py-1">{row.client_first_name} {row.client_last_name}</td>
                                    <td className="px-2 py-1">{row.plan_name}</td>
                                    <td className="px-2 py-1">{row.status}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {detailData.replaced_data.length > 20 && (
                              <p className="text-[10px] text-slate-500 px-2 py-1 border-t border-slate-700/30">
                                + {detailData.replaced_data.length - 20} more records
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Superseded data summary */}
                      {detailData.superseded_data && (
                        <div>
                          <p className="text-xs font-medium text-sky-400 mb-1.5">
                            Superseded Records ({detailData.superseded_data.length})
                          </p>
                          <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-700/30 bg-slate-900/50">
                            <table className="w-full text-[11px]">
                              <thead className="sticky top-0 bg-slate-800">
                                <tr className="text-slate-500">
                                  <th className="text-left px-2 py-1.5">Agent</th>
                                  <th className="text-left px-2 py-1.5">Client</th>
                                  <th className="text-left px-2 py-1.5">Source</th>
                                  <th className="text-left px-2 py-1.5">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-700/20">
                                {detailData.superseded_data.slice(0, 20).map((row: Record<string, string>, i: number) => (
                                  <tr key={i} className="text-slate-300">
                                    <td className="px-2 py-1 font-mono">{row.agent_number}</td>
                                    <td className="px-2 py-1">{row.client_first_name} {row.client_last_name}</td>
                                    <td className="px-2 py-1">{row.source}</td>
                                    <td className="px-2 py-1">{row.status}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {detailData.superseded_data.length > 20 && (
                              <p className="text-[10px] text-slate-500 px-2 py-1 border-t border-slate-700/30">
                                + {detailData.superseded_data.length - 20} more records
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">No details available.</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
