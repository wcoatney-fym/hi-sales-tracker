import { useState, useEffect, useCallback } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Merge,
  EyeOff,
  ScanSearch,
  Users,
  Copy,
  History,
} from "lucide-react";
import {
  adminGetAuditIssues,
  adminResolveAuditIssue,
  adminGetAuditSummary,
  adminScanAuditDuplicates,
} from "../../lib/api";
import ConfirmDialog from "../ui/ConfirmDialog";
import DuplicatePoliciesPanel from "./DuplicatePoliciesPanel";
import UploadHistoryPanel from "./UploadHistoryPanel";

interface AuditIssue {
  id: string;
  issue_type: string;
  severity: string;
  title: string;
  description: string;
  entity_ids: string[];
  metadata: {
    first_name?: string;
    last_name?: string;
    writing_number_1?: string;
    writing_number_2?: string;
    keep_id?: string;
    remove_id?: string;
    agency_id?: string;
  };
  status: string;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

interface AuditPanelProps {
  token: string;
}

type StatusFilter = "open" | "resolved" | "dismissed";
type AuditTab = "agents" | "policies" | "history";

export default function AuditPanel({ token }: AuditPanelProps) {
  const [activeTab, setActiveTab] = useState<AuditTab>("agents");

  const TABS: { key: AuditTab; label: string; icon: React.ElementType }[] = [
    { key: "agents", label: "Agent Issues", icon: Users },
    { key: "policies", label: "Duplicate Policies", icon: Copy },
    { key: "history", label: "Upload History", icon: History },
  ];

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="flex items-center gap-1 border-b border-slate-700/50 pb-px">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-sky-500 text-white"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === "agents" && <AgentIssuesTab token={token} />}
      {activeTab === "policies" && <DuplicatePoliciesPanel token={token} />}
      {activeTab === "history" && <UploadHistoryPanel token={token} />}
    </div>
  );
}

function AgentIssuesTab({ token }: { token: string }) {
  const [issues, setIssues] = useState<AuditIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [counts, setCounts] = useState({ open: 0, resolved: 0, dismissed: 0 });
  const [resolving, setResolving] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<{
    issue: AuditIssue;
    action: "merge" | "dismiss";
  } | null>(null);

  const fetchIssues = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await adminGetAuditIssues(token, statusFilter);
      setIssues(result.issues || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load audit issues");
    } finally {
      setLoading(false);
    }
  }, [token, statusFilter]);

  const fetchSummary = useCallback(async () => {
    try {
      const result = await adminGetAuditSummary(token);
      setCounts(result.counts || { open: 0, resolved: 0, dismissed: 0 });
    } catch {
      /* ignore */
    }
  }, [token]);

  useEffect(() => {
    fetchIssues();
    fetchSummary();
  }, [fetchIssues, fetchSummary]);

  const handleResolve = async (issueId: string, resolution: "merge" | "dismiss") => {
    setResolving(issueId);
    try {
      await adminResolveAuditIssue(token, issueId, resolution);
      await fetchIssues();
      await fetchSummary();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to resolve issue");
    } finally {
      setResolving(null);
      setConfirmTarget(null);
    }
  };

  const handleScan = async () => {
    setScanning(true);
    try {
      const result = await adminScanAuditDuplicates(token);
      if (result.found > 0) {
        await fetchIssues();
        await fetchSummary();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const FILTER_TABS: { key: StatusFilter; label: string; count: number }[] = [
    { key: "open", label: "Open", count: counts.open },
    { key: "resolved", label: "Resolved", count: counts.resolved },
    { key: "dismissed", label: "Dismissed", count: counts.dismissed },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-white">Data Audit</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Review and resolve duplicate agents, data conflicts, and inconsistencies
          </p>
        </div>
        <button
          onClick={handleScan}
          disabled={scanning}
          className="flex items-center gap-2 px-3 py-2 bg-slate-700/50 hover:bg-slate-700 border border-slate-600/50 rounded-lg text-sm text-slate-300 hover:text-white transition-colors disabled:opacity-50"
        >
          {scanning ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <ScanSearch size={14} />
          )}
          {scanning ? "Scanning..." : "Run Scan"}
        </button>
      </div>

      {/* Status Filter Tabs */}
      <div className="flex items-center gap-1 bg-slate-800/50 rounded-lg p-1 w-fit">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              statusFilter === tab.key
                ? "bg-slate-700 text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span
                className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold ${
                  tab.key === "open"
                    ? "bg-amber-500/20 text-amber-400"
                    : "bg-slate-600/50 text-slate-400"
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <XCircle size={14} className="text-red-400 shrink-0" />
          <p className="text-xs text-red-300">{error}</p>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-xs text-red-400 hover:text-red-300"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={20} className="animate-spin text-slate-400" />
        </div>
      )}

      {/* Empty */}
      {!loading && issues.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <CheckCircle2 size={32} className="text-emerald-400/50 mb-3" />
          <p className="text-sm text-slate-400">
            {statusFilter === "open"
              ? "No open issues found. Your data looks clean!"
              : `No ${statusFilter} issues.`}
          </p>
        </div>
      )}

      {/* Issues List */}
      {!loading && issues.length > 0 && (
        <div className="space-y-3">
          {issues.map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              resolving={resolving === issue.id}
              onMerge={() => setConfirmTarget({ issue, action: "merge" })}
              onDismiss={() => setConfirmTarget({ issue, action: "dismiss" })}
            />
          ))}
        </div>
      )}

      {/* Confirm Dialog */}
      {confirmTarget && (
        <ConfirmDialog
          open={true}
          title={
            confirmTarget.action === "merge"
              ? "Merge Duplicate Agent"
              : "Dismiss Issue"
          }
          message={
            confirmTarget.action === "merge"
              ? `This will merge "${confirmTarget.issue.metadata.first_name} ${confirmTarget.issue.metadata.last_name}" into a single record, storing the second writing number (${confirmTarget.issue.metadata.writing_number_2}) as an additional UNL number. The duplicate record will be deleted.`
              : `This will dismiss the issue for "${confirmTarget.issue.metadata.first_name} ${confirmTarget.issue.metadata.last_name}" without taking action. You can still view it in the Dismissed tab.`
          }
          confirmLabel={confirmTarget.action === "merge" ? "Merge" : "Dismiss"}
          onConfirm={() =>
            handleResolve(confirmTarget.issue.id, confirmTarget.action)
          }
          onCancel={() => setConfirmTarget(null)}
          loading={resolving === confirmTarget.issue.id}
        />
      )}
    </div>
  );
}

function IssueCard({
  issue,
  resolving,
  onMerge,
  onDismiss,
}: {
  issue: AuditIssue;
  resolving: boolean;
  onMerge: () => void;
  onDismiss: () => void;
}) {
  const meta = issue.metadata;
  const isOpen = issue.status === "open";

  return (
    <div
      className={`rounded-xl border p-4 transition-colors ${
        isOpen
          ? "bg-navy border-slate-700/50 hover:border-amber-500/30"
          : "bg-slate-800/30 border-slate-700/30 opacity-75"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
              issue.severity === "error"
                ? "bg-red-500/10"
                : "bg-amber-500/10"
            }`}
          >
            <AlertTriangle
              size={14}
              className={
                issue.severity === "error"
                  ? "text-red-400"
                  : "text-amber-400"
              }
            />
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-white truncate">
              {issue.title}
            </h4>
            <p className="text-xs text-slate-400 mt-0.5">{issue.description}</p>

            {/* Writing number details */}
            {meta.writing_number_1 && (
              <div className="flex flex-wrap items-center gap-2 mt-2.5">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-sky-500/10 border border-sky-500/20 rounded text-[11px] font-mono text-sky-300">
                  {meta.writing_number_1}
                </span>
                <span className="text-[10px] text-slate-500">+</span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-teal-500/10 border border-teal-500/20 rounded text-[11px] font-mono text-teal-300">
                  {meta.writing_number_2}
                </span>
              </div>
            )}

            {/* Resolved info */}
            {!isOpen && issue.resolved_at && (
              <p className="text-[10px] text-slate-500 mt-2">
                {issue.status === "resolved" ? "Merged" : "Dismissed"} on{" "}
                {new Date(issue.resolved_at).toLocaleDateString()} by{" "}
                {issue.resolved_by || "admin"}
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        {isOpen && (
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={onMerge}
              disabled={resolving}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-lg text-xs font-medium text-emerald-400 transition-colors disabled:opacity-50"
            >
              {resolving ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Merge size={12} />
              )}
              Merge
            </button>
            <button
              onClick={onDismiss}
              disabled={resolving}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-700/50 hover:bg-slate-700 border border-slate-600/50 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-50"
            >
              <EyeOff size={12} />
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
