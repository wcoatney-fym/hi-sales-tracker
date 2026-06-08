import { useState } from "react";
import { Columns2 as Columns, Save, ArrowLeft, Sparkles, AlertTriangle } from "lucide-react";

const TARGET_FIELDS = [
  { value: "", label: "-- Skip (keep in raw data) --" },
  { value: "agent_name", label: "Agent Name (full)" },
  { value: "agent_first_name", label: "Agent First Name" },
  { value: "agent_last_name", label: "Agent Last Name" },
  { value: "agent_number", label: "Agent Number / Writing Number" },
  { value: "agent_npn", label: "Agent NPN" },
  { value: "client_first_name", label: "Client First Name" },
  { value: "client_last_name", label: "Client Last Name" },
  { value: "client_name", label: "Client Name (full)" },
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "address", label: "Address" },
  { value: "city", label: "City" },
  { value: "state", label: "State" },
  { value: "zip", label: "Zip" },
  { value: "carrier", label: "Carrier" },
  { value: "plan_name", label: "Plan / Product Name" },
  { value: "plan_code", label: "Plan Code" },
  { value: "premium", label: "Premium" },
  { value: "policy_number", label: "Policy Number" },
  { value: "effective_date", label: "Effective / Issue Date" },
  { value: "submit_date", label: "Submit / App Received Date" },
  { value: "paid_to_date", label: "Paid To Date" },
  { value: "billing_mode", label: "Billing Mode" },
  { value: "contract_code", label: "Contract Code" },
  { value: "contract_reason", label: "Contract Reason" },
  { value: "mga", label: "MGA" },
  { value: "mga_name", label: "MGA Name" },
  { value: "ga", label: "GA" },
  { value: "ga_name", label: "GA Name" },
  { value: "writing_agent_code", label: "Writing Agent Code" },
  { value: "writing_agent_name", label: "Writing Agent Name" },
  { value: "hierarchy_level", label: "Hierarchy Level" },
  { value: "other", label: "Other (metadata)" },
];

const FUZZY_HINTS: Record<string, string> = {
  mga_name: "mga_name",
  ga: "ga",
  ga_name: "ga_name",
  wa: "writing_agent_code",
  wa_name: "writing_agent_name",
  agent_ga_level_01: "hierarchy_level",
  agent_level_02: "hierarchy_level",
  agent_level_03: "hierarchy_level",
  agent_level_04: "hierarchy_level",
  agent_level_05: "hierarchy_level",
  agent_level_06: "hierarchy_level",
  agent_level_07: "hierarchy_level",
  agent_level_08: "hierarchy_level",
  agent_level_09: "hierarchy_level",
  agent_level_10: "hierarchy_level",
  plan_code: "plan_code",
  issue_date: "effective_date",
  cntrct_code: "contract_code",
  cntrct_reason: "contract_reason",
  app_recvd_date: "submit_date",
  annual_premium: "premium",
  issue_state: "state",
  policy_nbr: "policy_number",
  paid_to_date: "paid_to_date",
  billing_mode: "billing_mode",
  first_name: "client_first_name",
  last_name: "client_last_name",
  zip: "zip",
  phone_nbr: "phone",
  phone: "phone",
  email: "email",
  address: "address",
  state: "state",
  premium: "premium",
  agent_number: "agent_number",
  agent_name: "agent_name",
  writing_number: "agent_number",
  npn: "agent_npn",
  carrier: "carrier",
  effective_date: "effective_date",
  product: "plan_name",
  plan_name: "plan_name",
  product_name: "plan_name",
};

function suggestTarget(column: string): string {
  const lower = column.toLowerCase().replace(/\s+/g, "_");
  if (FUZZY_HINTS[lower]) return FUZZY_HINTS[lower];
  for (const [key, val] of Object.entries(FUZZY_HINTS)) {
    if (lower.includes(key) || key.includes(lower)) return val;
  }
  return "";
}

interface ColumnMapperProps {
  headers: string[];
  sampleRows: Record<string, string>[];
  savedMappings: Record<string, string>;
  initialMappings: Record<string, string>;
  hasSavedMapping: boolean;
  onProcess: (mappings: Record<string, string>, saveMapping: boolean) => void;
  onBack: () => void;
  totalRows: number;
  filename: string;
}

export default function ColumnMapper({
  headers,
  sampleRows,
  savedMappings,
  initialMappings,
  hasSavedMapping,
  onProcess,
  onBack,
  totalRows,
  filename,
}: ColumnMapperProps) {
  const [mappings, setMappings] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const h of headers) {
      init[h] = initialMappings[h] || savedMappings[h] || suggestTarget(h);
    }
    return init;
  });
  const [saveForFuture, setSaveForFuture] = useState(true);
  const [showPreview, setShowPreview] = useState(true);

  const handleAutoSuggest = () => {
    const updated = { ...mappings };
    for (const h of headers) {
      if (!updated[h]) {
        updated[h] = suggestTarget(h);
      }
    }
    setMappings(updated);
  };

  const mappedCount = Object.values(mappings).filter(Boolean).length;
  const unmappedHeaders = headers.filter((h) => !mappings[h]);
  const allMapped = unmappedHeaders.length === 0;

  const previewRows = sampleRows.slice(0, 3).map((row) => {
    const mapped: Record<string, string> = {};
    for (const [col, val] of Object.entries(row)) {
      const target = mappings[col];
      if (target) {
        if (mapped[target]) {
          mapped[target] += " " + val;
        } else {
          mapped[target] = val;
        }
      }
    }
    return mapped;
  });

  const previewTargets = [...new Set(Object.values(mappings).filter(Boolean))];

  return (
    <div className="space-y-4">
      <div className="bg-navy rounded-xl border border-slate-700/50 p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gold/10 flex items-center justify-center">
              <Columns size={18} className="text-gold" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-white">Column Mapping</h4>
              <p className="text-xs text-slate-400">
                {filename} -- {totalRows.toLocaleString()} rows -- {mappedCount}/{headers.length} mapped
              </p>
            </div>
          </div>
          <button
            onClick={handleAutoSuggest}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gold bg-gold/10 border border-gold/30 rounded-lg hover:bg-gold/20 transition-colors"
          >
            <Sparkles size={12} />
            Auto-Suggest
          </button>
        </div>

        {hasSavedMapping && (
          <div className="mb-4 p-3 bg-sky-900/30 border border-sky-700/50 rounded-lg">
            <p className="text-xs text-sky-300">
              A saved mapping was found for this source. The columns have been pre-filled. You can adjust as needed.
            </p>
          </div>
        )}

        {!allMapped && (
          <div className="mb-4 p-3 bg-amber-900/30 border border-amber-700/50 rounded-lg flex items-start gap-2">
            <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-amber-300">
                {unmappedHeaders.length} column{unmappedHeaders.length > 1 ? "s" : ""} unmapped - all columns must be mapped before import
              </p>
              <p className="text-[10px] text-amber-400/80 mt-1">
                Unmapped: {unmappedHeaders.slice(0, 5).join(", ")}{unmappedHeaders.length > 5 ? ` +${unmappedHeaders.length - 5} more` : ""}
              </p>
            </div>
          </div>
        )}

        <div className="border border-slate-700/50 rounded-lg overflow-hidden max-h-[400px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-navy-light border-b border-slate-700/30 sticky top-0 z-10">
              <tr>
                <th className="text-left px-4 py-2.5 text-gold/80 text-xs uppercase tracking-wider font-medium w-1/3">Source Column</th>
                <th className="text-left px-4 py-2.5 text-gold/80 text-xs uppercase tracking-wider font-medium w-1/3">Map To</th>
                <th className="text-left px-4 py-2.5 text-gold/80 text-xs uppercase tracking-wider font-medium w-1/3">Sample Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {headers.map((h) => {
                const isMapped = !!mappings[h];
                return (
                  <tr key={h} className={`transition-colors ${
                    isMapped ? "hover:bg-navy-light/30" : "bg-amber-900/10 border-l-2 border-l-amber-500/60 hover:bg-amber-900/20"
                  }`}>
                    <td className="px-4 py-2 font-mono text-xs text-slate-200">
                      <div className="flex items-center gap-1.5">
                        {!isMapped && <AlertTriangle size={10} className="text-amber-400 flex-shrink-0" />}
                        {h}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        list="target-fields-list"
                        value={mappings[h] || ""}
                        onChange={(e) => setMappings({ ...mappings, [h]: e.target.value })}
                        placeholder={isMapped ? "" : "Type field name or select..."}
                        className={`w-full px-2 py-1.5 text-xs border rounded-md focus:outline-none focus:ring-1 focus:ring-gold text-white ${
                          isMapped ? "border-gold/50 bg-gold/10" : "border-amber-500/50 bg-navy-light"
                        }`}
                      />
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-400 truncate max-w-[200px]">
                      {sampleRows[0]?.[h] || ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <datalist id="target-fields-list">
          {TARGET_FIELDS.filter((f) => f.value).map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </datalist>

        <p className="mt-2 text-[10px] text-slate-500">
          You can type a custom field name if no predefined option matches your column.
        </p>

        <div className="mt-3 flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={saveForFuture}
              onChange={(e) => setSaveForFuture(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-slate-600 text-gold focus:ring-gold/20"
            />
            Save this mapping for future uploads
          </label>
        </div>
      </div>

      {/* Preview */}
      {showPreview && previewTargets.length > 0 && (
        <div className="bg-navy rounded-xl border border-slate-700/50 p-6">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-white">Preview (first 3 rows)</h4>
            <button
              onClick={() => setShowPreview(false)}
              className="text-xs text-slate-400 hover:text-slate-300"
            >
              Hide
            </button>
          </div>
          <div className="overflow-x-auto border border-slate-700/50 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-navy-light border-b border-slate-700/30">
                <tr>
                  {previewTargets.map((t) => (
                    <th key={t} className="text-left px-3 py-2 text-gold/80 text-xs uppercase tracking-wider font-medium whitespace-nowrap">{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {previewRows.map((row, i) => (
                  <tr key={i}>
                    {previewTargets.map((t) => (
                      <td key={t} className="px-3 py-2 text-slate-200 whitespace-nowrap max-w-[150px] truncate">
                        {row[t] || ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-white bg-navy-light border border-slate-600 rounded-lg hover:bg-navy-mid transition-colors"
        >
          <ArrowLeft size={16} />
          Back
        </button>
        <button
          onClick={() => onProcess(mappings, saveForFuture)}
          disabled={!allMapped}
          className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-lg transition-colors ${
            allMapped
              ? "text-navy-dark bg-gold hover:bg-gold-light"
              : "text-slate-400 bg-slate-700 cursor-not-allowed"
          }`}
        >
          <Save size={16} />
          Import {totalRows.toLocaleString()} Records
        </button>
      </div>
    </div>
  );
}
