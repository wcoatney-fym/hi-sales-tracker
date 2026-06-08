import { useState } from "react";
import {
  CheckCircle2,
  Clock,
  Trash2,
  RotateCcw,
  FileText,
  AlertCircle,
  History,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { adminActivateRoster, adminDeleteRosterUpload } from "../../lib/api";
import ConfirmDialog from "../ui/ConfirmDialog";
import type { RosterUpload } from "../../types";

interface RosterHistoryProps {
  carrier: "UNL" | "GTL";
  uploads: RosterUpload[];
  token: string;
  onUpdate: () => void;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function RosterHistory({
  carrier,
  uploads,
  token,
  onUpdate,
}: RosterHistoryProps) {
  const [confirmAction, setConfirmAction] = useState<{
    type: "activate" | "delete";
    upload: RosterUpload;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);

  const PREVIEW_COUNT = 3;
  const carrierUploads = uploads.filter((u) => u.carrier === carrier);
  const activeUpload = carrierUploads.find((u) => u.is_active);
  const hasMore = carrierUploads.length > PREVIEW_COUNT;
  const visibleUploads = expanded
    ? carrierUploads
    : carrierUploads.slice(0, PREVIEW_COUNT);

  const handleConfirm = async () => {
    if (!confirmAction) return;
    setLoading(true);
    setError("");

    try {
      if (confirmAction.type === "activate") {
        await adminActivateRoster(token, confirmAction.upload.id);
      } else {
        await adminDeleteRosterUpload(token, confirmAction.upload.id);
      }
      setConfirmAction(null);
      onUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Operation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-navy rounded-xl shadow-sm border border-slate-700/50">
      <div className="flex items-center justify-between p-5 border-b border-slate-700/30">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-navy-light rounded-lg flex items-center justify-center">
            <History className="text-slate-400" size={18} />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">
              {carrier} Roster History
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {carrierUploads.length} version{carrierUploads.length !== 1 ? "s" : ""}
              {activeUpload && (
                <span className="ml-1">
                  &middot; {activeUpload.agent_count} active agents
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-5 mt-4 flex items-start gap-2 p-3 bg-red-900/30 border border-red-700/50 rounded-lg" role="alert">
          <AlertCircle className="text-red-400 flex-shrink-0 mt-0.5" size={16} />
          <span className="text-sm text-red-400">{error}</span>
        </div>
      )}

      {carrierUploads.length === 0 ? (
        <div className="p-10 text-center">
          <FileText className="text-slate-500 mx-auto" size={36} />
          <p className="mt-3 text-sm text-slate-400">
            No rosters uploaded yet for {carrier}
          </p>
        </div>
      ) : (
        <>
        <ul className="divide-y divide-slate-700/30">
          {visibleUploads.map((upload) => (
            <li
              key={upload.id}
              className={`flex items-center gap-4 px-5 py-4 transition-colors ${
                upload.is_active ? "bg-gold/5" : "hover:bg-navy-light/30"
              }`}
            >
              <div
                className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                  upload.is_active
                    ? "bg-gold/10 text-gold"
                    : "bg-navy-light text-slate-400"
                }`}
              >
                {upload.is_active ? (
                  <CheckCircle2 size={16} />
                ) : (
                  <Clock size={16} />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white truncate">
                    {upload.filename}
                  </span>
                  {upload.is_active && (
                    <span className="flex-shrink-0 text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 bg-gold/10 text-gold rounded-full">
                      Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  {upload.agent_count} agents &middot; {formatDate(upload.created_at)}
                  {upload.uploaded_by && (
                    <span> &middot; {upload.uploaded_by}</span>
                  )}
                </p>
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                {!upload.is_active && (
                  <>
                    <button
                      onClick={() =>
                        setConfirmAction({ type: "activate", upload })
                      }
                      className="p-2 text-slate-400 hover:text-gold hover:bg-gold/10 rounded-lg transition-colors"
                      title="Activate this roster"
                    >
                      <RotateCcw size={16} />
                    </button>
                    <button
                      onClick={() =>
                        setConfirmAction({ type: "delete", upload })
                      }
                      className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-900/30 rounded-lg transition-colors"
                      title="Delete this roster"
                    >
                      <Trash2 size={16} />
                    </button>
                  </>
                )}
                {upload.is_active && (
                  <span className="text-xs text-gold font-medium px-2">
                    In use
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>

        {hasMore && (
          <div className="border-t border-slate-700/30">
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-navy-light/30 transition-colors"
            >
              {expanded ? (
                <>
                  <ChevronUp size={16} />
                  Show less
                </>
              ) : (
                <>
                  <ChevronDown size={16} />
                  View all {carrierUploads.length} versions
                </>
              )}
            </button>
          </div>
        )}
        </>
      )}

      <ConfirmDialog
        open={confirmAction?.type === "activate"}
        title="Activate Roster"
        message={
          confirmAction?.type === "activate"
            ? `Are you sure you want to replace the current ${carrier} roster with "${confirmAction.upload.filename}" uploaded on ${formatDate(confirmAction.upload.created_at)}? Agent verification will use this roster immediately.`
            : ""
        }
        confirmLabel="Activate Roster"
        loading={loading}
        onConfirm={handleConfirm}
        onCancel={() => {
          setConfirmAction(null);
          setError("");
        }}
      />

      <ConfirmDialog
        open={confirmAction?.type === "delete"}
        title="Delete Roster"
        message={
          confirmAction?.type === "delete"
            ? `Are you sure you want to permanently delete "${confirmAction.upload.filename}" (${confirmAction.upload.agent_count} agents)? This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        variant="danger"
        loading={loading}
        onConfirm={handleConfirm}
        onCancel={() => {
          setConfirmAction(null);
          setError("");
        }}
      />
    </div>
  );
}
