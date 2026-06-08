import { User } from "lucide-react";
import FormField from "../ui/FormField";
import type { IntakeFormData } from "../../types";
import { US_STATES } from "../../constants/states";

interface ClientSectionProps {
  formData: IntakeFormData;
  updateField: (field: keyof IntakeFormData, value: string) => void;
  errors: Record<string, string>;
  onNext: () => void;
  onBack: () => void;
}

export default function ClientSection({
  formData,
  updateField,
  errors,
  onNext,
  onBack,
}: ClientSectionProps) {
  return (
    <div className="animate-fade-in space-y-5">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-gold/10 rounded-lg flex items-center justify-center">
          <User className="text-gold" size={20} />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-white">
            Client Information
          </h2>
          <p className="text-sm text-slate-400">
            Enter the client's contact details
          </p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <FormField
          label="First Name"
          htmlFor="clientFirstName"
          required
          error={errors.clientFirstName}
        >
          <input
            id="clientFirstName"
            type="text"
            className={`input-field ${errors.clientFirstName ? "input-error" : ""}`}
            value={formData.clientFirstName}
            onChange={(e) => updateField("clientFirstName", e.target.value)}
            placeholder="Client's first name"
            aria-invalid={!!errors.clientFirstName}
            aria-describedby={
              errors.clientFirstName ? "clientFirstName-error" : undefined
            }
          />
        </FormField>

        <FormField
          label="Last Name"
          htmlFor="clientLastName"
          required
          error={errors.clientLastName}
        >
          <input
            id="clientLastName"
            type="text"
            className={`input-field ${errors.clientLastName ? "input-error" : ""}`}
            value={formData.clientLastName}
            onChange={(e) => updateField("clientLastName", e.target.value)}
            placeholder="Client's last name"
            aria-invalid={!!errors.clientLastName}
            aria-describedby={
              errors.clientLastName ? "clientLastName-error" : undefined
            }
          />
        </FormField>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <FormField
          label="Phone"
          htmlFor="phone"
          required
          error={errors.phone}
        >
          <input
            id="phone"
            type="tel"
            className={`input-field ${errors.phone ? "input-error" : ""}`}
            value={formData.phone}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
              let formatted = "";
              if (digits.length > 0) formatted = `(${digits.slice(0, 3)}`;
              if (digits.length >= 3) formatted = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}`;
              if (digits.length >= 6) formatted = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
              updateField("phone", formatted);
            }}
            placeholder="(555) 123-4567"
            aria-invalid={!!errors.phone}
            aria-describedby={errors.phone ? "phone-error" : undefined}
          />
        </FormField>

        <FormField
          label="Email"
          htmlFor="email"
          error={errors.email}
        >
          <input
            id="email"
            type="email"
            className={`input-field ${errors.email ? "input-error" : ""}`}
            value={formData.email}
            onChange={(e) => updateField("email", e.target.value)}
            placeholder="client@example.com"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "email-error" : undefined}
          />
        </FormField>
      </div>

      <FormField
        label="Street Address"
        htmlFor="address"
        required
        error={errors.address}
      >
        <input
          id="address"
          type="text"
          className={`input-field ${errors.address ? "input-error" : ""}`}
          value={formData.address}
          onChange={(e) => updateField("address", e.target.value)}
          placeholder="123 Main Street, Apt 4"
          aria-invalid={!!errors.address}
          aria-describedby={errors.address ? "address-error" : undefined}
        />
      </FormField>

      <div className="grid md:grid-cols-3 gap-5">
        <FormField
          label="City"
          htmlFor="city"
          required
          error={errors.city}
        >
          <input
            id="city"
            type="text"
            className={`input-field ${errors.city ? "input-error" : ""}`}
            value={formData.city}
            onChange={(e) => updateField("city", e.target.value)}
            placeholder="City"
            aria-invalid={!!errors.city}
            aria-describedby={errors.city ? "city-error" : undefined}
          />
        </FormField>

        <FormField
          label="State"
          htmlFor="state"
          required
          error={errors.state}
        >
          <select
            id="state"
            className={`input-field ${errors.state ? "input-error" : ""}`}
            value={formData.state}
            onChange={(e) => updateField("state", e.target.value)}
            aria-invalid={!!errors.state}
            aria-describedby={errors.state ? "state-error" : undefined}
          >
            <option value="">Select state</option>
            {US_STATES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </FormField>

        <FormField
          label="ZIP Code"
          htmlFor="zip"
          required
          error={errors.zip}
        >
          <input
            id="zip"
            type="text"
            inputMode="numeric"
            maxLength={5}
            className={`input-field ${errors.zip ? "input-error" : ""}`}
            value={formData.zip}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, "").slice(0, 5);
              updateField("zip", val);
            }}
            placeholder="12345"
            aria-invalid={!!errors.zip}
            aria-describedby={errors.zip ? "zip-error" : undefined}
          />
        </FormField>
      </div>

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
