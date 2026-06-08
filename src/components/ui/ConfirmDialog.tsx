import { AlertTriangle, X } from "lucide-react";
import { useEffect, useRef } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === overlayRef.current) onCancel();
      }}
    >
      <div className="card-navy-light shadow-xl max-w-md w-full mx-4 overflow-hidden animate-scale-in max-h-[85vh] flex flex-col">
        <div className="flex items-start gap-4 p-6">
          <div
            className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
              variant === "danger" ? "bg-red-500/10" : "bg-gold/10"
            }`}
          >
            <AlertTriangle
              size={20}
              className={variant === "danger" ? "text-red-400" : "text-gold"}
            />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-white">{title}</h3>
            <p className="mt-2 text-sm text-slate-400 leading-relaxed">{message}</p>
          </div>
          <button
            onClick={onCancel}
            className="flex-shrink-0 text-slate-500 hover:text-slate-300 transition-colors"
          >
            <X size={20} />
          </button>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 bg-navy/50 border-t border-slate-700/50">
          <button
            onClick={onCancel}
            disabled={loading}
            className="btn-secondary text-sm px-4 py-2"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`text-sm px-4 py-2.5 rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-navy-dark disabled:opacity-50 disabled:cursor-not-allowed ${
              variant === "danger"
                ? "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500"
                : "btn-primary"
            }`}
          >
            {loading ? "Processing..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
