import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle, AlertCircle, Loader2, Send, User, Phone, Building2 } from "lucide-react";
import { getLeadFormConfig, submitLead, verifyAgent } from "../lib/api";

interface LeadVendor {
  id: string;
  name: string;
}

export default function LeadIntakeForm() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [vendors, setVendors] = useState<LeadVendor[]>([]);

  const [agentFirstName, setAgentFirstName] = useState("");
  const [agentLastName, setAgentLastName] = useState("");
  const [carrier, setCarrier] = useState("");
  const [agentNumber, setAgentNumber] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [verifyError, setVerifyError] = useState("");

  const [clientFirstName, setClientFirstName] = useState("");
  const [clientLastName, setClientLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [leadVendor, setLeadVendor] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    getLeadFormConfig()
      .then((data) => {
        setEnabled(data.enabled);
        setVendors(data.vendors || []);
      })
      .catch(() => setEnabled(false))
      .finally(() => setLoading(false));
  }, []);

  const verifyAgentDebounced = useCallback(async () => {
    const fn = agentFirstName.trim();
    const ln = agentLastName.trim();
    if (!fn || !ln || !carrier) {
      setVerified(false);
      setAgentNumber("");
      setVerifyError("");
      return;
    }

    setVerifying(true);
    setVerifyError("");
    try {
      const result = await verifyAgent(fn, ln, carrier);
      if (result.found) {
        setVerified(true);
        setAgentNumber(result.agentNumber);
      } else {
        setVerified(false);
        setAgentNumber("");
        setVerifyError("Agent not found. Please verify your name and carrier.");
      }
    } catch {
      setVerified(false);
      setVerifyError("Verification failed. Please try again.");
    } finally {
      setVerifying(false);
    }
  }, [agentFirstName, agentLastName, carrier]);

  useEffect(() => {
    const fn = agentFirstName.trim();
    const ln = agentLastName.trim();
    if (!fn || !ln || !carrier) {
      setVerified(false);
      setAgentNumber("");
      setVerifyError("");
      return;
    }
    const timer = setTimeout(verifyAgentDebounced, 600);
    return () => clearTimeout(timer);
  }, [agentFirstName, agentLastName, carrier, verifyAgentDebounced]);

  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhone(formatPhone(e.target.value));
  };

  const isValid = verified && clientFirstName.trim() && clientLastName.trim() &&
    /^\(\d{3}\) \d{3}-\d{4}$/.test(phone) && leadVendor;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;

    setSubmitting(true);
    setSubmitError("");
    try {
      await submitLead({
        agentFirstName: agentFirstName.trim(),
        agentLastName: agentLastName.trim(),
        carrier,
        clientFirstName: clientFirstName.trim(),
        clientLastName: clientLastName.trim(),
        phone,
        leadVendor,
      });
      navigate("/thank-you");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center p-8 max-w-md">
          <AlertCircle className="w-12 h-12 text-slate-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-slate-700 mb-2">Form Not Available</h2>
          <p className="text-slate-500">This form is currently disabled. Please contact your administrator.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 text-white mb-4 shadow-lg shadow-blue-600/20">
            <Send className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Lead Submission</h1>
          <p className="text-slate-500 mt-1">Submit a new client lead for tracking</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          {/* Agent Section */}
          <div className="p-6 border-b border-slate-100">
            <div className="flex items-center gap-2 mb-4">
              <User className="w-4 h-4 text-blue-600" />
              <h2 className="font-semibold text-slate-800">Agent Information</h2>
              {verified && (
                <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                  <CheckCircle className="w-3 h-3" /> Verified
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">First Name *</label>
                <input
                  type="text"
                  value={agentFirstName}
                  onChange={(e) => setAgentFirstName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                  placeholder="First name"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Last Name *</label>
                <input
                  type="text"
                  value={agentLastName}
                  onChange={(e) => setAgentLastName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                  placeholder="Last name"
                />
              </div>
            </div>

            <div className="mb-3">
              <label className="block text-xs font-medium text-slate-600 mb-1">Carrier *</label>
              <select
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
              >
                <option value="">Select carrier</option>
                <option value="UNL">UNL</option>
                <option value="GTL">GTL</option>
              </select>
            </div>

            {agentNumber && (
              <div className="bg-slate-50 rounded-lg px-3 py-2 text-sm">
                <span className="text-slate-500">Writing #:</span>{" "}
                <span className="font-mono font-medium text-slate-800">{agentNumber}</span>
              </div>
            )}

            {verifying && (
              <div className="flex items-center gap-2 text-xs text-slate-500 mt-2">
                <Loader2 className="w-3 h-3 animate-spin" /> Verifying agent...
              </div>
            )}

            {verifyError && (
              <p className="text-xs text-red-600 mt-2 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> {verifyError}
              </p>
            )}
          </div>

          {/* Client Section */}
          <div className="p-6 border-b border-slate-100">
            <div className="flex items-center gap-2 mb-4">
              <Phone className="w-4 h-4 text-blue-600" />
              <h2 className="font-semibold text-slate-800">Client Information</h2>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">First Name *</label>
                <input
                  type="text"
                  value={clientFirstName}
                  onChange={(e) => setClientFirstName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                  placeholder="Client first name"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Last Name *</label>
                <input
                  type="text"
                  value={clientLastName}
                  onChange={(e) => setClientLastName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                  placeholder="Client last name"
                />
              </div>
            </div>

            <div className="mb-3">
              <label className="block text-xs font-medium text-slate-600 mb-1">Phone *</label>
              <input
                type="tel"
                value={phone}
                onChange={handlePhoneChange}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                placeholder="(555) 123-4567"
              />
            </div>
          </div>

          {/* Lead Vendor Section */}
          <div className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <Building2 className="w-4 h-4 text-blue-600" />
              <h2 className="font-semibold text-slate-800">Lead Source</h2>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Lead Vendor *</label>
              <select
                value={leadVendor}
                onChange={(e) => setLeadVendor(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
              >
                <option value="">Select vendor</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.name}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Submit */}
          <div className="px-6 pb-6">
            {submitError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" /> {submitError}
              </div>
            )}

            <button
              type="submit"
              disabled={!isValid || submitting}
              className="w-full py-3 px-4 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-sm"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Submitting...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" /> Submit Lead
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
