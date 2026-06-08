import { useState, useEffect, useCallback, useRef } from "react";
import { ChevronRight, ChevronLeft, X, Sparkles } from "lucide-react";

export interface TourStep {
  target?: string;
  title: string;
  description: string;
  position?: "top" | "bottom" | "left" | "right";
  required?: boolean;
  requiredCheck?: () => boolean;
}

interface SpotlightTourProps {
  steps: TourStep[];
  onComplete: () => void;
  onSkipToRequired?: () => void;
}

export default function SpotlightTour({
  steps,
  onComplete,
  onSkipToRequired,
}: SpotlightTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });
  const tooltipRef = useRef<HTMLDivElement>(null);
  const step = steps[currentStep];
  const isRequired = step?.required;

  const measureTarget = useCallback(() => {
    if (!step?.target) {
      setTargetRect(null);
      return;
    }
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (el) {
      const rect = el.getBoundingClientRect();
      setTargetRect(rect);
    } else {
      setTargetRect(null);
    }
  }, [step]);

  useEffect(() => {
    measureTarget();
    const handleResize = () => measureTarget();
    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleResize, true);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleResize, true);
    };
  }, [measureTarget, currentStep]);

  useEffect(() => {
    if (!tooltipRef.current) return;
    const tooltip = tooltipRef.current;
    const tooltipRect = tooltip.getBoundingClientRect();
    const padding = 16;

    if (!targetRect || !step?.target) {
      setTooltipPos({
        top: window.innerHeight / 2 - tooltipRect.height / 2,
        left: window.innerWidth / 2 - tooltipRect.width / 2,
      });
      return;
    }

    const position = step.position || "bottom";
    let top = 0;
    let left = 0;

    switch (position) {
      case "bottom":
        top = targetRect.bottom + padding;
        left = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
        break;
      case "top":
        top = targetRect.top - tooltipRect.height - padding;
        left = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
        break;
      case "left":
        top = targetRect.top + targetRect.height / 2 - tooltipRect.height / 2;
        left = targetRect.left - tooltipRect.width - padding;
        break;
      case "right":
        top = targetRect.top + targetRect.height / 2 - tooltipRect.height / 2;
        left = targetRect.right + padding;
        break;
    }

    left = Math.max(padding, Math.min(left, window.innerWidth - tooltipRect.width - padding));
    top = Math.max(padding, Math.min(top, window.innerHeight - tooltipRect.height - padding));

    setTooltipPos({ top, left });
  }, [targetRect, step, currentStep]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const handleNext = () => {
    if (currentStep === steps.length - 1) {
      onComplete();
    } else {
      setCurrentStep((s) => s + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) setCurrentStep((s) => s - 1);
  };

  const handleSkip = () => {
    const requiredIndex = steps.findIndex((s) => s.required);
    if (requiredIndex >= 0 && requiredIndex > currentStep) {
      setCurrentStep(requiredIndex);
      onSkipToRequired?.();
    } else {
      onComplete();
    }
  };

  const canAdvance = !isRequired || step.requiredCheck?.();
  const spotlightPadding = 8;

  return (
    <div className="fixed inset-0 z-[60]">
      {/* Overlay with cutout */}
      <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
        <defs>
          <mask id="spotlight-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {targetRect && (
              <rect
                x={targetRect.left - spotlightPadding}
                y={targetRect.top - spotlightPadding}
                width={targetRect.width + spotlightPadding * 2}
                height={targetRect.height + spotlightPadding * 2}
                rx="12"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.75)"
          mask="url(#spotlight-mask)"
          style={{ pointerEvents: "auto" }}
        />
      </svg>

      {/* Spotlight border ring */}
      {targetRect && (
        <div
          className="absolute border-2 border-gold/60 rounded-xl pointer-events-none animate-pulse-border"
          style={{
            top: targetRect.top - spotlightPadding,
            left: targetRect.left - spotlightPadding,
            width: targetRect.width + spotlightPadding * 2,
            height: targetRect.height + spotlightPadding * 2,
          }}
        />
      )}

      {/* Tooltip card */}
      <div
        ref={tooltipRef}
        className="absolute w-[340px] max-w-[calc(100vw-32px)] animate-scale-in"
        style={{ top: tooltipPos.top, left: tooltipPos.left }}
      >
        <div className="bg-navy-light border border-slate-600/80 rounded-xl shadow-2xl p-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gold/10 flex items-center justify-center">
                <Sparkles size={14} className="text-gold" />
              </div>
              <h3 className="text-sm font-bold text-white">{step.title}</h3>
            </div>
            {!isRequired && (
              <button
                onClick={handleSkip}
                className="text-slate-500 hover:text-slate-300 transition-colors p-0.5"
                aria-label="Skip tour"
              >
                <X size={16} />
              </button>
            )}
          </div>

          {/* Body */}
          <p className="text-xs text-slate-300 leading-relaxed mb-4">
            {step.description}
          </p>

          {/* Required badge */}
          {isRequired && !canAdvance && (
            <div className="flex items-center gap-2 mb-3 px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <span className="text-[10px] font-medium text-amber-400">
                Complete this step to continue
              </span>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between">
            {/* Progress dots */}
            <div className="flex items-center gap-1">
              {steps.map((_, i) => (
                <div
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full transition-all ${
                    i === currentStep
                      ? "bg-gold w-4"
                      : i < currentStep
                      ? "bg-gold/40"
                      : "bg-slate-600"
                  }`}
                />
              ))}
            </div>

            {/* Navigation buttons */}
            <div className="flex items-center gap-2">
              {currentStep > 0 && (
                <button
                  onClick={handleBack}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                >
                  <ChevronLeft size={12} />
                  Back
                </button>
              )}
              <button
                onClick={handleNext}
                disabled={!canAdvance}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gold text-navy-dark hover:bg-gold-light disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {currentStep === steps.length - 1 ? "Get Started" : "Next"}
                {currentStep < steps.length - 1 && <ChevronRight size={12} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
