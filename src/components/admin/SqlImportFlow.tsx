import { useState, useRef, useEffect } from "react";
import {
  ArrowLeft,
  Loader2,
  CheckCircle,
  AlertCircle,
  Database,
  ArrowRight,
} from "lucide-react";
import {
  adminSqlImportCount,
  adminStartSqlImport,
  adminGetImportProgress,
  adminResyncPolicies,
  adminSaveColumnMappings,
  adminAnalyzeSourceUpload,
} from "../../lib/api";
import ColumnMapper from "./ColumnMapper";

interface DataSource {
  id: string;
  name: string;
}

interface SqlImportFlowProps {
  token: string;
  source: DataSource;
  onBack: () => void;
  onComplete: () => void;
}

type Step = "carrier" | "preview" | "auto-mapping" | "mapping" | "processing" | "done";

export default function SqlImportFlow({ token, source, onBack, onComplete }: SqlImportFlowProps) {
  const [step, setStep] = useState<Step>("carrier");
  const [carrier, setCarrier] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [sampleRows, setSampleRows] = useState<Record<string, string>[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [savedMappings, setSavedMappings] = useState<Record<string, string>>({});
  const [currentMappings, setCurrentMappings] = useState<Record<string, string>>({});
  const [hasSavedMapping, setHasSavedMapping] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: number; agentsAdded?: number; agentsUpdated?: number; policiesSynced?: number } | null>(null);
  const [fetchProgress, setFetchProgress] = useState<{ fetched: number; total: number } | null>(null);
  const [chunkProgress, setChunkProgress] = useState<{ current: number; total: number } | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ offset: number; total: number } | null>(null);
  const [pendingUploadId, setPendingUploadId] = useState<string | null>(null);
  const [autoMapProgress, setAutoMapProgress] = useState(0);
  const [autoMapRevealed, setAutoMapRevealed] = useState<string[]>([]);
  const [autoMapHasUnmapped, setAutoMapHasUnmapped] = useState(false);
  const [autoMapDone, setAutoMapDone] = useState(false);
  const syncAbortRef = useRef(false);

  const handlePreview = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await adminSqlImportCount(token, source.id);
      if (res.error) throw new Error(res.error);

      setTotalRows(res.total);
      setHeaders(res.columns || []);
      setSampleRows(res.sampleRows || []);

      const analysis = await adminAnalyzeSourceUpload(token, source.id, res.sampleRows || [], carrier, `sql_import_${source.name}`);
      setSavedMappings(analysis.savedMappings || {});
      setHasSavedMapping(analysis.hasSavedMapping);

      if (analysis.hasSavedMapping) {
        setCurrentMappings(analysis.savedMappings);
        setAutoMapHasUnmapped(analysis.unmappedColumns.length > 0);
        setAutoMapDone(false);
        setAutoMapProgress(0);
        setAutoMapRevealed([]);
        setStep("auto-mapping");
        setLoading(false);
        return;
      } else {
        const existing = analysis.savedMappings || {};
        const initial: Record<string, string> = {};
        for (const col of res.columns || []) {
          initial[col] = existing[col] || "";
        }
        setCurrentMappings(initial);
      }

      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect to database");
    } finally {
      setLoading(false);
    }
  };

  // Animation effect: reveals mapped columns one by one, then sets autoMapDone
  useEffect(() => {
    if (step !== "auto-mapping") return;

    const mappedEntries = Object.entries(currentMappings).filter(([, v]) => v);
    const derivedEntries: [string, string][] = [];
    for (const [src, target] of mappedEntries) {
      if (target === "Writing Agent") {
        derivedEntries.push([src, "Writing Agent -> Writing Agent First Name + Last Name"]);
      }
    }
    const allEntries = [...mappedEntries.map(([s, t]) => `${s} -> ${t}`), ...derivedEntries.map(([, label]) => label)];
    const totalSteps = allEntries.length;

    if (totalSteps === 0) {
      setAutoMapProgress(100);
      setAutoMapDone(true);
      return;
    }

    let idx = 0;
    const interval = setInterval(() => {
      if (idx < totalSteps) {
        const item = allEntries[idx];
        setAutoMapRevealed((prev) => [...prev, item]);
        setAutoMapProgress(Math.round(((idx + 1) / totalSteps) * 100));
        idx++;
      } else {
        clearInterval(interval);
        setTimeout(() => setAutoMapDone(true), 600);
      }
    }, 120);

    return () => clearInterval(interval);
  }, [step, currentMappings]);

  // Transition effect: when autoMapDone becomes true, always go to verify step
  useEffect(() => {
    if (!autoMapDone || step !== "auto-mapping") return;
    setStep("mapping");
  }, [autoMapDone, step]);

  const handleProcess = async (mappings: Record<string, string>, saveMapping: boolean) => {
    setCurrentMappings(mappings);
    setStep("processing");
    setError("");
    syncAbortRef.current = false;

    try {
      if (saveMapping) {
        const mappingRows = Object.entries(mappings)
          .filter(([, target]) => target)
          .map(([source_column, target_field]) => ({ source_column, target_field }));
        await adminSaveColumnMappings(token, source.id, mappingRows);
      }

      // The import runs entirely server-side (same pipeline as the scheduled
      // auto-imports): keyset fetch from the source DB into staging, then keyset
      // sync into form_submissions. We only poll for progress here, so closing
      // this tab does not interrupt the import.
      const startRes = await adminStartSqlImport(token, source.id, carrier);
      if (startRes.error) throw new Error(startRes.error);
      const uploadId = startRes.uploadId as string;
      setPendingUploadId(uploadId);
      setFetchProgress({ fetched: 0, total: totalRows > 0 ? totalRows : 0 });

      await pollImportProgress(uploadId);
    } catch (err) {
      setFinalizing(false);
      setFetchProgress(null);
      setChunkProgress(null);
      setError(err instanceof Error ? err.message : "Processing failed");
    }
  };

  const pollImportProgress = async (uploadId: string) => {
    while (!syncAbortRef.current) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const prog = await adminGetImportProgress(token, uploadId);
      if (prog.error) throw new Error(prog.error);
      const upload = prog.upload || {};
      const rp = (upload.resync_progress || {}) as Record<string, unknown>;

      if (rp.phase === "fetch") {
        setFetchProgress({
          fetched: (rp.fetched as number) || 0,
          total: totalRows > 0 ? totalRows : (rp.fetched as number) || 0,
        });
      } else if (rp.phase === "sync") {
        setFetchProgress(null);
        setFinalizing(true);
        setSyncProgress({
          offset: (rp.synced as number) || 0,
          total: (upload.row_count as number) || totalRows || 0,
        });
      }

      if (upload.status === "complete") {
        setFinalizing(false);
        setFetchProgress(null);
        setSyncProgress(null);
        setPendingUploadId(null);
        setResult({
          imported: (upload.row_count as number) || 0,
          skipped: 0,
          errors: 0,
          agentsAdded: 0,
          agentsUpdated: 0,
          policiesSynced: (rp.policies_synced as number) || 0,
        });
        setStep("done");
        return;
      }
      if (upload.status === "error") {
        throw new Error((rp.error as string) || "Import failed on the server. See the uploads list for details.");
      }
    }

    if (syncAbortRef.current) {
      setError("Stopped watching progress — the import continues on the server. Check the uploads list for its status.");
      setFetchProgress(null);
      setChunkProgress(null);
      setSyncProgress(null);
      setFinalizing(false);
    }
  };

  const handleRetryFinalize = async () => {
    if (!pendingUploadId) return;
    setError("");
    setStep("processing");
    setFinalizing(true);
    syncAbortRef.current = false;
    setSyncProgress({ offset: 0, total: 0 });

    try {
      // Kick the server-side keyset sync for the staged upload, then poll
      const res = await adminResyncPolicies(token, pendingUploadId, 0, 500);
      if (res.error) throw new Error(res.error);
      await pollImportProgress(pendingUploadId);
    } catch (err) {
      setFinalizing(false);
      setSyncProgress(null);
      setError(err instanceof Error ? err.message : "Sync failed");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
        >
          <ArrowLeft size={16} />
          Back
        </button>
        <span className="text-sm font-medium text-white">SQL Import from {source.name}</span>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs">
        {(["carrier", "preview", "auto-mapping", "mapping", "done"] as const).map((s, i) => {
          const labels = ["Carrier", "Preview", "Auto-Map", "Verify", "Complete"];
          const stepOrder: Record<Step, number> = { carrier: 0, preview: 1, "auto-mapping": 2, mapping: 3, processing: 3, done: 4 };
          const current = stepOrder[step];
          const active = i === current;
          const completed = i < current;
          return (
            <div key={s} className="flex items-center gap-2">
              {i > 0 && <div className={`w-6 h-px ${completed ? "bg-gold" : "bg-slate-700/50"}`} />}
              <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full ${
                active ? "bg-gold/10 text-gold font-medium" :
                completed ? "bg-gold/10 text-gold" :
                "bg-navy-light text-slate-400"
              }`}>
                <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  active ? "bg-gold text-navy-dark" :
                  completed ? "bg-gold text-navy-dark" :
                  "bg-slate-600 text-white"
                }`}>
                  {completed ? "\u2713" : i + 1}
                </span>
                {labels[i]}
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg border bg-red-900/30 border-red-700/50">
          <AlertCircle className="text-red-400 flex-shrink-0 mt-0.5" size={16} />
          <span className="text-sm text-red-300">{error}</span>
          {pendingUploadId && (
            <button
              onClick={handleRetryFinalize}
              className="ml-auto px-3 py-1 text-xs font-medium text-navy-dark bg-gold rounded hover:bg-gold-light transition-colors"
            >
              Retry Sync
            </button>
          )}
        </div>
      )}

      {/* Step: Carrier */}
      {step === "carrier" && (
        <div className="bg-navy rounded-xl border border-slate-700/50 p-6">
          <h4 className="text-sm font-semibold text-white mb-4">Select Carrier</h4>
          <p className="text-xs text-slate-400 mb-4">
            Choose the carrier this data belongs to. This labels all records in this import.
          </p>
          <input
            type="text"
            placeholder="e.g., UNL, GTL, Aetna, Cigna..."
            value={carrier}
            onChange={(e) => setCarrier(e.target.value)}
            className="w-full max-w-sm px-3 py-2.5 text-sm border border-slate-600 rounded-lg bg-navy-light text-white focus:outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold"
          />
          <div className="mt-4">
            <button
              onClick={handlePreview}
              disabled={!carrier.trim() || loading}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-navy-dark bg-gold rounded-lg hover:bg-gold-light disabled:opacity-50 transition-colors"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Database size={16} />}
              {loading ? "Connecting..." : "Connect & Preview"}
            </button>
          </div>
        </div>
      )}

      {/* Step: Preview */}
      {step === "preview" && (
        <div className="bg-navy rounded-xl border border-slate-700/50 p-6">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-semibold text-white">Database Preview</h4>
            <span className="text-xs font-medium text-slate-300 bg-navy-light px-3 py-1.5 rounded-full border border-slate-600">
              {totalRows > 0 ? `${totalRows.toLocaleString()} total rows` : "Estimating row count..."}
            </span>
          </div>

          <div className="mb-4 p-3 bg-navy-light/50 rounded-lg border border-slate-700/30">
            <p className="text-xs text-slate-400 mb-2">
              <span className="font-medium text-slate-300">{headers.length} columns</span> detected:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {headers.map((h) => (
                <span key={h} className="px-2 py-0.5 text-[11px] font-mono bg-navy rounded border border-slate-600 text-slate-300">
                  {h}
                </span>
              ))}
            </div>
          </div>

          {sampleRows.length > 0 && (
            <div className="mb-4 overflow-x-auto">
              <p className="text-xs text-slate-400 mb-2">Sample data (first 5 rows):</p>
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-slate-700/50">
                    {headers.slice(0, 8).map((h) => (
                      <th key={h} className="px-2 py-1.5 text-left text-slate-400 font-medium">{h}</th>
                    ))}
                    {headers.length > 8 && <th className="px-2 py-1.5 text-slate-500">+{headers.length - 8} more</th>}
                  </tr>
                </thead>
                <tbody>
                  {sampleRows.map((row, i) => (
                    <tr key={i} className="border-b border-slate-700/20">
                      {headers.slice(0, 8).map((h) => (
                        <td key={h} className="px-2 py-1.5 text-slate-300 truncate max-w-[120px]">
                          {row[h] || "-"}
                        </td>
                      ))}
                      {headers.length > 8 && <td className="px-2 py-1.5 text-slate-500">...</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={() => {
                setAutoMapDone(false);
                setAutoMapProgress(0);
                setAutoMapRevealed([]);
                setStep("auto-mapping");
              }}
              className="px-5 py-2.5 text-sm font-medium text-navy-dark bg-gold rounded-lg hover:bg-gold-light transition-colors"
            >
              Continue to Column Mapping
            </button>
            <button
              onClick={() => setStep("carrier")}
              className="px-4 py-2.5 text-sm font-medium text-slate-300 bg-navy-light border border-slate-600 rounded-lg hover:bg-navy-mid transition-colors"
            >
              Back
            </button>
          </div>
        </div>
      )}

      {/* Step: Auto-Mapping */}
      {step === "auto-mapping" && (
        <div className="bg-navy rounded-xl border border-slate-700/50 p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-8 h-8 rounded-full bg-gold/10 flex items-center justify-center">
              <Loader2 size={16} className={`text-gold ${autoMapProgress < 100 ? "animate-spin" : ""}`} />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-white">Applying Column Mappings</h4>
              <p className="text-xs text-slate-400">
                Using saved mappings from upload data source
              </p>
            </div>
          </div>

          <div className="mb-4">
            <div className="flex justify-between text-xs text-slate-400 mb-1.5">
              <span>Mapping columns...</span>
              <span>{autoMapProgress}%</span>
            </div>
            <div className="h-2.5 bg-slate-700/50 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-gold/80 to-gold rounded-full transition-all duration-200 ease-out"
                style={{ width: `${autoMapProgress}%` }}
              />
            </div>
          </div>

          <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
            {autoMapRevealed.map((entry, i) => {
              const isNameSplit = entry.includes("Writing Agent First Name");
              return (
                <div
                  key={i}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-all duration-200 ${
                    isNameSplit
                      ? "bg-sky-900/20 border border-sky-700/30"
                      : "bg-navy-light/50 border border-slate-700/20"
                  }`}
                >
                  <ArrowRight size={12} className={isNameSplit ? "text-sky-400" : "text-gold"} />
                  <span className="font-mono text-slate-300">{entry.split(" -> ")[0]}</span>
                  <ArrowRight size={10} className="text-slate-500" />
                  <span className={`font-medium ${isNameSplit ? "text-sky-300" : "text-gold"}`}>
                    {entry.split(" -> ")[1]}
                  </span>
                </div>
              );
            })}
          </div>

          {autoMapProgress >= 100 && (
            <div className="mt-4 pt-3 border-t border-slate-700/30">
              <div className="flex items-center gap-2 text-xs text-emerald-400">
                <CheckCircle size={14} />
                <span>
                  {autoMapHasUnmapped
                    ? "Partial mapping applied. Some columns need manual assignment..."
                    : "All columns mapped successfully. Starting import..."}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step: Column Mapping (manual verify/adjust) */}
      {step === "mapping" && (
        <ColumnMapper
          headers={headers}
          sampleRows={sampleRows}
          savedMappings={savedMappings}
          initialMappings={currentMappings}
          hasSavedMapping={hasSavedMapping}
          onProcess={handleProcess}
          onBack={() => setStep("preview")}
          totalRows={totalRows}
          filename={`sql_import_${source.name}`}
        />
      )}

      {/* Step: Processing */}
      {step === "processing" && (
        <div className="bg-navy rounded-xl border border-slate-700/50 p-6">
          <div className="flex flex-col items-center gap-3 py-10">
            <Loader2 className="animate-spin text-gold" size={32} />
            <p className="text-sm font-medium text-slate-200">
              Importing {totalRows.toLocaleString()} records from database...
            </p>
            {finalizing ? (
              <div className="w-72 space-y-2">
                <p className="text-xs text-slate-400 text-center">Syncing agents and policies...</p>
                {syncProgress && syncProgress.total > 0 && (
                  <>
                    <div className="flex justify-between text-xs text-slate-400">
                      <span>{syncProgress.offset.toLocaleString()} / {syncProgress.total.toLocaleString()} records</span>
                      <span>{Math.round((syncProgress.offset / syncProgress.total) * 100)}%</span>
                    </div>
                    <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gold rounded-full transition-all duration-300"
                        style={{ width: `${(syncProgress.offset / syncProgress.total) * 100}%` }}
                      />
                    </div>
                  </>
                )}
                <button
                  onClick={() => { syncAbortRef.current = true; }}
                  className="mt-2 w-full text-xs text-red-400 hover:text-red-300 font-medium"
                >
                  Cancel Sync
                </button>
              </div>
            ) : fetchProgress ? (
              <div className="w-72 space-y-2">
                <p className="text-xs text-slate-400 text-center">Fetching data from external database...</p>
                <div className="flex justify-between text-xs text-slate-400">
                  <span>{fetchProgress.fetched.toLocaleString()} / {fetchProgress.total.toLocaleString()} rows fetched</span>
                  <span>{Math.round((fetchProgress.fetched / fetchProgress.total) * 100)}%</span>
                </div>
                <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-sky-400 rounded-full transition-all duration-300"
                    style={{ width: `${(fetchProgress.fetched / fetchProgress.total) * 100}%` }}
                  />
                </div>
                {chunkProgress && (
                  <p className="text-[11px] text-slate-500 text-center">
                    Processing chunk {chunkProgress.current} of {chunkProgress.total}
                  </p>
                )}
                <button
                  onClick={() => { syncAbortRef.current = true; }}
                  className="mt-2 w-full text-xs text-red-400 hover:text-red-300 font-medium"
                >
                  Cancel Import
                </button>
              </div>
            ) : (
              <p className="text-xs text-slate-400">Initializing import...</p>
            )}
          </div>
        </div>
      )}

      {/* Step: Done */}
      {step === "done" && result && (
        <div className="bg-navy rounded-xl border border-slate-700/50 p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-full bg-emerald-900/30 flex items-center justify-center">
              <CheckCircle size={20} className="text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-emerald-300">SQL Import Complete</p>
              <p className="text-xs text-emerald-400">{source.name}</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-emerald-900/30 rounded-lg border border-emerald-700/50 px-4 py-3">
              <p className="text-xl font-bold text-emerald-300">{result.imported.toLocaleString()}</p>
              <p className="text-xs text-emerald-400">Imported</p>
            </div>
            <div className="bg-amber-900/30 rounded-lg border border-amber-700/50 px-4 py-3">
              <p className="text-xl font-bold text-amber-300">{result.skipped}</p>
              <p className="text-xs text-amber-400">Skipped</p>
            </div>
            <div className="bg-red-900/30 rounded-lg border border-red-700/50 px-4 py-3">
              <p className="text-xl font-bold text-red-300">{result.errors}</p>
              <p className="text-xs text-red-400">Errors</p>
            </div>
          </div>

          {(result.agentsAdded || result.agentsUpdated || result.policiesSynced) ? (
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-navy-light/50 rounded-lg border border-slate-700/30 px-4 py-3">
                <p className="text-xl font-bold text-white">{result.agentsAdded}</p>
                <p className="text-xs text-slate-400">Agents Added</p>
              </div>
              <div className="bg-navy-light/50 rounded-lg border border-slate-700/30 px-4 py-3">
                <p className="text-xl font-bold text-white">{result.agentsUpdated}</p>
                <p className="text-xs text-slate-400">Agents Updated</p>
              </div>
              <div className="bg-navy-light/50 rounded-lg border border-slate-700/30 px-4 py-3">
                <p className="text-xl font-bold text-white">{result.policiesSynced}</p>
                <p className="text-xs text-slate-400">Policies Synced</p>
              </div>
            </div>
          ) : null}

          <button
            onClick={onComplete}
            className="w-full px-4 py-2.5 text-sm font-medium text-gold bg-gold/10 border border-gold/30 rounded-lg hover:bg-gold/20 transition-colors"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}
