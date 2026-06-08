import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import StepIndicator from "../components/form/StepIndicator";
import AgentSection from "../components/form/AgentSection";
import ProductTypeSection from "../components/form/ProductTypeSection";
import ClientSection from "../components/form/ClientSection";
import PolicySection from "../components/form/PolicySection";
import { submitForm } from "../lib/api";
import type { IntakeFormData } from "../types";

function getTodayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const initialFormData: IntakeFormData = {
  agentFirstName: "",
  agentLastName: "",
  carrier: "",
  agentNumber: "",
  npn: "",
  productType: "",
  clientFirstName: "",
  clientLastName: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  planName: "",
  policyEffectiveDate: "",
  planPremium: "",
  appSubmitDate: getTodayISO(),
};

export default function IntakeForm() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<IntakeFormData>(initialFormData);
  const [agentVerified, setAgentVerified] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const updateField = useCallback(
    (field: keyof IntakeFormData, value: string) => {
      setFormData((prev) => {
        const updated = { ...prev, [field]: value };
        if (field === "carrier" && value !== prev.carrier) {
          updated.planName = "";
        }
        return updated;
      });
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    },
    []
  );

  const handleVerificationResult = useCallback(
    (verified: boolean, agentNumber: string, npn: string) => {
      setAgentVerified(verified);
      setFormData((prev) => ({ ...prev, agentNumber, npn }));
    },
    []
  );

  const validateStep = (stepNumber: number): boolean => {
    const newErrors: Record<string, string> = {};

    if (stepNumber === 1) {
      if (!formData.agentFirstName.trim())
        newErrors.agentFirstName = "First name is required";
      if (!formData.agentLastName.trim())
        newErrors.agentLastName = "Last name is required";
      if (!formData.carrier) newErrors.carrier = "Please select a carrier";
      if (!agentVerified)
        newErrors.agent = "Agent must be verified before proceeding";
    }

    if (stepNumber === 2) {
      if (!formData.productType)
        newErrors.productType = "Please select a product type";
    }

    if (stepNumber === 3) {
      if (!formData.clientFirstName.trim())
        newErrors.clientFirstName = "First name is required";
      if (!formData.clientLastName.trim())
        newErrors.clientLastName = "Last name is required";
      if (!formData.phone.trim()) {
        newErrors.phone = "Phone number is required";
      } else if (
        !/^\(\d{3}\) \d{3}-\d{4}$/.test(formData.phone.trim())
      ) {
        newErrors.phone = "Enter a complete phone number (e.g., (555) 123-4567)";
      }
      if (
        formData.email.trim() &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())
      ) {
        newErrors.email = "Enter a valid email address";
      }
      if (!formData.address.trim()) newErrors.address = "Address is required";
      if (!formData.city.trim()) newErrors.city = "City is required";
      if (!formData.state) newErrors.state = "State is required";
      if (!formData.zip.trim()) {
        newErrors.zip = "ZIP code is required";
      } else if (!/^\d{5}$/.test(formData.zip.trim())) {
        newErrors.zip = "Enter a valid 5-digit ZIP code";
      }
    }

    if (stepNumber === 4) {
      if (!formData.planName.trim())
        newErrors.planName = "Plan name is required";
      if (!formData.policyEffectiveDate)
        newErrors.policyEffectiveDate = "Effective date is required";
      if (!formData.planPremium || parseFloat(formData.planPremium) <= 0) {
        newErrors.planPremium = "Enter a valid premium amount";
      }
      if (!formData.appSubmitDate) {
        newErrors.appSubmitDate = "Submit date is required";
      } else if (formData.appSubmitDate > getTodayISO()) {
        newErrors.appSubmitDate = "Submit date cannot be in the future";
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const nextStep = () => {
    if (validateStep(step)) {
      setStep((s) => Math.min(s + 1, 4));
    }
  };

  const prevStep = () => setStep((s) => Math.max(s - 1, 1));

  const handleSubmit = async () => {
    if (!validateStep(4)) return;

    setSubmitting(true);
    setSubmitError("");

    try {
      await submitForm({
        agentFirstName: formData.agentFirstName,
        agentLastName: formData.agentLastName,
        carrier: formData.carrier,
        agentNumber: formData.agentNumber,
        npn: formData.npn,
        productType: formData.productType,
        clientFirstName: formData.clientFirstName,
        clientLastName: formData.clientLastName,
        phone: formData.phone,
        email: formData.email,
        address: formData.address,
        city: formData.city,
        state: formData.state,
        zip: formData.zip,
        planName: formData.planName,
        policyEffectiveDate: formData.policyEffectiveDate,
        planPremium: formData.planPremium,
        appSubmitDate: formData.appSubmitDate,
      });

      navigate("/thank-you");
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : "Submission failed. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12 pb-24 lg:pb-12">
      <div className="text-center mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white">
          Business Intake Form
        </h1>
        <p className="mt-2 text-slate-400">
          Complete the form below to submit your intake request
        </p>
      </div>

      <StepIndicator currentStep={step} />

      <div className="mt-8 card-navy-light p-6 sm:p-8">
        {step === 1 && (
          <AgentSection
            formData={formData}
            updateField={updateField}
            agentVerified={agentVerified}
            onVerificationResult={handleVerificationResult}
            errors={errors}
            onNext={nextStep}
          />
        )}
        {step === 2 && (
          <ProductTypeSection
            formData={formData}
            updateField={updateField}
            errors={errors}
            onNext={nextStep}
            onBack={prevStep}
          />
        )}
        {step === 3 && (
          <ClientSection
            formData={formData}
            updateField={updateField}
            errors={errors}
            onNext={nextStep}
            onBack={prevStep}
          />
        )}
        {step === 4 && (
          <PolicySection
            formData={formData}
            updateField={updateField}
            errors={errors}
            onSubmit={handleSubmit}
            onBack={prevStep}
            submitting={submitting}
          />
        )}

        {submitError && (
          <div
            className="mt-4 p-4 bg-red-500/10 rounded-lg border border-red-500/30"
            role="alert"
          >
            <p className="text-sm text-red-300">{submitError}</p>
          </div>
        )}
      </div>
    </main>
  );
}
