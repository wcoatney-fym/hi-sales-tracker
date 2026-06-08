import GrowthBadge from "./GrowthBadge";

export interface KpiMetric {
  label: string;
  value: number;
  previousValue: number;
  format: "currency" | "number" | "percent";
  icon: React.ElementType;
}

interface KpiRowProps {
  metrics: KpiMetric[];
  loading: boolean;
}

function formatValue(value: number, format: KpiMetric["format"]): string {
  switch (format) {
    case "currency":
      if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
      if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
      return `$${value.toFixed(0)}`;
    case "number":
      return value.toLocaleString();
    case "percent":
      return `${value.toFixed(1)}%`;
  }
}

function SkeletonCard() {
  return (
    <div className="bg-navy rounded-xl border border-slate-700/50 p-5 animate-pulse">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-navy-light" />
        <div className="h-3 w-24 bg-navy-light rounded" />
      </div>
      <div className="h-7 w-28 bg-navy-light rounded mb-2" />
      <div className="h-3 w-16 bg-navy-light rounded" />
    </div>
  );
}

export default function KpiRow({ metrics, loading }: KpiRowProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
      {metrics.map((metric) => {
        const Icon = metric.icon;
        return (
          <div
            key={metric.label}
            className="bg-navy rounded-xl border border-slate-700/50 p-5 hover:border-gold/30 transition-all group"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-gold/10 flex items-center justify-center group-hover:bg-gold/20 transition-colors">
                <Icon size={18} className="text-gold" />
              </div>
            </div>
            <p className="text-2xl font-bold text-white tracking-tight">
              {formatValue(metric.value, metric.format)}
            </p>
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-slate-400 font-medium">
                {metric.label}
              </span>
              <GrowthBadge current={metric.value} previous={metric.previousValue} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
