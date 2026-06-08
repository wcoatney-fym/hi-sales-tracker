import type { TimePeriod } from "../../types/leaderboard";

interface TimePeriodTabsProps {
  period: TimePeriod;
  onChange: (period: TimePeriod) => void;
}

const tabs: { key: TimePeriod; label: string }[] = [
  { key: "daily", label: "DAILY" },
  { key: "weekly", label: "WEEKLY" },
  { key: "monthly", label: "MONTHLY" },
];

export default function TimePeriodTabs({ period, onChange }: TimePeriodTabsProps) {
  return (
    <div className="flex gap-1 bg-navy rounded-lg p-1 border border-slate-700/50">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`relative px-5 py-2 text-xs sm:text-sm font-bold tracking-wider rounded-md transition-all duration-200 ${
            period === tab.key
              ? "bg-navy-light text-gold shadow-sm"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {tab.label}
          {period === tab.key && (
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-gold rounded-full" />
          )}
        </button>
      ))}
    </div>
  );
}
