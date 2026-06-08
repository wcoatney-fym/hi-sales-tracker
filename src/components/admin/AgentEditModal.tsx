import { useState, useEffect, useRef } from "react";
import { X, Save, Loader2 } from "lucide-react";
import type { AgentRow } from "../../types";
import { toProperCase } from "../../lib/nameFormat";

interface AgentEditModalProps {
  agent: AgentRow | null;
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

const FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: "firstName", label: "First Name", placeholder: "Enter first name" },
  { key: "lastName", label: "Last Name", placeholder: "Enter last name" },
  { key: "npn", label: "NPN", placeholder: "National Producer Number" },
  { key: "unlWritingNumber", label: "UNL Writing Number", placeholder: "UNL writing number" },
  { key: "gtlWritingNumber", label: "GTL Writing Number", placeholder: "GTL writing number" },
  { key: "agency", label: "Agency", placeholder: "Agency name" },
];

export default function AgentEditModal({ agent, saving, onSave, onClose }: AgentEditModalProps) {
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
    if (agent) {
      setForm({
        firstName: agent.firstName,
        lastName: agent.lastName,
        npn: agent.npn,
        unlWritingNumber: agent.unlWritingNumber,
        gtlWritingNumber: agent.gtlWritingNumber,
        agency: agent.agency,
      });
      setErrors({});
      setTimeout(() => firstInputRef.current?.focus(), 50);
    }
  }, [agent]);

  useEffect(() => {
    if (!agent) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [agent, onClose]);

  if (!agent) return null;

  const handleChange = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: "" }));
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
          <h3 className="text-lg font-semibold text-white">Edit Agent</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-500 hover:text-white hover:bg-navy-light transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {FIELDS.slice(0, 2).map((field, idx) => (
              <div key={field.key}>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  {field.label} <span className="text-red-400">*</span>
                </label>
                <input
                  ref={idx === 0 ? firstInputRef : undefined}
                  type="text"
                  value={form[field.key as keyof typeof form]}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  onBlur={() => handleNameBlur(field.key as "firstName" | "lastName")}
                  placeholder={field.placeholder}
                  disabled={saving}
                  className={`w-full px-3 py-2 text-sm text-white border rounded-lg bg-navy-light placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-gold focus:border-gold transition-all disabled:opacity-50 ${
                    errors[field.key] ? "border-red-500 focus:ring-red-500 focus:border-red-500" : "border-slate-600"
                  }`}
                />
                {errors[field.key] && (
                  <p className="mt-1 text-xs text-red-400">{errors[field.key]}</p>
                )}
              </div>
            ))}
          </div>

          {FIELDS.slice(2).map((field) => (
            <div key={field.key}>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                {field.label}
              </label>
              <input
                type="text"
                value={form[field.key as keyof typeof form]}
                onChange={(e) => handleChange(field.key, e.target.value)}
                placeholder={field.placeholder}
                disabled={saving}
                className="w-full px-3 py-2 text-sm text-white border border-slate-600 rounded-lg bg-navy-light placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-gold focus:border-gold transition-all disabled:opacity-50"
              />
            </div>
          ))}
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
                Saving...
              </>
            ) : (
              <>
                <Save size={15} />
                Save Changes
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
