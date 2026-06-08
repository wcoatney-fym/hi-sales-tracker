import { useState, useEffect, useCallback, useRef, Component } from "react";
import {
  Database,
  Plus,
  Trash2,
  Upload,
  Clock,
  FileText,
  ChevronRight,
  Loader2,
  Globe,
  Webhook,
  Settings,
  Save,
  Play,
  RotateCcw,
  ServerCrash,
  AlertCircle,
} from "lucide-react";
import {
  adminListDataSources,
  adminCreateDataSource,
  adminDeleteDataSource,
  adminGetSourceUploads,
  adminUpdateDataSource,
  adminTriggerPoll,
  adminRevertSourceUpload,
  adminDeleteSourceUpload,
  adminResyncPolicies,
  adminTestSqlConnection,
} from "../../lib/api";
import SourceUploadFlow from "./SourceUploadFlow";
import SqlImportFlow from "./SqlImportFlow";
import SourceRecordsTable from "./SourceRecordsTable";
import ConfirmDialog from "../ui/ConfirmDialog";

class ImportErrorBoundary extends Component<
  { children: React.ReactNode; onReset: () => void },
  { hasError: boolean; error: string }
> {
  state = { hasError: false, error: "" };
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message || "An unexpected error occurred" };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-navy rounded-xl border border-red-700/50 p-6 text-center">
          <AlertCircle className="text-red-400 mx-auto mb-3" size={32} />
          <h3 className="text-sm font-semibold text-white mb-2">SQL Import Error</h3>
          <p className="text-xs text-slate-400 mb-4 max-w-md mx-auto">{this.state.error}</p>
          <button
            onClick={() => { this.setState({ hasError: false, error: "" }); this.props.onReset(); }}
            className="px-4 py-2 text-sm font-medium text-navy-dark bg-gold rounded-lg hover:bg-gold-light transition-colors"
          >
            Go Back
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

interface DataSource {
  id: string;
  name: string;
  type: string;
  description: string;
  api_url: string | null;
  api_key_secret_name: string | null;
  poll_interval: string | null;
  last_polled_at: string | null;
  created_at: string;
  last_upload: string | null;
  total_records: number;
  db_host: string | null;
  db_port: number | null;
  db_name: string | null;
  db_schema: string | null;
  db_table: string | null;
  db_user: string | null;
  db_password_secret_name: string | null;
}

interface SourceUpload {
  id: string;
  data_source_id: string;
  carrier: string;
  filename: string;
  row_count: number;
  status: string;
  uploaded_by: string;
  created_at: string;
  is_active: boolean;
}

type View = "list" | "detail" | "upload" | "sql-import" | "records";

export default function DataSourcesPanel({ token }: { token: string }) {
  const [sources, setSources] = useState<DataSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("list");
  const [selectedSource, setSelectedSource] = useState<DataSource | null>(null);
  const [uploads, setUploads] = useState<SourceUpload[]>([]);
  const [selectedUpload, setSelectedUpload] = useState<SourceUpload | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newType, setNewType] = useState<string>("csv_upload");
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DataSource | null>(null);
  const [apiConfig, setApiConfig] = useState({ apiUrl: "", apiKeySecretName: "", pollInterval: "" });
  const [sqlConfig, setSqlConfig] = useState({ dbHost: "", dbPort: "", dbName: "", dbSchema: "public", dbTable: "", dbUser: "", dbPasswordSecretName: "", dbPassword: "" });
  const [savingConfig, setSavingConfig] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    diagnostics?: {
      source: string;
      length: number;
      byteLength: number;
      sha256Prefix: string;
      hasLeadingWhitespace: boolean;
      hasTrailingWhitespace: boolean;
      nonAsciiCount: number;
      controlCharCount: number;
    };
    errorCode?: string;
  } | null>(null);
  const [polling, setPolling] = useState(false);
  const [pollResult, setPollResult] = useState<{ success: boolean; message: string } | null>(null);
  const [revertTarget, setRevertTarget] = useState<SourceUpload | null>(null);
  const [reverting, setReverting] = useState(false);
  const [uploadDeleteTarget, setUploadDeleteTarget] = useState<SourceUpload | null>(null);
  const [deletingUpload, setDeletingUpload] = useState(false);
  const [syncingUploadId, setSyncingUploadId] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<{ offset: number; total: number } | null>(null);
  const syncAbortRef = useRef(false);

  const fetchSources = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminListDataSources(token);
      setSources(res.sources || []);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const dbConfig = newType === "sql_import" ? {
        dbHost: sqlConfig.dbHost || undefined,
        dbPort: sqlConfig.dbPort ? parseInt(sqlConfig.dbPort, 10) : undefined,
        dbName: sqlConfig.dbName || undefined,
        dbSchema: sqlConfig.dbSchema || undefined,
        dbTable: sqlConfig.dbTable || undefined,
        dbUser: sqlConfig.dbUser || undefined,
        dbPasswordSecretName: sqlConfig.dbPasswordSecretName || undefined,
      } : undefined;
      await adminCreateDataSource(token, newName.trim(), newDesc.trim(), newType, undefined, undefined, undefined, dbConfig);
      setNewName("");
      setNewDesc("");
      setNewType("csv_upload");
      setSqlConfig({ dbHost: "", dbPort: "", dbName: "", dbSchema: "public", dbTable: "", dbUser: "", dbPasswordSecretName: "", dbPassword: "" });
      setShowCreateForm(false);
      await fetchSources();
    } finally {
      setCreating(false);
    }
  };

  const handleSaveApiConfig = async () => {
    if (!selectedSource) return;
    setSavingConfig(true);
    try {
      await adminUpdateDataSource(token, selectedSource.id, {
        apiUrl: apiConfig.apiUrl || undefined,
        apiKeySecretName: apiConfig.apiKeySecretName || undefined,
        pollInterval: apiConfig.pollInterval || undefined,
      });
      const res = await adminListDataSources(token);
      setSources(res.sources || []);
      const updated = (res.sources || []).find((s: DataSource) => s.id === selectedSource.id);
      if (updated) setSelectedSource(updated);
    } finally {
      setSavingConfig(false);
    }
  };

  const handleSaveSqlConfig = async () => {
    if (!selectedSource) return;
    setSavingConfig(true);
    try {
      await adminUpdateDataSource(token, selectedSource.id, {
        dbHost: sqlConfig.dbHost || undefined,
        dbPort: sqlConfig.dbPort ? parseInt(sqlConfig.dbPort, 10) : undefined,
        dbName: sqlConfig.dbName || undefined,
        dbSchema: sqlConfig.dbSchema || undefined,
        dbTable: sqlConfig.dbTable || undefined,
        dbUser: sqlConfig.dbUser || undefined,
        dbPasswordSecretName: sqlConfig.dbPasswordSecretName || undefined,
      });
      const res = await adminListDataSources(token);
      setSources(res.sources || []);
      const updated = (res.sources || []).find((s: DataSource) => s.id === selectedSource.id);
      if (updated) setSelectedSource(updated);
    } finally {
      setSavingConfig(false);
    }
  };

  const handleTestConnection = async () => {
    if (!selectedSource) return;
    setTestingConnection(true);
    setTestResult(null);
    try {
      const res = await adminTestSqlConnection(token, selectedSource.id, sqlConfig.dbPassword || undefined);
      if (res.error) {
        setTestResult({
          success: false,
          message: res.error,
          diagnostics: res.passwordDiagnostics,
          errorCode: res.errorCode,
        });
      } else {
        setTestResult({
          success: true,
          message: `Connected successfully. Found ${res.total.toLocaleString()} rows, ${res.columns.length} columns.`,
          diagnostics: res.passwordDiagnostics,
        });
      }
    } catch (err: unknown) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : "Connection failed" });
    } finally {
      setTestingConnection(false);
    }
  };

  const handlePullNow = async () => {
    if (!selectedSource) return;
    setPolling(true);
    setPollResult(null);
    try {
      const res = await adminTriggerPoll(token, selectedSource.id);
      if (res.error) {
        setPollResult({ success: false, message: res.error });
      } else {
        setPollResult({ success: true, message: `Pulled ${res.records_fetched} records` });
        const listRes = await adminListDataSources(token);
        setSources(listRes.sources || []);
        const updated = (listRes.sources || []).find((s: DataSource) => s.id === selectedSource.id);
        if (updated) setSelectedSource(updated);
        const uploadsRes = await adminGetSourceUploads(token, selectedSource.id);
        setUploads(uploadsRes.uploads || []);
      }
    } catch (err: unknown) {
      setPollResult({ success: false, message: err instanceof Error ? err.message : "Poll failed" });
    } finally {
      setPolling(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await adminDeleteDataSource(token, deleteTarget.id);
    setDeleteTarget(null);
    await fetchSources();
  };

  const handleRevert = async () => {
    if (!revertTarget || !selectedSource) return;
    setReverting(true);
    try {
      await adminRevertSourceUpload(token, revertTarget.id);
      const res = await adminGetSourceUploads(token, selectedSource.id);
      setUploads(res.uploads || []);
      await fetchSources();
    } finally {
      setReverting(false);
      setRevertTarget(null);
    }
  };

  const handleDeleteUpload = async () => {
    if (!uploadDeleteTarget || !selectedSource) return;
    setDeletingUpload(true);
    try {
      await adminDeleteSourceUpload(token, uploadDeleteTarget.id);
      const res = await adminGetSourceUploads(token, selectedSource.id);
      setUploads(res.uploads || []);
    } finally {
      setDeletingUpload(false);
      setUploadDeleteTarget(null);
    }
  };

  const handleResync = async (uploadId: string) => {
    if (!selectedSource) return;
    syncAbortRef.current = false;
    setSyncingUploadId(uploadId);
    setSyncProgress({ offset: 0, total: 0 });

    const BATCH_SIZE = 500;
    const DELAY_MS = 120_000; // 2 minutes between batches
    let offset = 0;

    try {
      while (!syncAbortRef.current) {
        const res = await adminResyncPolicies(token, uploadId, offset, BATCH_SIZE);
        if (res.error && !res.done) throw new Error(res.error);

        const total = res.total || 0;
        const nextOffset = res.nextOffset || offset;
        setSyncProgress({ offset: nextOffset, total });

        if (res.done) break;

        offset = nextOffset;
        // Wait between batches
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      }

      const uploadsRes = await adminGetSourceUploads(token, selectedSource.id);
      setUploads(uploadsRes.uploads || []);
    } catch (_) {
      // error already persisted server-side
    } finally {
      setSyncingUploadId(null);
      setSyncProgress(null);
    }
  };

  const handleCancelSync = () => {
    syncAbortRef.current = true;
  };

  const openDetail = async (source: DataSource) => {
    setSelectedSource(source);
    setApiConfig({
      apiUrl: source.api_url || "",
      apiKeySecretName: source.api_key_secret_name || "",
      pollInterval: source.poll_interval || "",
    });
    setSqlConfig({
      dbHost: source.db_host || "",
      dbPort: source.db_port ? String(source.db_port) : "",
      dbName: source.db_name || "",
      dbSchema: source.db_schema || "public",
      dbTable: source.db_table || "",
      dbUser: source.db_user || "",
      dbPasswordSecretName: source.db_password_secret_name || "",
      dbPassword: "",
    });
    setTestResult(null);
    setView("detail");
    const res = await adminGetSourceUploads(token, source.id);
    setUploads(res.uploads || []);
  };

  const openRecords = (upload: SourceUpload) => {
    setSelectedUpload(upload);
    setView("records");
  };

  if (view === "upload" && selectedSource) {
    return (
      <SourceUploadFlow
        token={token}
        source={selectedSource}
        onBack={() => {
          setView("detail");
          adminGetSourceUploads(token, selectedSource.id).then((r) =>
            setUploads(r.uploads || [])
          );
        }}
        onComplete={() => {
          setView("detail");
          adminGetSourceUploads(token, selectedSource.id).then((r) =>
            setUploads(r.uploads || [])
          );
          fetchSources();
        }}
      />
    );
  }

  if (view === "sql-import" && selectedSource) {
    return (
      <ImportErrorBoundary onReset={() => { setView("detail"); }}>
        <SqlImportFlow
          token={token}
          source={selectedSource}
          onBack={() => {
            setView("detail");
            adminGetSourceUploads(token, selectedSource.id).then((r) =>
              setUploads(r.uploads || [])
            );
          }}
          onComplete={() => {
            setView("detail");
            adminGetSourceUploads(token, selectedSource.id).then((r) =>
              setUploads(r.uploads || [])
            );
            fetchSources();
          }}
        />
      </ImportErrorBoundary>
    );
  }

  if (view === "records" && selectedUpload) {
    return (
      <SourceRecordsTable
        token={token}
        upload={selectedUpload}
        onBack={() => setView("detail")}
      />
    );
  }

  if (view === "detail" && selectedSource) {
    return (
    <>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setView("list"); setSelectedSource(null); }}
            className="text-sm text-slate-400 hover:text-slate-200 transition-colors"
          >
            Data Sources
          </button>
          <ChevronRight size={14} className="text-slate-400" />
          <span className="text-sm font-medium text-white">{selectedSource.name}</span>
        </div>

        <div className="bg-navy rounded-xl shadow-sm border border-slate-700/50 p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-white">{selectedSource.name}</h3>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                  selectedSource.type === "csv_upload"
                    ? "bg-navy-light text-slate-300"
                    : selectedSource.type === "api_pull"
                    ? "bg-blue-900/30 text-blue-300"
                    : selectedSource.type === "sql_import"
                    ? "bg-emerald-900/30 text-emerald-300"
                    : "bg-amber-900/30 text-amber-300"
                }`}>
                  {selectedSource.type === "csv_upload" && <FileText size={10} />}
                  {selectedSource.type === "api_pull" && <Globe size={10} />}
                  {selectedSource.type === "api_push" && <Webhook size={10} />}
                  {selectedSource.type === "sql_import" && <Database size={10} />}
                  {selectedSource.type === "csv_upload" ? "CSV Upload" : selectedSource.type === "api_pull" ? "API Pull" : selectedSource.type === "sql_import" ? "SQL Import" : "API Push"}
                </span>
              </div>
              {selectedSource.description && (
                <p className="text-sm text-slate-400 mt-1">{selectedSource.description}</p>
              )}
            </div>
            {selectedSource.type === "csv_upload" && (
              <button
                onClick={() => setView("upload")}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-navy-dark bg-gold rounded-lg hover:bg-gold-light transition-colors"
              >
                <Upload size={16} />
                Upload Data
              </button>
            )}
            {selectedSource.type === "sql_import" && (
              <button
                onClick={() => setView("sql-import")}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-navy-dark bg-gold rounded-lg hover:bg-gold-light transition-colors"
              >
                <Database size={16} />
                Import Data
              </button>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-navy-light/50 rounded-lg p-4 border border-slate-700/30">
              <p className="text-2xl font-bold text-white">{selectedSource.total_records.toLocaleString()}</p>
              <p className="text-xs text-slate-400 mt-1">Total Records</p>
            </div>
            <div className="bg-navy-light/50 rounded-lg p-4 border border-slate-700/30">
              <p className="text-2xl font-bold text-white">{uploads.length}</p>
              <p className="text-xs text-slate-400 mt-1">Uploads</p>
            </div>
            <div className="bg-navy-light/50 rounded-lg p-4 border border-slate-700/30">
              <p className="text-2xl font-bold text-white">
                {selectedSource.last_upload
                  ? new Date(selectedSource.last_upload).toLocaleDateString()
                  : "Never"}
              </p>
              <p className="text-xs text-slate-400 mt-1">Last Upload</p>
            </div>
          </div>

          {(selectedSource.type === "api_pull" || selectedSource.type === "api_push") && (
            <div className="mb-6 p-5 bg-navy-light/50 rounded-lg border border-slate-700/50">
              <div className="flex items-center gap-2 mb-4">
                <Settings size={16} className="text-slate-400" />
                <h4 className="text-sm font-semibold text-slate-200">
                  API Configuration
                </h4>
                {selectedSource.type === "api_push" && (
                  <span className="ml-auto text-[10px] bg-amber-900/30 text-amber-300 px-2 py-0.5 rounded-full font-medium">
                    Webhook endpoint -- records will be pushed here
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    {selectedSource.type === "api_pull" ? "API Endpoint URL" : "Webhook Receive URL"}
                  </label>
                  <input
                    type="text"
                    placeholder={selectedSource.type === "api_pull" ? "https://api.carrier.com/v1/policies" : "Will be generated once API is connected"}
                    value={apiConfig.apiUrl}
                    onChange={(e) => setApiConfig({ ...apiConfig, apiUrl: e.target.value })}
                    className="w-full px-3 py-2.5 text-sm border border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold bg-navy-light text-white font-mono"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      API Key / Secret Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g., CARRIER_API_KEY"
                      value={apiConfig.apiKeySecretName}
                      onChange={(e) => setApiConfig({ ...apiConfig, apiKeySecretName: e.target.value })}
                      className="w-full px-3 py-2.5 text-sm border border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold bg-navy-light text-white"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">Reference name for the secret stored in environment</p>
                  </div>
                  {selectedSource.type === "api_pull" && (
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        Poll Interval
                      </label>
                      <select
                        value={apiConfig.pollInterval}
                        onChange={(e) => setApiConfig({ ...apiConfig, pollInterval: e.target.value })}
                        className="w-full px-3 py-2.5 text-sm border border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold bg-navy-light text-white"
                      >
                        <option value="">Not configured</option>
                        <option value="15 minutes">Every 15 minutes</option>
                        <option value="1 hour">Every hour</option>
                        <option value="6 hours">Every 6 hours</option>
                        <option value="12 hours">Every 12 hours</option>
                        <option value="1 day">Daily</option>
                      </select>
                    </div>
                  )}
                </div>
              </div>
              {pollResult && (
                <div className={`mt-3 px-3 py-2 rounded-lg text-xs font-medium ${pollResult.success ? "bg-emerald-900/30 text-emerald-300 border border-emerald-700/50" : "bg-red-900/30 text-red-300 border border-red-700/50"}`}>
                  {pollResult.message}
                </div>
              )}
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-700/50">
                <div className="text-xs text-slate-400">
                  {selectedSource.last_polled_at
                    ? `Last polled: ${new Date(selectedSource.last_polled_at).toLocaleString()}`
                    : "Not yet connected"}
                </div>
                <div className="flex items-center gap-2">
                  {selectedSource.type === "api_pull" && selectedSource.api_url && (
                    <button
                      onClick={handlePullNow}
                      disabled={polling}
                      className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                    >
                      {polling ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                      {polling ? "Pulling..." : "Pull Now"}
                    </button>
                  )}
                  <button
                    onClick={handleSaveApiConfig}
                    disabled={savingConfig}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-navy-dark bg-gold rounded-lg hover:bg-gold-light disabled:opacity-50 transition-colors"
                  >
                    <Save size={14} />
                    {savingConfig ? "Saving..." : "Save Configuration"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {selectedSource.type === "sql_import" && (
            <div className="mb-6 p-5 bg-navy-light/50 rounded-lg border border-slate-700/50">
              <div className="flex items-center gap-2 mb-4">
                <ServerCrash size={16} className="text-slate-400" />
                <h4 className="text-sm font-semibold text-slate-200">
                  SQL Database Configuration
                </h4>
              </div>
              <div className="grid grid-cols-1 gap-3">
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-300 mb-1">Host</label>
                    <input
                      type="text"
                      placeholder="e.g., db.example.com"
                      value={sqlConfig.dbHost}
                      onChange={(e) => setSqlConfig({ ...sqlConfig, dbHost: e.target.value })}
                      className="w-full px-3 py-2.5 text-sm border border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold bg-navy-light text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Port</label>
                    <input
                      type="text"
                      placeholder="5432"
                      value={sqlConfig.dbPort}
                      onChange={(e) => setSqlConfig({ ...sqlConfig, dbPort: e.target.value })}
                      className="w-full px-3 py-2.5 text-sm border border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold bg-navy-light text-white font-mono"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Database</label>
                    <input
                      type="text"
                      placeholder="analytics"
                      value={sqlConfig.dbName}
                      onChange={(e) => setSqlConfig({ ...sqlConfig, dbName: e.target.value })}
                      className="w-full px-3 py-2.5 text-sm border border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold bg-navy-light text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Schema</label>
                    <input
                      type="text"
                      placeholder="public"
                      value={sqlConfig.dbSchema}
                      onChange={(e) => setSqlConfig({ ...sqlConfig, dbSchema: e.target.value })}
                      className="w-full px-3 py-2.5 text-sm border border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold bg-navy-light text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Table</label>
                    <input
                      type="text"
                      placeholder="unl_fym_policy"
                      value={sqlConfig.dbTable}
                      onChange={(e) => setSqlConfig({ ...sqlConfig, dbTable: e.target.value })}
                      className="w-full px-3 py-2.5 text-sm border border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold bg-navy-light text-white"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Username</label>
                    <input
                      type="text"
                      placeholder="db_reader"
                      value={sqlConfig.dbUser}
                      onChange={(e) => setSqlConfig({ ...sqlConfig, dbUser: e.target.value })}
                      className="w-full px-3 py-2.5 text-sm border border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold bg-navy-light text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Password</label>
                    <input
                      type="password"
                      placeholder="Enter password directly"
                      value={sqlConfig.dbPassword}
                      onChange={(e) => setSqlConfig({ ...sqlConfig, dbPassword: e.target.value })}
                      className="w-full px-3 py-2.5 text-sm border border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold bg-navy-light text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Password Secret Name</label>
                    <input
                      type="text"
                      placeholder="DB_PASSWORD"
                      value={sqlConfig.dbPasswordSecretName}
                      onChange={(e) => setSqlConfig({ ...sqlConfig, dbPasswordSecretName: e.target.value })}
                      className="w-full px-3 py-2.5 text-sm border border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold bg-navy-light text-white"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">Fallback: env var name for password</p>
                  </div>
                </div>
              </div>
              {testResult && (
                <div className="mt-3 space-y-2">
                  <div className={`px-3 py-2 rounded-lg text-xs font-medium ${testResult.success ? "bg-emerald-900/30 text-emerald-300 border border-emerald-700/50" : "bg-red-900/30 text-red-300 border border-red-700/50"}`}>
                    {testResult.message}
                    {testResult.errorCode && <span className="ml-2 opacity-70">(code: {testResult.errorCode})</span>}
                  </div>
                  {testResult.diagnostics && (
                    <div className="px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50 text-xs text-slate-300 font-mono space-y-1">
                      <div className="text-slate-400 font-sans font-semibold mb-1">Password diagnostics</div>
                      <div>source: <span className="text-slate-100">{testResult.diagnostics.source}</span></div>
                      <div>length: <span className="text-slate-100">{testResult.diagnostics.length}</span> chars / <span className="text-slate-100">{testResult.diagnostics.byteLength}</span> bytes</div>
                      <div>sha256 prefix: <span className="text-slate-100">{testResult.diagnostics.sha256Prefix}</span></div>
                      <div className={testResult.diagnostics.hasLeadingWhitespace ? "text-amber-300" : ""}>leading whitespace: {testResult.diagnostics.hasLeadingWhitespace ? "YES" : "no"}</div>
                      <div className={testResult.diagnostics.hasTrailingWhitespace ? "text-amber-300" : ""}>trailing whitespace: {testResult.diagnostics.hasTrailingWhitespace ? "YES" : "no"}</div>
                      <div className={testResult.diagnostics.nonAsciiCount > 0 ? "text-amber-300" : ""}>non-ASCII chars: {testResult.diagnostics.nonAsciiCount}</div>
                      <div className={testResult.diagnostics.controlCharCount > 0 ? "text-amber-300" : ""}>control chars: {testResult.diagnostics.controlCharCount}</div>
                      <div className="text-slate-500 font-sans pt-1">Compare sha256 prefix to: <span className="text-slate-300">echo -n 'YOUR_PASSWORD' | sha256sum</span></div>
                    </div>
                  )}
                </div>
              )}
              <div className="flex items-center justify-end gap-2 mt-4 pt-4 border-t border-slate-700/50">
                <button
                  onClick={handleTestConnection}
                  disabled={testingConnection || !sqlConfig.dbHost || !sqlConfig.dbTable}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                >
                  {testingConnection ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                  {testingConnection ? "Testing..." : "Test Connection"}
                </button>
                <button
                  onClick={handleSaveSqlConfig}
                  disabled={savingConfig}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-navy-dark bg-gold rounded-lg hover:bg-gold-light disabled:opacity-50 transition-colors"
                >
                  <Save size={14} />
                  {savingConfig ? "Saving..." : "Save Configuration"}
                </button>
              </div>
            </div>
          )}

          {uploads.length === 0 ? (
            <div className="text-center py-10 border border-dashed border-slate-700/50 rounded-lg">
              <FileText size={32} className="mx-auto text-slate-500 mb-3" />
              <p className="text-sm text-slate-400">
                {selectedSource.type === "csv_upload"
                  ? "No uploads yet. Click \"Upload Data\" to get started."
                  : selectedSource.type === "sql_import"
                  ? "No imports yet. Click \"Import Data\" to pull from the database."
                  : "No data received yet. Configure the API connection above."}
              </p>
            </div>
          ) : (
            <div className="border border-slate-700/50 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-navy-light/50 border-b border-slate-700/50">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gold/80 text-xs uppercase tracking-wider">Filename</th>
                    <th className="text-left px-4 py-3 font-medium text-gold/80 text-xs uppercase tracking-wider">Carrier</th>
                    <th className="text-right px-4 py-3 font-medium text-gold/80 text-xs uppercase tracking-wider">Records</th>
                    <th className="text-left px-4 py-3 font-medium text-gold/80 text-xs uppercase tracking-wider">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-gold/80 text-xs uppercase tracking-wider">Date</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/30">
                  {uploads.map((u) => (
                    <tr key={u.id} className={`transition-colors ${u.is_active ? "bg-emerald-900/10" : "hover:bg-navy-light/30"}`}>
                      <td className="px-4 py-3 text-slate-200 font-medium">
                        <div className="flex items-center gap-2">
                          {u.filename}
                          {u.is_active && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-900/40 text-emerald-300 border border-emerald-700/50">
                              ACTIVE
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-300">{u.carrier}</td>
                      <td className="px-4 py-3 text-right text-slate-200 font-medium">{u.row_count.toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          u.status === "complete"
                            ? "bg-emerald-900/30 text-emerald-300 border border-emerald-700/50"
                            : u.status === "reverted"
                            ? "bg-slate-800/50 text-slate-400 border border-slate-600/50"
                            : u.status === "error"
                            ? "bg-red-900/30 text-red-400 border border-red-700/50"
                            : "bg-amber-900/30 text-amber-300 border border-amber-700/50"
                        }`}>
                          {u.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400">{new Date(u.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openRecords(u)}
                            className="text-gold hover:text-gold-light text-xs font-medium"
                          >
                            View
                          </button>
                          {(u.status === "complete" || u.status === "processing" || u.status === "error") && syncingUploadId !== u.id && (
                            <button
                              onClick={() => handleResync(u.id)}
                              disabled={!!syncingUploadId}
                              className="flex items-center gap-1 text-xs font-medium text-sky-400 hover:text-sky-300 disabled:opacity-50 transition-colors"
                            >
                              <Play size={11} />
                              Re-sync
                            </button>
                          )}
                          {syncingUploadId === u.id && (
                            <div className="flex items-center gap-3">
                              <Loader2 size={11} className="animate-spin text-sky-400 shrink-0" />
                              <div className="flex flex-col gap-1 min-w-[160px]">
                                <div className="flex justify-between text-xs">
                                  <span className="text-sky-300">
                                    {syncProgress && syncProgress.total > 0
                                      ? `${syncProgress.offset.toLocaleString()} / ${syncProgress.total.toLocaleString()}`
                                      : "Starting..."}
                                  </span>
                                  {syncProgress && syncProgress.total > 0 && (
                                    <span className="text-slate-400">
                                      {Math.round((syncProgress.offset / syncProgress.total) * 100)}%
                                    </span>
                                  )}
                                </div>
                                {syncProgress && syncProgress.total > 0 && (
                                  <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-sky-400 rounded-full transition-all duration-500"
                                      style={{ width: `${(syncProgress.offset / syncProgress.total) * 100}%` }}
                                    />
                                  </div>
                                )}
                              </div>
                              <button
                                onClick={handleCancelSync}
                                className="text-xs text-red-400 hover:text-red-300 font-medium shrink-0"
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                          {u.is_active && (
                            <button
                              onClick={() => setRevertTarget(u)}
                              className="flex items-center gap-1 text-xs font-medium text-red-400 hover:text-red-300 transition-colors"
                            >
                              <RotateCcw size={11} />
                              Revert
                            </button>
                          )}
                          <button
                            onClick={() => setUploadDeleteTarget(u)}
                            className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-red-400 transition-colors"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={!!uploadDeleteTarget}
        title="Delete Upload"
        message={uploadDeleteTarget ? `Permanently delete "${uploadDeleteTarget.filename}" and its ${uploadDeleteTarget.row_count.toLocaleString()} source records? Any synced policies will also be removed. This cannot be undone.` : ""}
        confirmLabel="Delete"
        variant="danger"
        loading={deletingUpload}
        onConfirm={handleDeleteUpload}
        onCancel={() => setUploadDeleteTarget(null)}
      />
    </>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-navy rounded-xl shadow-sm border border-slate-700/50 p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gold/10 flex items-center justify-center">
              <Database size={20} className="text-gold" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">Data Sources</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Configure and manage your data ingestion sources
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowCreateForm(true)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-navy-dark bg-gold rounded-lg hover:bg-gold-light transition-colors"
          >
            <Plus size={16} />
            Add Source
          </button>
        </div>

        {showCreateForm && (
          <div className="mb-6 p-4 bg-navy-light/50 rounded-lg border border-slate-700/50">
            <h4 className="text-sm font-medium text-slate-200 mb-3">New Data Source</h4>
            <div className="flex gap-2 mb-3">
              {[
                { value: "csv_upload", label: "CSV Upload", icon: FileText },
                { value: "sql_import", label: "SQL Import", icon: Database },
                { value: "api_pull", label: "API Pull", icon: Globe },
                { value: "api_push", label: "API Push (Webhook)", icon: Webhook },
              ].map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setNewType(value)}
                  className={`flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
                    newType === value
                      ? "border-gold bg-gold/10 text-gold"
                      : "border-slate-600 text-slate-300 hover:bg-navy-light"
                  }`}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <input
                type="text"
                placeholder="Source name (e.g., FYM Policy Export)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold bg-navy-light text-white"
              />
              <input
                type="text"
                placeholder="Description (optional)"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold bg-navy-light text-white"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
                className="px-4 py-2 text-sm font-medium text-navy-dark bg-gold rounded-lg hover:bg-gold-light disabled:opacity-50 transition-colors"
              >
                {creating ? "Creating..." : "Create"}
              </button>
              <button
                onClick={() => { setShowCreateForm(false); setNewName(""); setNewDesc(""); setNewType("csv_upload"); }}
                className="px-4 py-2 text-sm font-medium text-white bg-navy-light border border-slate-600 rounded-lg hover:bg-navy-mid transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="animate-spin text-gold" size={28} />
          </div>
        ) : sources.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-slate-700/50 rounded-lg">
            <Database size={36} className="mx-auto text-slate-500 mb-3" />
            <p className="text-sm text-slate-400 mb-1">No data sources configured yet</p>
            <p className="text-xs text-slate-400">Click "Add Source" to configure your first data feed.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {sources.map((source) => (
              <div
                key={source.id}
                className="flex items-center gap-4 p-4 border border-slate-700/50 rounded-lg hover:border-slate-600 hover:bg-navy-light/30 transition-all cursor-pointer group"
                onClick={() => openDetail(source)}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  source.type === "api_pull" ? "bg-blue-900/30" : source.type === "api_push" ? "bg-amber-900/30" : source.type === "sql_import" ? "bg-emerald-900/30" : "bg-navy-light"
                }`}>
                  {source.type === "api_pull" ? (
                    <Globe size={18} className="text-blue-400" />
                  ) : source.type === "api_push" ? (
                    <Webhook size={18} className="text-amber-400" />
                  ) : source.type === "sql_import" ? (
                    <Database size={18} className="text-emerald-400" />
                  ) : (
                    <FileText size={18} className="text-slate-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white">{source.name}</p>
                  {source.description && (
                    <p className="text-xs text-slate-400 mt-0.5 truncate">{source.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-6 flex-shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-semibold text-slate-200">{source.total_records.toLocaleString()}</p>
                    <p className="text-xs text-slate-400">records</p>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-1 text-xs text-slate-400">
                      <Clock size={12} />
                      {source.last_upload
                        ? new Date(source.last_upload).toLocaleDateString()
                        : "No uploads"}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(source); }}
                    className="p-2 text-slate-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                    title="Delete source"
                  >
                    <Trash2 size={16} />
                  </button>
                  <ChevronRight size={16} className="text-slate-500 group-hover:text-slate-300 transition-colors" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Data Source"
        message={deleteTarget ? `Are you sure you want to delete "${deleteTarget.name}"? This will remove all associated uploads and records.` : ""}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
      <ConfirmDialog
        open={!!revertTarget}
        title="Revert Upload"
        message={revertTarget ? `This will remove ${revertTarget.row_count.toLocaleString()} records from "${revertTarget.filename}" and restore the previous version. This cannot be undone.` : ""}
        confirmLabel={reverting ? "Reverting..." : "Revert"}
        variant="danger"
        onConfirm={handleRevert}
        onCancel={() => setRevertTarget(null)}
      />
    </div>
  );
}
