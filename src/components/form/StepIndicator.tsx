import { Check } from "lucide-react";

const steps = [
  { number: 1, label: "Agent Data" },
  { number: 2, label: "Product Type" },
  { number: 3, label: "Client Info" },
  { number: 4, label: "Policy Info" },
];

interface StepIndicatorProps {
  currentStep: number;
}

export default function StepIndicator({ currentStep }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center" role="navigation" aria-label="Form progress">
      {steps.map((step, index) => (
        <div key={step.number} className="flex items-center">
          <div className="flex flex-col items-center">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm transition-all duration-300 ${
                step.number < currentStep
                  ? "bg-gold text-navy-dark"
                  : step.number === currentStep
                    ? "bg-gold text-navy-dark ring-4 ring-gold/20"
                    : "bg-navy text-slate-500"
              }`}
              aria-current={step.number === currentStep ? "step" : undefined}
            >
              {step.number < currentStep ? <Check size={18} /> : step.number}
            </div>
            <span
              className={`mt-2 text-xs font-medium whitespace-nowrap ${
                step.number <= currentStep ? "text-gold" : "text-slate-500"
              }`}
            >
              {step.label}
            </span>
          </div>
          {index < steps.length - 1 && (
            <div
              className={`w-8 sm:w-14 md:w-20 h-0.5 mx-1.5 mb-6 transition-colors duration-300 ${
                step.number < currentStep ? "bg-gold" : "bg-navy"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}
