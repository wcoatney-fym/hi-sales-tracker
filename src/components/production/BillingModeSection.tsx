import { useState, useEffect, useCallback } from "react";
import { CreditCard, Loader2, AlertTriangle } from "lucide-react";
import { adminGetBillingModeBreakdown } from "../../lib/api";
import type { DateRange } from "../../types/dashboard";

interface BillingModeSectionProps {
  token: string;
  dateRange: DateRange;
  agencyFilter?: string;
  agencies?: string[];
  agentNumber?: string;
}

interface ModeDistribution {
  billing_mode: string;
  total: number;
  breakdown: Record<string, number>;
}

interface ModeTermination {
  billing_mode: string;
  rate: number;
  terminated: number;
  total: number;
}

const MODE_LABELS: Record<string, string> = {
  "1": "Monthly",
  "3": "Quarterly",
  "6": "Semi-Annual",
  "12": "Annual",
  "0": "Single Pay",
};

const CODE_LABELS: Record<string, string> = {
  A: "Active",
  T: "Terminated",
  P: "Pending",
  S: "Suspended",
};

const CODE_COLORS: Record<string, { bg: string; text: string; bar: string }> = {
  A: { bg: "bg-emerald-500/20", text: "text-emerald-400", bar: "bg-emerald-500" },
  T: { bg: "bg-red-500/20", text: "text-red-400", bar: "bg-red-500" },
  P: { bg: "bg-amber-500/20", text: "text-amber-400", bar: "bg-amber-500" },
  S: { bg: "bg-slate-500/20", text: "text-slate-400", bar: "bg-slate-500" },
};

const MODE_ORDER = ["1", "3", "6", "12", "0"];

export default function BillingModeSection({
  token,
  dateRange,
  agencyFilter,
  agencies,
  agentNumber,
}: BillingModeSectionProps) {
  const [distribution, setDistribution] = useState<ModeDistribution[]>([]);
  const [termination, setTermination] = useState<ModeTermination[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedModes, setSelectedModes] = useState<Set<string>>(new Set(MODE_ORDER));

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminGetBillingModeBreakdown(
        token,
        dateRange.startDate,
        dateRange.endDate,
        agencyFilter,
        agencies,
        agentNumber
      );
      setDistribution(res.distribution || []);
      setTermination(res.termination || []);
    } catch {
      setDistribution([]);
      setTermination([]);
    } finally {
      setLoading(false);
    }
  }, [token, dateRange.startDate, dateRange.endDate, agencyFilter, agencies, agentNumber]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggleMode = (mode: string) => {
    setSelectedModes((prev) => {
      const next = new Set(prev);
      if (next.has(mode)) {
        if (next.size > 1) next.delete(mode);
      } else {
        next.add(mode);
      }
      return next;
    });
  };

  const filteredDistribution = distribution
    .filter((d) => selectedModes.has(d.billing_mode))
    .sort((a, b) => MODE_ORDER.indexOf(a.billing_mode) - MODE_ORDER.indexOf(b.billing_mode));

  const sortedTermination = [...termination].sort(
    (a, b) => MODE_ORDER.indexOf(a.billing_mode) - MODE_ORDER.indexOf(b.billing_mode)
  );

  const maxTermRate = Math.max(...sortedTermination.map((t) => t.rate), 0.01);

  return (
    <div className="bg-navy rounded-xl border border-slate-700/50 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-700/50 flex items-center gap-2">
        <CreditCard size={16} className="text-gold" />
        <h3 className="text-sm font-semibold text-white">Billing Mode Analysis</h3>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="animate-spin text-slate-500" size={28} />
        </div>
      ) : distribution.length === 0 ? (
        <div className="py-12 text-center text-sm text-slate-500">
          No billing mode data available for this period
        </div>
      ) : (
        <div className="p-4 space-y-6">
          {/* Mode selector chips */}
          <div className="flex flex-wrap gap-2">
            {MODE_ORDER.map((mode) => {
              const isSelected = selectedModes.has(mode);
              const modeData = distribution.find((d) => d.billing_mode === mode);
              const count = modeData?.total || 0;
              return (
                <button
                  key={mode}
                  onClick={() => toggleMode(mode)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                    isSelected
                      ? "bg-gold/10 border-gold/40 text-gold"
                      : "bg-navy-light border-slate-700/50 text-slate-400 hover:text-slate-300 hover:border-slate-600"
                  }`}
                >
                  {MODE_LABELS[mode] || mode}
                  {count > 0 && (
                    <span className={`ml-1.5 ${isSelected ? "text-gold/70" : "text-slate-500"}`}>
                      ({count.toLocaleString()})
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Part 1: Contract Code Distribution */}
          <div>
            <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">
              Contract Status by Billing Mode
            </h4>
            <div className="space-y-3">
              {filteredDistribution.map((item) => {
                const codes = Object.entries(item.breakdown).sort(
                  (a, b) => b[1] - a[1]
                );
                return (
                  <div key={item.billing_mode} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-white">
                        {MODE_LABELS[item.billing_mode] || item.billing_mode}
                      </span>
                      <span className="text-xs text-slate-400">
                        {item.total.toLocaleString()} policies
                      </span>
                    </div>
                    {/* Stacked bar */}
                    <div className="h-6 rounded-md overflow-hidden flex bg-navy-light">
                      {codes.map(([code, count]) => {
                        const pct = (count / item.total) * 100;
                        if (pct < 0.5) return null;
                        const colors = CODE_COLORS[code] || CODE_COLORS.S;
                        return (
                          <div
                            key={code}
                            className={`${colors.bar} relative group flex items-center justify-center transition-all`}
                            style={{ width: `${pct}%` }}
                          >
                            {pct > 8 && (
                              <span className="text-[10px] font-medium text-white/90">
                                {pct.toFixed(0)}%
                              </span>
                            )}
                            <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                              <div className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[10px] text-white whitespace-nowrap shadow-lg">
                                {CODE_LABELS[code] || code}: {count.toLocaleString()} ({pct.toFixed(1)}%)
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Legend */}
            <div className="flex flex-wrap gap-3 mt-3">
              {Object.entries(CODE_LABELS).map(([code, label]) => {
                const colors = CODE_COLORS[code];
                return (
                  <div key={code} className="flex items-center gap-1.5">
                    <div className={`w-2.5 h-2.5 rounded-sm ${colors.bar}`} />
                    <span className="text-[11px] text-slate-400">{label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Part 2: Termination Rate */}
          <div className="pt-4 border-t border-slate-700/30">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={13} className="text-amber-400" />
              <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                Termination Rate by Billing Mode
              </h4>
            </div>
            <div className="space-y-2.5">
              {sortedTermination.map((item) => {
                const pct = item.rate * 100;
                const barWidth = (item.rate / maxTermRate) * 100;
                const isHighest = item.rate === maxTermRate && item.rate > 0;
                return (
                  <div key={item.billing_mode} className="flex items-center gap-3">
                    <span className="text-xs text-slate-300 w-24 shrink-0">
                      {MODE_LABELS[item.billing_mode] || item.billing_mode}
                    </span>
                    <div className="flex-1 h-5 bg-navy-light rounded overflow-hidden relative">
                      <div
                        className={`h-full rounded transition-all ${
                          isHighest ? "bg-red-500" : "bg-amber-500/70"
                        }`}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                    <span
                      className={`text-xs font-medium w-16 text-right ${
                        isHighest ? "text-red-400" : "text-slate-300"
                      }`}
                    >
                      {pct.toFixed(1)}%
                    </span>
                    <span className="text-[10px] text-slate-500 w-20 text-right">
                      {item.terminated}/{item.total}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
