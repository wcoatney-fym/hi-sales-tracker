import { ShieldCheck, XCircle, Clock, AlertTriangle } from "lucide-react";

export interface PolicyStatusKpiData {
  activeCount: number;
  terminatedCount: number;
  pendingCount: number;
  atRiskCount: number;
  totalCount: number;
}

interface StatusCard {
  label: string;
  value: number;
  percentage: number;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  percentLabel?: string;
}

function PercentBadge({ value, label }: { value: number; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-700/50 text-slate-300">
      {value.toFixed(1)}%
      {label && <span className="text-slate-500 font-normal">{label}</span>}
    </span>
  );
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

interface PolicyStatusKpiRowProps {
  data: PolicyStatusKpiData | null;
  loading: boolean;
}

export default function PolicyStatusKpiRow({ data, loading }: PolicyStatusKpiRowProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (!data) return null;

  const total = data.totalCount || 1;
  const activeForRisk = data.activeCount || 1;

  const cards: StatusCard[] = [
    {
      label: "Active Policies",
      value: data.activeCount,
      percentage: (data.activeCount / total) * 100,
      icon: ShieldCheck,
      iconColor: "text-emerald-400",
      iconBg: "bg-emerald-500/10 group-hover:bg-emerald-500/20",
    },
    {
      label: "Terminated Policies",
      value: data.terminatedCount,
      percentage: (data.terminatedCount / total) * 100,
      icon: XCircle,
      iconColor: "text-rose-400",
      iconBg: "bg-rose-500/10 group-hover:bg-rose-500/20",
    },
    {
      label: "Pending Policies",
      value: data.pendingCount,
      percentage: (data.pendingCount / total) * 100,
      icon: Clock,
      iconColor: "text-sky-400",
      iconBg: "bg-sky-500/10 group-hover:bg-sky-500/20",
    },
    {
      label: "At Risk Policies",
      value: data.atRiskCount,
      percentage: (data.atRiskCount / activeForRisk) * 100,
      icon: AlertTriangle,
      iconColor: "text-amber-400",
      iconBg: "bg-amber-500/10 group-hover:bg-amber-500/20",
      percentLabel: "of active",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.label}
            className="bg-navy rounded-xl border border-slate-700/50 p-5 hover:border-slate-600/70 transition-all group"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-10 h-10 rounded-lg ${card.iconBg} flex items-center justify-center transition-colors`}>
                <Icon size={18} className={card.iconColor} />
              </div>
            </div>
            <p className="text-2xl font-bold text-white tracking-tight">
              {card.value.toLocaleString()}
            </p>
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-slate-400 font-medium">
                {card.label}
              </span>
              <PercentBadge value={card.percentage} label={card.percentLabel} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
