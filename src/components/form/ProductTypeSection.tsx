import { Heart, Building2, Shield, Smile, HeartPulse } from "lucide-react";
import type { IntakeFormData } from "../../types";

interface ProductTypeSectionProps {
  formData: IntakeFormData;
  updateField: (field: keyof IntakeFormData, value: string) => void;
  errors: Record<string, string>;
  onNext: () => void;
  onBack: () => void;
}

const productOptions = [
  {
    value: "HI",
    label: "Hospital Indemnity",
    abbr: "HI",
    description: "Coverage that pays a fixed benefit when a policyholder is hospitalized",
    icon: Building2,
    accentBorder: "border-sky-500/50",
    accentBg: "bg-sky-500/10",
    accentRing: "ring-sky-500/20",
    accentText: "text-sky-300",
    accentIcon: "text-sky-400",
    accentBadge: "bg-sky-500/20 text-sky-300",
  },
  {
    value: "HHC",
    label: "Home Health Care",
    abbr: "HHC",
    description: "Coverage for health care services provided in the client's home",
    icon: Heart,
    accentBorder: "border-emerald-500/50",
    accentBg: "bg-emerald-500/10",
    accentRing: "ring-emerald-500/20",
    accentText: "text-emerald-300",
    accentIcon: "text-emerald-400",
    accentBadge: "bg-emerald-500/20 text-emerald-300",
  },
  {
    value: "LIFE",
    label: "Life Insurance",
    abbr: "Life",
    description: "Coverage that provides a death benefit to beneficiaries",
    icon: Shield,
    accentBorder: "border-amber-500/50",
    accentBg: "bg-amber-500/10",
    accentRing: "ring-amber-500/20",
    accentText: "text-amber-300",
    accentIcon: "text-amber-400",
    accentBadge: "bg-amber-500/20 text-amber-300",
  },
  {
    value: "DENTAL",
    label: "Dental",
    abbr: "Dental",
    description: "Coverage for dental procedures, preventive care, and oral health",
    icon: Smile,
    accentBorder: "border-teal-500/50",
    accentBg: "bg-teal-500/10",
    accentRing: "ring-teal-500/20",
    accentText: "text-teal-300",
    accentIcon: "text-teal-400",
    accentBadge: "bg-teal-500/20 text-teal-300",
  },
  {
    value: "CANCER",
    label: "Cancer/Stroke Coverage",
    abbr: "Cancer",
    description: "Coverage providing benefits upon diagnosis of cancer or stroke",
    icon: HeartPulse,
    accentBorder: "border-rose-500/50",
    accentBg: "bg-rose-500/10",
    accentRing: "ring-rose-500/20",
    accentText: "text-rose-300",
    accentIcon: "text-rose-400",
    accentBadge: "bg-rose-500/20 text-rose-300",
  },
] as const;

export default function ProductTypeSection({
  formData,
  updateField,
  errors,
  onNext,
  onBack,
}: ProductTypeSectionProps) {
  return (
    <div className="animate-fade-in space-y-6">
      <div className="text-center">
        <h2 className="text-lg font-semibold text-white">
          Select Product Type
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          What type of product is this submission for?
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {productOptions.map((option) => {
          const Icon = option.icon;
          const selected = formData.productType === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => updateField("productType", option.value)}
              className={`relative flex flex-col items-center gap-3 p-6 rounded-xl border-2 transition-all duration-200 text-left ${
                selected
                  ? `${option.accentBorder} ${option.accentBg} ring-4 ${option.accentRing}`
                  : "border-slate-700 bg-navy hover:border-slate-600"
              }`}
            >
              {selected && (
                <span className={`absolute top-3 right-3 text-xs font-semibold px-2 py-0.5 rounded-full ${option.accentBadge}`}>
                  Selected
                </span>
              )}
              <div
                className={`w-14 h-14 rounded-xl flex items-center justify-center transition-colors ${
                  selected ? option.accentBg : "bg-navy-dark"
                }`}
              >
                <Icon
                  size={28}
                  className={selected ? option.accentIcon : "text-slate-500"}
                />
              </div>
              <div className="text-center">
                <span className={`block text-base font-semibold ${selected ? option.accentText : "text-slate-200"}`}>
                  {option.label}
                </span>
                <span className={`block text-xs font-medium mt-0.5 ${selected ? option.accentText : "text-slate-500"}`}>
                  ({option.abbr})
                </span>
              </div>
              <p className="text-xs text-slate-500 text-center leading-relaxed">
                {option.description}
              </p>
            </button>
          );
        })}
      </div>

      {errors.productType && (
        <p className="text-sm text-red-400 text-center" role="alert">
          {errors.productType}
        </p>
      )}

      <div className="flex justify-between pt-4">
        <button type="button" className="btn-secondary" onClick={onBack}>
          Back
        </button>
        <button type="button" className="btn-primary" onClick={onNext}>
          Continue
        </button>
      </div>
    </div>
  );
}
