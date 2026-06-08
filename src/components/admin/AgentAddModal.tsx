import { useState, useEffect, useRef } from "react";
import { X, UserPlus, Loader2 } from "lucide-react";
import { toProperCase } from "../../lib/nameFormat";

interface AgentAddModalProps {
  open: boolean;
  saving: boolean;
  onSave: (fields: {
    firstName: string;
    lastName: string;
    npn: string;
    unlWritingNumber: string;
    gtlWritingNumber: string;
    agency: string;
  }) => void;
  onClose: () => void;
}

export default function AgentAddModal({ open, saving, onSave, onClose }: AgentAddModalProps) {
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    npn: "",
    unlWritingNumber: "",
    gtlWritingNumber: "",
    agency: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const overlayRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setForm({ firstName: "", lastName: "", npn: "", unlWritingNumber: "", gtlWritingNumber: "", agency: "" });
      setErrors({});
      setTimeout(() => firstInputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleChange = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: "" }));
    if (key === "unlWritingNumber" || key === "gtlWritingNumber") {
      setErrors((prev) => ({ ...prev, writingNumber: "" }));
    }
  };

  const handleNameBlur = (key: "firstName" | "lastName") => {
    const val = form[key];
    if (val.trim()) {
      setForm((prev) => ({ ...prev, [key]: toProperCase(val) }));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};
    if (!form.firstName.trim()) newErrors.firstName = "Required";
    if (!form.lastName.trim()) newErrors.lastName = "Required";
    if (!form.npn.trim()) newErrors.npn = "Required";
    if (!form.unlWritingNumber.trim() && !form.gtlWritingNumber.trim()) {
      newErrors.writingNumber = "At least one writing number (UNL or GTL) is required";
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    onSave(form);
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div className="bg-navy rounded-xl shadow-xl max-w-lg w-full mx-4 overflow-hidden animate-scale-in border border-slate-700/50 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/30">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gold/10 flex items-center justify-center">
              <UserPlus size={16} className="text-gold" />
            </div>
            <h3 className="text-lg font-semibold text-white">Add Agent</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-500 hover:text-white hover:bg-navy-light transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                First Name <span className="text-red-400">*</span>
              </label>
              <input
                ref={firstInputRef}
                type="text"
                value={form.firstName}
                onChange={(e) => handleChange("firstName", e.target.value)}
                onBlur={() => handleNameBlur("firstName")}
                placeholder="Enter first name"
                disabled={saving}
                className={`w-full px-3 py-2 text-sm text-white border rounded-lg bg-navy-light placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-gold focus:border-gold transition-all disabled:opacity-50 ${
                  errors.firstName ? "border-red-500 focus:ring-red-500 focus:border-red-500" : "border-slate-600"
                }`}
              />
              {errors.firstName && (
                <p className="mt-1 text-xs text-red-400">{errors.firstName}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Last Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={form.lastName}
                onChange={(e) => handleChange("lastName", e.target.value)}
                onBlur={() => handleNameBlur("lastName")}
                placeholder="Enter last name"
                disabled={saving}
                className={`w-full px-3 py-2 text-sm text-white border rounded-lg bg-navy-light placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-gold focus:border-gold transition-all disabled:opacity-50 ${
                  errors.lastName ? "border-red-500 focus:ring-red-500 focus:border-red-500" : "border-slate-600"
                }`}
              />
              {errors.lastName && (
                <p className="mt-1 text-xs text-red-400">{errors.lastName}</p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              NPN <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={form.npn}
              onChange={(e) => handleChange("npn", e.target.value)}
              placeholder="National Producer Number"
              disabled={saving}
              className={`w-full px-3 py-2 text-sm text-white border rounded-lg bg-navy-light placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-gold focus:border-gold transition-all disabled:opacity-50 ${
                errors.npn ? "border-red-500 focus:ring-red-500 focus:border-red-500" : "border-slate-600"
              }`}
            />
            {errors.npn && (
              <p className="mt-1 text-xs text-red-400">{errors.npn}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                UNL Writing Number
              </label>
              <input
                type="text"
                value={form.unlWritingNumber}
                onChange={(e) => handleChange("unlWritingNumber", e.target.value)}
                placeholder="UNL writing number"
                disabled={saving}
                className={`w-full px-3 py-2 text-sm text-white border rounded-lg bg-navy-light placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-gold focus:border-gold transition-all disabled:opacity-50 ${
                  errors.writingNumber ? "border-red-500 focus:ring-red-500 focus:border-red-500" : "border-slate-600"
                }`}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                GTL Writing Number
              </label>
              <input
                type="text"
                value={form.gtlWritingNumber}
                onChange={(e) => handleChange("gtlWritingNumber", e.target.value)}
                placeholder="GTL writing number"
                disabled={saving}
                className={`w-full px-3 py-2 text-sm text-white border rounded-lg bg-navy-light placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-gold focus:border-gold transition-all disabled:opacity-50 ${
                  errors.writingNumber ? "border-red-500 focus:ring-red-500 focus:border-red-500" : "border-slate-600"
                }`}
              />
            </div>
          </div>
          {errors.writingNumber && (
            <p className="text-xs text-red-400 -mt-2">{errors.writingNumber}</p>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Agency
            </label>
            <input
              type="text"
              value={form.agency}
              onChange={(e) => handleChange("agency", e.target.value)}
              placeholder="Agency name (e.g., FYM)"
              disabled={saving}
              className="w-full px-3 py-2 text-sm text-white border border-slate-600 rounded-lg bg-navy-light placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-gold focus:border-gold transition-all disabled:opacity-50"
            />
          </div>
        </form>

        <div className="flex justify-end gap-3 px-6 py-4 bg-navy-light/50 border-t border-slate-700/30">
          <button
            onClick={onClose}
            disabled={saving}
            className="btn-secondary text-sm px-4 py-2"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="inline-flex items-center gap-2 text-sm px-4 py-2.5 rounded-lg font-medium bg-gold text-navy-dark hover:bg-gold-light focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-navy focus:ring-gold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                Adding...
              </>
            ) : (
              <>
                <UserPlus size={15} />
                Add Agent
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
