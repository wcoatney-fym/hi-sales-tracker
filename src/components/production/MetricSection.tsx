import type { DateRange } from "../../types/dashboard";

// Groups KPI cards under an explicit label so it's unambiguous which metrics
// follow the date picker and which describe the whole current book.
export default function MetricSection({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-700/60 bg-slate-800/20 p-4">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-200">{title}</span>
        <span className="text-xs text-slate-500">· {subtitle}</span>
      </div>
      {children}
    </div>
  );
}

export function formatRangeLabel(range: DateRange): string {
  const fmt = (d: string, withYear: boolean) =>
    new Date(d.includes("T") ? d : d + "T00:00:00").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(withYear ? { year: "numeric" } : {}),
    });
  return `${fmt(range.startDate, false)} – ${fmt(range.endDate, true)}`;
}
