import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";

interface GrowthBadgeProps {
  current: number;
  previous: number;
  className?: string;
}

export default function GrowthBadge({ current, previous, className = "" }: GrowthBadgeProps) {
  if (previous === 0 && current === 0) {
    return (
      <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-700/50 text-slate-400 ${className}`}>
        <Minus size={11} />
        0%
      </span>
    );
  }

  const pct = previous === 0 ? 100 : ((current - previous) / previous) * 100;
  const direction = current > previous ? "up" : current < previous ? "down" : "flat";

  if (direction === "flat") {
    return (
      <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-700/50 text-slate-400 ${className}`}>
        <Minus size={11} />
        0%
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-semibold ${
        direction === "up"
          ? "bg-emerald-500/10 text-emerald-400"
          : "bg-rose-500/10 text-rose-400"
      } ${className}`}
    >
      {direction === "up" ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
      {direction === "up" ? "+" : ""}{pct.toFixed(1)}%
    </span>
  );
}
