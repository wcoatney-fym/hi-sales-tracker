import { useState, useRef } from "react";
import {
  Upload,
  ArrowLeft,
  Loader2,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import {
  adminAnalyzeSourceUpload,
  adminProcessSourceUpload,
  adminResyncPolicies,
  adminSaveColumnMappings,
} from "../../lib/api";
import ColumnMapper from "./ColumnMapper";

interface DataSource {
  id: string;
  name: string;
}

interface SourceUploadFlowProps {
  token: string;
  source: DataSource;
  onBack: () => void;
  onComplete: () => void;
}

function parseCsv(text: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return { headers: [] as string[], rows: [] as Record<string, string>[] };

  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));

  const rows = lines.slice(1).map((line) => {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        values.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current.trim());

    return headers.reduce(
      (obj, header, i) => {
        obj[header] = values[i] || "";
        return obj;
      },
      {} as Record<string, string>
    );
  });

  return { headers, rows };
}

type Step = "carrier" | "file" | "mapping" | "processing" | "done";

export default function SourceUploadFlow({ token, source, onBack, onComplete }: SourceUploadFlowProps) {
  const [step, setStep] = useState<Step>("carrier");
  const [carrier, setCarrier] = useState("");
  const [filename, setFilename] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [savedMappings, setSavedMappings] = useState<Record<string, string>>({});
  const [currentMappings, setCurrentMappings] = useState<Record<string, string>>({});
  const [hasSavedMapping, setHasSavedMapping] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: number; agentsAdded?: number; agentsUpdated?: number; policiesSynced?: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [chunkProgress, setChunkProgress] = useState<{ current: number; total: number } | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ offset: number; total: number } | null>(null);
  const [pendingUploadId, setPendingUploadId] = useState<string | null>(null);
  const syncAbortRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (file: File) => {
    if (!file.name.endsWith(".csv")) {
      setError("Please upload a CSV file.");
      return;
    }

    setError("");
    const text = await file.text();
    const { headers: h, rows: r } = parseCsv(text);

    if (r.length === 0) {
      setError("CSV file contains no data rows.");
      return;
    }

    setFilename(file.name);
    setHeaders(h);
    setRows(r);

    try {
      const analysis = await adminAnalyzeSourceUpload(token, source.id, r.slice(0, 5), carrier, file.name);
      setSavedMappings(analysis.savedMappings || {});
      setHasSavedMapping(analysis.hasSavedMapping);

      if (analysis.hasSavedMapping && analysis.unmappedColumns.length === 0) {
        setCurrentMappings(analysis.savedMappings);
      } else {
        const existing = analysis.savedMappings || {};
        const initial: Record<string, string> = {};
        for (const col of h) {
          initial[col] = existing[col] || "";
        }
        setCurrentMappings(initial);
      }
      setStep("mapping");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const handleProcess = async (mappings: Record<string, string>, saveMapping: boolean) => {
    setCurrentMappings(mappings);
    setStep("processing");
    setError("");

    try {
      if (saveMapping) {
        const mappingRows = Object.entries(mappings)
          .filter(([, target]) => target)
          .map(([source_column, target_field]) => ({ source_column, target_field }));
        await adminSaveColumnMappings(token, source.id, mappingRows);
      }

      const res = await adminProcessSourceUpload(token, source.id, rows, carrier, mappings, filename, (current, total) => {
        setChunkProgress({ current, total });
      });
      if (!res.success) throw new Error(res.error || "Upload failed");

      const uploadedId = res.uploadId;
      setPendingUploadId(uploadedId);

      // Finalize: sync agents and policies in batches (1000 rows, 2-min gap)
      setChunkProgress(null);
      setFinalizing(true);
      syncAbortRef.current = false;
      setSyncProgress({ offset: 0, total: 0 });

      const BATCH_SIZE = 500;
      const DELAY_MS = 120_000;
      let offset = 0;
      let totalAgentsAdded = 0;
      let totalAgentsUpdated = 0;
      let totalPoliciesSynced = 0;

      while (!syncAbortRef.current) {
        const batchRes = await adminResyncPolicies(token, uploadedId, offset, BATCH_SIZE);
        if (batchRes.error && !batchRes.done) throw new Error(batchRes.error);

        totalAgentsAdded += batchRes.agentsAdded || 0;
        totalAgentsUpdated += batchRes.agentsUpdated || 0;
        totalPoliciesSynced += batchRes.policiesSynced || 0;
        setSyncProgress({ offset: batchRes.nextOffset || offset, total: batchRes.total || 0 });

        if (batchRes.done) break;
        offset = batchRes.nextOffset || offset;
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      }

      setFinalizing(false);
      setSyncProgress(null);
      setPendingUploadId(null);

      setResult({
        imported: res.imported || 0,
        skipped: res.skipped || 0,
        errors: res.errors || 0,
        agentsAdded: totalAgentsAdded,
        agentsUpdated: totalAgentsUpdated,
        policiesSynced: totalPoliciesSynced,
      });
      setStep("done");
    } catch (err) {
      setFinalizing(false);
      setChunkProgress(null);
      setError(err instanceof Error ? err.message : "Processing failed");
    }
  };

  const handleRetryFinalize = async () => {
    if (!pendingUploadId) return;
    setError("");
    setStep("processing");
    setFinalizing(true);
    syncAbortRef.current = false;
    setSyncProgress({ offset: 0, total: 0 });

    const BATCH_SIZE = 500;
    const DELAY_MS = 120_000;
    let offset = 0;
    let totalAgentsAdded = 0;
    let totalAgentsUpdated = 0;
    let totalPoliciesSynced = 0;

    try {
      while (!syncAbortRef.current) {
        const batchRes = await adminResyncPolicies(token, pendingUploadId, offset, BATCH_SIZE);
        if (batchRes.error && !batchRes.done) throw new Error(batchRes.error);

        totalAgentsAdded += batchRes.agentsAdded || 0;
        totalAgentsUpdated += batchRes.agentsUpdated || 0;
        totalPoliciesSynced += batchRes.policiesSynced || 0;
        setSyncProgress({ offset: batchRes.nextOffset || offset, total: batchRes.total || 0 });

        if (batchRes.done) break;
        offset = batchRes.nextOffset || offset;
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      }

      setFinalizing(false);
      setSyncProgress(null);
      setPendingUploadId(null);
      setResult({
        imported: rows.length,
        skipped: 0,
        errors: 0,
        agentsAdded: totalAgentsAdded,
        agentsUpdated: totalAgentsUpdated,
        policiesSynced: totalPoliciesSynced,
      });
      setStep("done");
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
        <span className="text-sm font-medium text-white">Upload to {source.name}</span>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs">
        {(["carrier", "file", "mapping", "done"] as const).map((s, i) => {
          const labels = ["Carrier", "File", "Map Columns", "Complete"];
          const stepOrder = { carrier: 0, file: 1, mapping: 2, processing: 2, done: 3 };
          const current = stepOrder[step];
          const active = i === current;
          const completed = i < current;
          return (
            <div key={s} className="flex items-center gap-2">
              {i > 0 && <div className={`w-8 h-px ${completed ? "bg-gold" : "bg-slate-700/50"}`} />}
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full ${
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
            Choose the carrier this data belongs to. This labels all records in this upload.
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
              onClick={() => setStep("file")}
              disabled={!carrier.trim()}
              className="px-5 py-2.5 text-sm font-medium text-navy-dark bg-gold rounded-lg hover:bg-gold-light disabled:opacity-50 transition-colors"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Step: File Upload */}
      {step === "file" && (
        <div className="bg-navy rounded-xl border border-slate-700/50 p-6">
          <h4 className="text-sm font-semibold text-white mb-4">Upload CSV File</h4>
          <div
            className={`border-2 border-dashed rounded-lg p-10 text-center transition-all cursor-pointer ${
              dragOver
                ? "border-gold bg-gold/10"
                : "border-slate-700/50 hover:border-slate-600 hover:bg-navy-light/30"
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="flex flex-col items-center gap-3">
              <div className="w-14 h-14 bg-navy-light rounded-xl flex items-center justify-center">
                <Upload className="text-slate-400" size={26} />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-200">Drop CSV file here or click to browse</p>
                <p className="text-xs text-slate-400 mt-1.5">
                  Carrier: <span className="font-medium text-slate-300">{carrier}</span>
                </p>
              </div>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileSelect(file);
            }}
          />
        </div>
      )}

      {/* Step: Column Mapping */}
      {step === "mapping" && (
        <ColumnMapper
          headers={headers}
          sampleRows={rows.slice(0, 5)}
          savedMappings={savedMappings}
          initialMappings={currentMappings}
          hasSavedMapping={hasSavedMapping}
          onProcess={handleProcess}
          onBack={() => setStep("file")}
          totalRows={rows.length}
          filename={filename}
        />
      )}

      {/* Step: Processing */}
      {step === "processing" && (
        <div className="bg-navy rounded-xl border border-slate-700/50 p-6">
          <div className="flex flex-col items-center gap-3 py-10">
            <Loader2 className="animate-spin text-gold" size={32} />
            <p className="text-sm font-medium text-slate-200">Processing {rows.length.toLocaleString()} records...</p>
            {finalizing ? (
              <div className="w-64 space-y-2">
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
            ) : chunkProgress && chunkProgress.total > 1 ? (
              <div className="w-64 space-y-2">
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Uploading batch {chunkProgress.current} of {chunkProgress.total}</span>
                  <span>{Math.round((chunkProgress.current / chunkProgress.total) * 100)}%</span>
                </div>
                <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gold rounded-full transition-all duration-300"
                    style={{ width: `${(chunkProgress.current / chunkProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400">Applying column mappings and importing data</p>
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
              <p className="text-sm font-semibold text-emerald-300">Import Complete</p>
              <p className="text-xs text-emerald-400">{filename}</p>
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
