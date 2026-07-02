import { useEffect, useState, useRef } from "react";
import { Search, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import FormField from "../ui/FormField";
import { verifyAgent } from "../../lib/api";
import type { IntakeFormData } from "../../types";

// Carriers whose intake is temporarily paused (no live connection yet).
export const PAUSED_CARRIERS = ["UNL"];

interface AgentSectionProps {
  formData: IntakeFormData;
  updateField: (field: keyof IntakeFormData, value: string) => void;
  agentVerified: boolean;
  onVerificationResult: (verified: boolean, agentNumber: string, npn: string) => void;
  errors: Record<string, string>;
  onNext: () => void;
}

export default function AgentSection({
  formData,
  updateField,
  agentVerified,
  onVerificationResult,
  errors,
  onNext,
}: AgentSectionProps) {
  const [verifying, setVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState("");
  const carrierPaused = PAUSED_CARRIERS.includes(formData.carrier);
  const onResultRef = useRef(onVerificationResult);
  onResultRef.current = onVerificationResult;

  useEffect(() => {
    const fn = formData.agentFirstName.trim();
    const ln = formData.agentLastName.trim();
    const carrier = formData.carrier;

    // Skip verification entirely for paused carriers — submission is blocked upstream.
    if (PAUSED_CARRIERS.includes(carrier)) {
      onResultRef.current(false, "", "");
      setVerificationError("");
      setVerifying(false);
      return;
    }

    if (!fn || !ln || !carrier) {
      onResultRef.current(false, "", "");
      setVerificationError("");
      setVerifying(false);
      return;
    }

    onResultRef.current(false, "", "");
    setVerificationError("");
    let cancelled = false;

    const timer = setTimeout(async () => {
      setVerifying(true);
      try {
        const result = await verifyAgent(fn, ln, carrier);
        if (cancelled) return;
        if (result.found) {
          onResultRef.current(true, result.agentNumber, result.npn || "");
        } else {
          setVerificationError(
            "Agent not found. Please verify the entered details or contact support."
          );
        }
      } catch {
        if (cancelled) return;
        setVerificationError("Verification failed. Please try again.");
      } finally {
        if (!cancelled) setVerifying(false);
      }
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [formData.agentFirstName, formData.agentLastName, formData.carrier]);

  return (
    <div className="animate-fade-in space-y-5">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-gold/10 rounded-lg flex items-center justify-center">
          <Search className="text-gold" size={20} />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-white">
            Agent Information
          </h2>
          <p className="text-sm text-slate-400">
            Enter your details to verify your agent status
          </p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <FormField
          label="First Name"
          htmlFor="agentFirstName"
          required
          error={errors.agentFirstName}
        >
          <input
            id="agentFirstName"
            type="text"
            className={`input-field ${errors.agentFirstName ? "input-error" : ""}`}
            value={formData.agentFirstName}
            onChange={(e) => updateField("agentFirstName", e.target.value)}
            placeholder="Enter first name"
            aria-invalid={!!errors.agentFirstName}
            aria-describedby={
              errors.agentFirstName ? "agentFirstName-error" : undefined
            }
          />
        </FormField>

        <FormField
          label="Last Name"
          htmlFor="agentLastName"
          required
          error={errors.agentLastName}
        >
          <input
            id="agentLastName"
            type="text"
            className={`input-field ${errors.agentLastName ? "input-error" : ""}`}
            value={formData.agentLastName}
            onChange={(e) => updateField("agentLastName", e.target.value)}
            placeholder="Enter last name"
            aria-invalid={!!errors.agentLastName}
            aria-describedby={
              errors.agentLastName ? "agentLastName-error" : undefined
            }
          />
        </FormField>
      </div>

      <FormField
        label="Carrier"
        htmlFor="carrier"
        required
        error={errors.carrier}
      >
        <select
          id="carrier"
          className={`input-field ${errors.carrier ? "input-error" : ""}`}
          value={formData.carrier}
          onChange={(e) => updateField("carrier", e.target.value)}
          aria-invalid={!!errors.carrier}
          aria-describedby={errors.carrier ? "carrier-error" : undefined}
        >
          <option value="">Select a carrier</option>
          <option value="UNL">UNL</option>
          <option value="GTL">GTL</option>
          <option value="AHL">AHL</option>
          <option value="Manhattan">Manhattan</option>
          <option value="Heartland">Heartland</option>
        </select>
      </FormField>

      {carrierPaused && (
        <div
          className="p-4 bg-amber-500/10 rounded-lg border border-amber-500/30"
          role="alert"
        >
          <div className="flex items-center gap-3">
            <AlertCircle className="text-amber-400 flex-shrink-0" size={20} />
            <span className="text-sm text-amber-300">
              {formData.carrier} submissions are temporarily paused while we wire
              up a live connection to {formData.carrier}. Please check back soon
              — no need to submit this policy here for now.
            </span>
          </div>
        </div>
      )}

      {verifying && (
        <div
          className="flex items-center gap-3 p-4 bg-blue-500/10 rounded-lg border border-blue-500/30"
          role="status"
        >
          <Loader2 className="animate-spin text-blue-400" size={20} />
          <span className="text-sm text-blue-300">Verifying agent...</span>
        </div>
      )}

      {verificationError && !verifying && (
        <div
          className="p-4 bg-red-500/10 rounded-lg border border-red-500/30"
          role="alert"
        >
          <div className="flex items-center gap-3">
            <AlertCircle className="text-red-400 flex-shrink-0" size={20} />
            <span className="text-sm text-red-300">{verificationError}</span>
          </div>
          <p className="mt-3 text-sm text-red-300 ml-8">
            Please message <span className="font-semibold">Charlie Mitchell</span> on Slack with your UNL/GTL writing numbers to get added to the system.
          </p>
        </div>
      )}

      {agentVerified && !verifying && (
        <div
          className="flex items-center gap-3 p-4 bg-emerald-500/10 rounded-lg border border-emerald-500/30"
          role="status"
        >
          <CheckCircle className="text-emerald-400 flex-shrink-0" size={20} />
          <span className="text-sm text-emerald-300">
            Agent verified successfully
          </span>
        </div>
      )}

      <FormField label="Agent Number" htmlFor="agentNumber">
        <input
          id="agentNumber"
          type="text"
          className="input-field bg-navy/50 cursor-not-allowed"
          value={formData.agentNumber}
          readOnly
          placeholder="Auto-populated after verification"
          aria-readonly="true"
        />
      </FormField>

      {errors.agent && (
        <p className="text-sm text-red-600" role="alert">
          {errors.agent}
        </p>
      )}

      <div className="flex justify-end pt-4">
        <button
          type="button"
          className="btn-primary"
          onClick={onNext}
          disabled={!agentVerified || verifying || carrierPaused}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
