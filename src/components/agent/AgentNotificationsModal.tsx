import { useState, useEffect } from "react";
import { Bell, Flag, X, Loader2, MessageSquare } from "lucide-react";
import { agentGetNotifications, agentMarkNotificationsRead } from "../../lib/api";
import type { AgentNotification } from "../../lib/api";

interface AgentNotificationsModalProps {
  sessionToken: string;
  // Called when the agent clicks through to review their book/nudges.
  onReview?: () => void;
}

// Polls unread notifications on mount and, if any exist, shows a popup listing
// the manager's flagged/nudged policies. Marks all read on dismiss or click-through.
export default function AgentNotificationsModal({ sessionToken, onReview }: AgentNotificationsModalProps) {
  const [notifications, setNotifications] = useState<AgentNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [marking, setMarking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await agentGetNotifications(sessionToken, true);
        const list: AgentNotification[] = res.notifications || [];
        if (!cancelled && list.length > 0) {
          setNotifications(list);
          setOpen(true);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionToken]);

  const dismiss = async (review: boolean) => {
    setMarking(true);
    try {
      await agentMarkNotificationsRead(sessionToken);
    } catch {
      /* ignore */
    } finally {
      setMarking(false);
      setOpen(false);
      if (review) onReview?.();
    }
  };

  if (!open || notifications.length === 0) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => dismiss(false)}>
      <div
        className="bg-navy-light border border-slate-700 rounded-xl w-full max-w-md max-h-[80vh] flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-5 border-b border-slate-700/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <Bell size={20} className="text-amber-400" />
            </div>
            <div>
              <h3 className="text-white font-semibold">Your manager flagged {notifications.length} item{notifications.length === 1 ? "" : "s"}</h3>
              <p className="text-xs text-slate-400 mt-0.5">Review and respond in My Book.</p>
            </div>
          </div>
          <button onClick={() => dismiss(false)} className="text-slate-400 hover:text-white p-1">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {notifications.map((n) => (
            <div key={n.id} className="flex items-start gap-3 bg-navy border border-slate-700/50 rounded-lg p-3">
              <div className="mt-0.5 shrink-0">
                {n.type === "flag" ? (
                  <Flag size={14} className="text-rose-400" />
                ) : n.type === "nudge" ? (
                  <Bell size={14} className="text-amber-400" />
                ) : (
                  <MessageSquare size={14} className="text-sky-400" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm text-slate-200 whitespace-pre-wrap">{n.body}</p>
                <p className="text-[10px] text-slate-500 mt-1">{new Date(n.created_at).toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-slate-700/50 p-4 flex gap-3">
          <button
            onClick={() => dismiss(false)}
            disabled={marking}
            className="flex-1 px-4 py-2 border border-slate-600 rounded-lg text-slate-300 text-sm hover:bg-slate-800 disabled:opacity-50"
          >
            Dismiss
          </button>
          <button
            onClick={() => dismiss(true)}
            disabled={marking}
            className="flex-1 btn-primary flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {marking && <Loader2 size={14} className="animate-spin" />}
            Review My Book
          </button>
        </div>
      </div>
    </div>
  );
}
