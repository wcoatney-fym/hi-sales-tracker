import { useMemo } from "react";
import { FileText, CalendarClock, CalendarDays, Loader2 } from "lucide-react";
import FormField from "../ui/FormField";
import type { IntakeFormData } from "../../types";
import { UNL_PLAN_OPTIONS } from "../../lib/planCodes";

interface PolicySectionProps {
  formData: IntakeFormData;
  updateField: (field: keyof IntakeFormData, value: string) => void;
  errors: Record<string, string>;
  onSubmit: () => void;
  onBack: () => void;
  submitting: boolean;
}

function formatDisplayDate(isoDate: string): string {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-");
  return `${m}/${d}/${y}`;
}

function getTodayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function PolicySection({
  formData,
  updateField,
  errors,
  onSubmit,
  onBack,
  submitting,
}: PolicySectionProps) {
  const todayISO = useMemo(() => getTodayISO(), []);
  const isToday = formData.appSubmitDate === todayISO;

  return (
    <div className="animate-fade-in space-y-5">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-gold/10 rounded-lg flex items-center justify-center">
          <FileText className="text-gold" size={20} />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-white">
            Policy Information
          </h2>
          <p className="text-sm text-slate-400">Enter the policy details</p>
        </div>
      </div>

      <FormField
        label="Plan Name"
        htmlFor="planName"
        required
        error={errors.planName}
      >
        {formData.carrier === "UNL" ? (
          <select
            id="planName"
            className={`input-field ${errors.planName ? "input-error" : ""}`}
            value={formData.planName}
            onChange={(e) => updateField("planName", e.target.value)}
            aria-invalid={!!errors.planName}
            aria-describedby={errors.planName ? "planName-error" : undefined}
          >
            <option value="" disabled>
              -- Select a Plan --
            </option>
            {UNL_PLAN_OPTIONS.map((plan) => (
              <option key={plan} value={plan}>
                {plan}
              </option>
            ))}
          </select>
        ) : (
          <input
            id="planName"
            type="text"
            className={`input-field ${errors.planName ? "input-error" : ""}`}
            value={formData.planName}
            onChange={(e) => updateField("planName", e.target.value)}
            placeholder="Enter plan name"
            aria-invalid={!!errors.planName}
            aria-describedby={errors.planName ? "planName-error" : undefined}
          />
        )}
      </FormField>

      <div className="grid md:grid-cols-2 gap-5">
        <FormField
          label="Policy Effective Date"
          htmlFor="policyEffectiveDate"
          required
          error={errors.policyEffectiveDate}
        >
          <input
            id="policyEffectiveDate"
            type="date"
            className={`input-field ${errors.policyEffectiveDate ? "input-error" : ""}`}
            value={formData.policyEffectiveDate}
            onChange={(e) =>
              updateField("policyEffectiveDate", e.target.value)
            }
            aria-invalid={!!errors.policyEffectiveDate}
            aria-describedby={
              errors.policyEffectiveDate
                ? "policyEffectiveDate-error"
                : undefined
            }
          />
        </FormField>

        <FormField
          label="Monthly Premium"
          htmlFor="planPremium"
          required
          error={errors.planPremium}
        >
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-medium">
              $
            </span>
            <input
              id="planPremium"
              type="number"
              step="0.01"
              min="0"
              className={`input-field pl-8 ${errors.planPremium ? "input-error" : ""}`}
              value={formData.planPremium}
              onChange={(e) => updateField("planPremium", e.target.value)}
              placeholder="0.00"
              aria-invalid={!!errors.planPremium}
              aria-describedby={
                errors.planPremium ? "planPremium-error" : undefined
              }
            />
          </div>
        </FormField>
      </div>

      <div className="mt-2 pt-5 border-t border-slate-700/50">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-gold/10 rounded-lg flex items-center justify-center">
            <CalendarClock className="text-gold" size={20} />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">
              Business Submit Date
              <span className="text-red-400 ml-1">*</span>
            </h3>
            <p className="text-sm text-slate-400">
              When was this business originally submitted?
            </p>
          </div>
        </div>

        <p className="text-sm text-slate-400 mb-4 leading-relaxed">
          Select the actual date this business was submitted. Use
          &ldquo;Today&rdquo; for new submissions, or choose a past date if
          entering previously submitted business.
        </p>

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={() => updateField("appSubmitDate", todayISO)}
            className={`flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold transition-all duration-200 ${
              isToday
                ? "bg-gold text-navy-dark shadow-md ring-2 ring-gold/30"
                : "bg-navy text-slate-300 hover:bg-navy-mid"
            }`}
          >
            <CalendarDays size={18} />
            Today &mdash; {formatDisplayDate(todayISO)}
          </button>

          <div className="relative flex-1">
            <label htmlFor="appSubmitDate" className="sr-only">
              Choose a different date
            </label>
            <input
              id="appSubmitDate"
              type="date"
              max={todayISO}
              className={`input-field w-full ${
                !isToday && formData.appSubmitDate
                  ? "ring-2 ring-gold/30 border-gold"
                  : ""
              } ${errors.appSubmitDate ? "input-error" : ""}`}
              value={formData.appSubmitDate}
              onChange={(e) => updateField("appSubmitDate", e.target.value)}
              aria-invalid={!!errors.appSubmitDate}
              aria-describedby={
                errors.appSubmitDate ? "appSubmitDate-error" : undefined
              }
            />
          </div>
        </div>

        {formData.appSubmitDate && !isToday && (
          <p className="mt-2 text-sm text-gold bg-gold/10 px-3 py-2 rounded-lg">
            Submitting for a past date: {formatDisplayDate(formData.appSubmitDate)}
          </p>
        )}

        {errors.appSubmitDate && (
          <p
            className="mt-2 text-sm text-red-400"
            id="appSubmitDate-error"
            role="alert"
          >
            {errors.appSubmitDate}
          </p>
        )}
      </div>

      <div className="flex justify-between pt-4">
        <button
          type="button"
          className="btn-secondary"
          onClick={onBack}
          disabled={submitting}
        >
          Back
        </button>
        <button
          type="button"
          className="btn-primary flex items-center gap-2"
          onClick={onSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <>
              <Loader2 className="animate-spin" size={18} />
              Submitting...
            </>
          ) : (
            "Submit Form"
          )}
        </button>
      </div>
    </div>
  );
}
