import { useEffect, useMemo, useState } from "react";
import { X, Loader2, Save, AlertTriangle } from "lucide-react";
import { adminUpdateIntakeSubmission } from "../../lib/api";
import { US_STATES } from "../../constants/states";
import ConfirmDialog from "../ui/ConfirmDialog";

export interface IntakeRowEditable {
  id: string;
  agent_first_name: string;
  agent_last_name: string;
  agent_number: string;
  carrier: string;
  agency: string | null;
  product_type: string;
  client_first_name: string;
  client_last_name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  plan_name: string;
  plan_premium: number;
  policy_effective_date: string;
  app_submit_date: string | null;
  policy_number: string | null;
  status: string;
  duplicate_flag: boolean;
}

interface Props {
  open: boolean;
  token: string;
  row: IntakeRowEditable | null;
  editorLabel?: string;
  onClose: () => void;
  onSaved: (updated: IntakeRowEditable) => void;
}

const STATUS_OPTIONS = [
  { value: "pending", label: "Submitted" },
  { value: "approved", label: "Approved" },
  { value: "active", label: "Active" },
  { value: "cancelled", label: "Cancelled" },
  { value: "terminated", label: "Terminated" },
  { value: "superseded", label: "Superseded" },
];
const DESTRUCTIVE_STATUSES = new Set(["cancelled", "terminated", "superseded"]);

const PRODUCT_TYPES = [
  { value: "HI", label: "Hospital Indemnity" },
  { value: "HHC", label: "Home Health Care" },
  { value: "LIFE", label: "Life Insurance" },
  { value: "DENTAL", label: "Dental" },
  { value: "CANCER", label: "Cancer/Stroke Coverage" },
];

type FormState = {
  agent_first_name: string;
  agent_last_name: string;
  agent_number: string;
  carrier: string;
  agency: string;
  product_type: string;
  client_first_name: string;
  client_last_name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  plan_name: string;
  plan_premium: string;
  policy_effective_date: string;
  app_submit_date: string;
  policy_number: string;
  status: string;
  duplicate_flag: boolean;
};

function rowToForm(row: IntakeRowEditable): FormState {
  return {
    agent_first_name: row.agent_first_name || "",
    agent_last_name: row.agent_last_name || "",
    agent_number: row.agent_number || "",
    carrier: row.carrier || "",
    agency: row.agency || "",
    product_type: row.product_type || "HI",
    client_first_name: row.client_first_name || "",
    client_last_name: row.client_last_name || "",
    phone: row.phone || "",
    email: row.email || "",
    address: row.address || "",
    city: row.city || "",
    state: row.state || "",
    zip: row.zip || "",
    plan_name: row.plan_name || "",
    plan_premium: String(row.plan_premium ?? 0),
    policy_effective_date: row.policy_effective_date ? row.policy_effective_date.slice(0, 10) : "",
    app_submit_date: row.app_submit_date ? row.app_submit_date.slice(0, 10) : "",
    policy_number: row.policy_number || "",
    status: row.status || "pending",
    duplicate_flag: !!row.duplicate_flag,
  };
}

export default function IntakeSubmissionEditDrawer({ open, token, row, editorLabel, onClose, onSaved }: Props) {
  const [form, setForm] = useState<FormState | null>(row ? rowToForm(row) : null);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmDestructive, setConfirmDestructive] = useState<null | { from: string; to: string }>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    if (row) setForm(rowToForm(row));
    setErrorMsg(null);
  }, [row]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") attemptClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, form, row]);

  const initial = useMemo(() => (row ? rowToForm(row) : null), [row]);

  const dirtyKeys = useMemo<string[]>(() => {
    if (!form || !initial) return [];
    const keys: string[] = [];
    (Object.keys(form) as (keyof FormState)[]).forEach((k) => {
      if (form[k] !== initial[k]) keys.push(k as string);
    });
    return keys;
  }, [form, initial]);

  const isDirty = dirtyKeys.length > 0;

  function attemptClose() {
    if (saving) return;
    if (isDirty) {
      setConfirmDiscard(true);
    } else {
      onClose();
    }
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function buildUpdates(): Record<string, unknown> {
    if (!form || !initial) return {};
    const updates: Record<string, unknown> = {};
    for (const k of dirtyKeys) {
      const key = k as keyof FormState;
      const value = form[key];
      if (key === "plan_premium") {
        const num = Number(value);
        if (Number.isFinite(num)) updates[key] = num;
      } else if (key === "agency" || key === "policy_number") {
        const v = String(value).trim();
        updates[key] = v.length === 0 ? null : v;
      } else if (key === "app_submit_date") {
        const v = String(value).trim();
        updates[key] = v.length === 0 ? null : v;
      } else if (key === "duplicate_flag") {
        updates[key] = !!value;
      } else {
        updates[key] = value;
      }
    }
    return updates;
  }

  async function performSave() {
    if (!form || !row) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const updates = buildUpdates();
      const res = await adminUpdateIntakeSubmission(token, row.id, updates, editorLabel);
      if (res.error) {
        setErrorMsg(res.error);
        setSaving(false);
        return;
      }
      const updated: IntakeRowEditable = { ...(row as IntakeRowEditable), ...(res.submission || {}) };
      onSaved(updated);
      onClose();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function handleSaveClick() {
    if (!form || !initial || saving) return;
    if (form.status !== initial.status && DESTRUCTIVE_STATUSES.has(form.status)) {
      setConfirmDestructive({ from: initial.status, to: form.status });
      return;
    }
    performSave();
  }

  if (!open || !form || !row) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={attemptClose} />
      <aside
        className="fixed right-0 top-0 bottom-0 z-50 w-full sm:w-[560px] bg-navy border-l border-slate-700/50 shadow-2xl flex flex-col animate-fade-in"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-700/50">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-white truncate">
              Edit submission
            </h3>
            <p className="text-xs text-slate-400 mt-0.5 truncate">
              {row.client_first_name} {row.client_last_name}
              {row.policy_number ? ` \u00b7 ${row.policy_number}` : ""}
            </p>
          </div>
          <button onClick={attemptClose} className="text-slate-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          <Section title="Agent">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="First Name" value={form.agent_first_name} onChange={(v) => setField("agent_first_name", v)} />
              <Field label="Last Name" value={form.agent_last_name} onChange={(v) => setField("agent_last_name", v)} />
              <Field label="Writing Number" value={form.agent_number} onChange={(v) => setField("agent_number", v)} mono />
              <Field label="Carrier" value={form.carrier} onChange={(v) => setField("carrier", v)} />
              <Field label="Agency" value={form.agency} onChange={(v) => setField("agency", v)} placeholder="(blank to clear)" />
              <SelectField
                label="Product Type"
                value={form.product_type}
                onChange={(v) => setField("product_type", v)}
                options={PRODUCT_TYPES}
              />
            </div>
          </Section>

          <Section title="Client">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="First Name" value={form.client_first_name} onChange={(v) => setField("client_first_name", v)} />
              <Field label="Last Name" value={form.client_last_name} onChange={(v) => setField("client_last_name", v)} />
              <Field label="Phone" value={form.phone} onChange={(v) => setField("phone", v)} type="tel" />
              <Field label="Email" value={form.email} onChange={(v) => setField("email", v)} type="email" />
              <div className="sm:col-span-2">
                <Field label="Address" value={form.address} onChange={(v) => setField("address", v)} />
              </div>
              <Field label="City" value={form.city} onChange={(v) => setField("city", v)} />
              <SelectField
                label="State"
                value={form.state}
                onChange={(v) => setField("state", v)}
                options={[{ value: "", label: "Select" }, ...US_STATES.map((s) => ({ value: s.value, label: s.value }))]}
              />
              <Field label="ZIP" value={form.zip} onChange={(v) => setField("zip", v)} />
            </div>
          </Section>

          <Section title="Plan & Policy">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <Field label="Plan Name" value={form.plan_name} onChange={(v) => setField("plan_name", v)} />
              </div>
              <Field
                label="Monthly Premium"
                value={form.plan_premium}
                onChange={(v) => setField("plan_premium", v)}
                type="number"
                step="0.01"
                prefix="$"
              />
              <Field
                label="Policy Number"
                value={form.policy_number}
                onChange={(v) => setField("policy_number", v)}
                mono
                placeholder="(blank to clear)"
              />
              <Field
                label="Effective Date"
                value={form.policy_effective_date}
                onChange={(v) => setField("policy_effective_date", v)}
                type="date"
              />
              <Field
                label="App Submit Date"
                value={form.app_submit_date}
                onChange={(v) => setField("app_submit_date", v)}
                type="date"
              />
            </div>
          </Section>

          <Section title="Status">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <SelectField
                label="Status"
                value={form.status === "submitted" ? "pending" : form.status}
                onChange={(v) => setField("status", v)}
                options={STATUS_OPTIONS}
              />
              <label className="flex items-center gap-2 mt-6 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.duplicate_flag}
                  onChange={(e) => setField("duplicate_flag", e.target.checked)}
                  className="rounded border-slate-600 text-gold focus:ring-gold bg-navy-light"
                />
                <span className="text-sm text-slate-300">Mark as duplicate</span>
              </label>
            </div>
          </Section>

          {errorMsg && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-900/30 text-red-300 border border-red-700/50 text-xs">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-slate-700/50 bg-navy-dark/40">
          <span className="text-xs text-slate-400">
            {isDirty ? `${dirtyKeys.length} change${dirtyKeys.length === 1 ? "" : "s"}` : "No changes"}
          </span>
          <div className="flex gap-2">
            <button
              onClick={attemptClose}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium border border-slate-600 rounded-lg text-slate-300 hover:bg-navy-light hover:text-white disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveClick}
              disabled={saving || !isDirty}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-navy-dark bg-gold rounded-lg hover:bg-gold-light disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </aside>

      <ConfirmDialog
        open={!!confirmDestructive}
        title="Confirm status change"
        message={
          confirmDestructive
            ? `You are changing the status from "${confirmDestructive.from}" to "${confirmDestructive.to}". This affects production reporting. Continue?`
            : ""
        }
        confirmLabel="Yes, change status"
        cancelLabel="Cancel"
        variant="danger"
        loading={saving}
        onConfirm={() => {
          setConfirmDestructive(null);
          performSave();
        }}
        onCancel={() => setConfirmDestructive(null)}
      />

      <ConfirmDialog
        open={confirmDiscard}
        title="Discard changes?"
        message="You have unsaved changes. Closing now will discard them."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        variant="danger"
        onConfirm={() => {
          setConfirmDiscard(false);
          onClose();
        }}
        onCancel={() => setConfirmDiscard(false)}
      />
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-gold/80 mb-2">{title}</h4>
      {children}
    </div>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  step?: string;
  placeholder?: string;
  mono?: boolean;
  prefix?: string;
}

function Field({ label, value, onChange, type = "text", step, placeholder, mono, prefix }: FieldProps) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-400 mb-1">{label}</span>
      <div className="relative">
        {prefix && (
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">{prefix}</span>
        )}
        <input
          type={type}
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full ${prefix ? "pl-6" : "pl-3"} pr-3 py-2 text-sm border border-slate-600 rounded-lg bg-navy-light text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-gold focus:border-gold ${mono ? "font-mono" : ""}`}
        />
      </div>
    </label>
  );
}

interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}

function SelectField({ label, value, onChange, options }: SelectFieldProps) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-400 mb-1">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full pl-3 pr-8 py-2 text-sm border border-slate-600 rounded-lg bg-navy-light text-slate-100 focus:outline-none focus:ring-1 focus:ring-gold focus:border-gold"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
