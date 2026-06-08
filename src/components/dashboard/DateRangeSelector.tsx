import { useState, useRef, useEffect } from "react";
import { Calendar, ChevronDown } from "lucide-react";
import type { DateRange, DatePreset } from "../../types/dashboard";
import { getDateRange } from "../../lib/dateUtils";

interface DateRangeSelectorProps {
  value: DateRange;
  preset: DatePreset;
  onChange: (range: DateRange, preset: DatePreset) => void;
}

const PRESETS: { key: DatePreset; label: string }[] = [
  { key: "allTime", label: "All Time" },
  { key: "thisMonth", label: "This Month" },
  { key: "lastMonth", label: "Last Month" },
  { key: "thisQuarter", label: "This Quarter" },
  { key: "past6Months", label: "Past 6 Months" },
  { key: "pastYear", label: "Past Year" },
];

export default function DateRangeSelector({
  value,
  preset,
  onChange,
}: DateRangeSelectorProps) {
  const [open, setOpen] = useState(false);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handlePreset = (key: DatePreset) => {
    if (key === "custom") return;
    onChange(getDateRange(key), key);
    setOpen(false);
  };

  const handleCustomApply = () => {
    if (!customStart || !customEnd) return;
    const start = new Date(customStart);
    const end = new Date(customEnd);
    end.setDate(end.getDate() + 1);
    onChange(
      {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        label: `${customStart} - ${customEnd}`,
      },
      "custom"
    );
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 text-sm border border-slate-600 rounded-lg bg-navy-light text-slate-200 hover:bg-navy-mid transition-colors"
      >
        <Calendar size={15} className="text-gold" />
        <span className="font-medium">{value.label}</span>
        <ChevronDown size={14} className="text-slate-400" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 sm:hidden" onClick={() => setOpen(false)} />
          <div className="fixed left-4 right-4 top-1/3 sm:absolute sm:right-0 sm:left-auto sm:top-full sm:mt-2 sm:w-64 bg-navy rounded-xl border border-slate-700/50 shadow-lg z-50 overflow-hidden animate-scale-in">
            <div className="py-1">
              {PRESETS.filter((p) => p.key !== "custom").map((p) => (
                <button
                  key={p.key}
                  onClick={() => handlePreset(p.key)}
                  className={`w-full text-left px-4 py-3 sm:py-2.5 text-sm transition-colors ${
                    preset === p.key
                      ? "bg-gold/10 text-gold font-medium"
                      : "text-slate-300 hover:bg-navy-light"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="border-t border-slate-700/50 p-4">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">
                Custom Range
              </p>
              <div className="space-y-2">
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-slate-600 rounded-lg bg-navy-light text-white focus:outline-none focus:ring-1 focus:ring-gold min-h-[44px]"
                />
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-slate-600 rounded-lg bg-navy-light text-white focus:outline-none focus:ring-1 focus:ring-gold min-h-[44px]"
                />
                <button
                  onClick={handleCustomApply}
                  disabled={!customStart || !customEnd}
                  className="w-full px-3 py-2.5 text-sm font-medium text-navy-dark bg-gold rounded-lg hover:bg-gold-light disabled:opacity-40 disabled:cursor-not-allowed transition-colors min-h-[44px]"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
