import {
  DollarSign,
  FileText,
  TrendingUp,
  Users,
  UserPlus,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import type { KpiData } from "../../types/dashboard";
import { formatCurrency, formatPercent, getChangeDirection } from "../../lib/dateUtils";

interface KpiCardsProps {
  data: KpiData | null;
  loading: boolean;
}

interface CardConfig {
  label: string;
  icon: React.ElementType;
  valueKey: keyof KpiData;
  prevKey: keyof KpiData;
  format: "currency" | "number" | "currencyExact";
}

const CARDS: CardConfig[] = [
  {
    label: "Total Revenue",
    icon: DollarSign,
    valueKey: "totalRevenue",
    prevKey: "prevTotalRevenue",
    format: "currency",
  },
  {
    label: "Policies Sold",
    icon: FileText,
    valueKey: "policiesSold",
    prevKey: "prevPoliciesSold",
    format: "number",
  },
  {
    label: "Avg Policy Value",
    icon: TrendingUp,
    valueKey: "avgPolicyValue",
    prevKey: "prevAvgPolicyValue",
    format: "currencyExact",
  },
  {
    label: "Active Agents",
    icon: Users,
    valueKey: "activeAgents",
    prevKey: "prevActiveAgents",
    format: "number",
  },
  {
    label: "New Clients",
    icon: UserPlus,
    valueKey: "newClients",
    prevKey: "prevNewClients",
    format: "number",
  },
  {
    label: "Revenue / Agent",
    icon: BarChart3,
    valueKey: "revenuePerAgent",
    prevKey: "prevRevenuePerAgent",
    format: "currency",
  },
];

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

function formatValue(value: number, format: CardConfig["format"]): string {
  switch (format) {
    case "currency":
      return formatCurrency(value);
    case "currencyExact":
      return `$${value.toFixed(2)}`;
    case "number":
      return value.toLocaleString();
  }
}

export default function KpiCards({ data, loading }: KpiCardsProps) {
  if (loading || !data) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {CARDS.map((c) => (
          <SkeletonCard key={c.label} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
      {CARDS.map((card) => {
        const Icon = card.icon;
        const current = Number(data[card.valueKey]) || 0;
        const prev = Number(data[card.prevKey]) || 0;
        const direction = getChangeDirection(current, prev);
        const pct = formatPercent(current, prev);

        return (
          <div
            key={card.label}
            className="bg-navy rounded-xl border border-slate-700/50 p-5 hover:border-gold/30 transition-all group"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-gold/10 flex items-center justify-center group-hover:bg-gold/20 transition-colors">
                <Icon size={18} className="text-gold" />
              </div>
            </div>

            <p className="text-2xl font-bold text-white tracking-tight">
              {formatValue(current, card.format)}
            </p>

            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-slate-400 font-medium">
                {card.label}
              </span>
              <span
                className={`flex items-center gap-0.5 text-xs font-semibold ${
                  direction === "up"
                    ? "text-emerald-400"
                    : direction === "down"
                    ? "text-rose-400"
                    : "text-slate-500"
                }`}
              >
                {direction === "up" && <ArrowUpRight size={12} />}
                {direction === "down" && <ArrowDownRight size={12} />}
                {pct}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
