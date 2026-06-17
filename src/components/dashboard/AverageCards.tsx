import {
  CalendarDays,
  CalendarRange,
  DollarSign,
  FileText,
  Info,
} from "lucide-react";
import type { KpiData, DateRange } from "../../types/dashboard";
import {
  getDaysInRange,
  getMonthsInRange,
  shouldShowMonthlyAverages,
} from "../../lib/dateUtils";

interface AverageCardsProps {
  data: KpiData | null;
  dateRange: DateRange;
  loading: boolean;
}

interface CardDef {
  label: string;
  tooltip: string;
  value: number;
  format: "currency" | "number";
  icon: React.ElementType;
  accentIcon: React.ElementType;
}

function SkeletonCard() {
  return (
    <div className="bg-navy rounded-xl border border-slate-700/50 p-5 animate-pulse">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-navy-light" />
        <div className="h-3 w-28 bg-navy-light rounded" />
      </div>
      <div className="h-7 w-24 bg-navy-light rounded mb-2" />
      <div className="h-3 w-20 bg-navy-light rounded" />
    </div>
  );
}

function CardItem({ card }: { card: CardDef }) {
  const Icon = card.icon;
  const formatted =
    card.format === "currency"
      ? `$${card.value.toFixed(2)}`
      : card.value.toFixed(1);

  return (
    <div className="bg-navy rounded-xl border border-slate-700/50 p-5 hover:border-gold/30 transition-all group relative">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-lg bg-gold/10 flex items-center justify-center group-hover:bg-gold/20 transition-colors">
          <Icon size={18} className="text-gold" />
        </div>
      </div>

      <p className="text-2xl font-bold text-white tracking-tight">
        {formatted}
      </p>

      <div className="flex items-center justify-between mt-2">
        <span className="text-xs text-slate-400 font-medium">{card.label}</span>
        <div className="relative">
          <Info
            size={14}
            className="text-slate-500 hover:text-gold cursor-help transition-colors peer"
          />
          <div className="absolute bottom-full right-0 mb-2 w-52 px-3 py-2 rounded-lg bg-navy-light text-slate-200 text-xs leading-relaxed shadow-lg border border-slate-700/50 opacity-0 pointer-events-none peer-hover:opacity-100 peer-hover:pointer-events-auto transition-opacity z-20">
            {card.tooltip}
            <div className="absolute top-full right-3 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-navy-light" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AverageCards({
  data,
  dateRange,
  loading,
}: AverageCardsProps) {
  const showMonthly = shouldShowMonthlyAverages(
    dateRange.startDate,
    dateRange.endDate
  );
  const cardCount = showMonthly ? 4 : 2;

  if (loading || !data) {
    return (
      <div
        className={`grid grid-cols-2 ${
          showMonthly ? "lg:grid-cols-4" : "lg:grid-cols-2"
        } gap-4`}
      >
        {Array.from({ length: cardCount }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  const days = getDaysInRange(dateRange.startDate, dateRange.endDate);
  const months = getMonthsInRange(dateRange.startDate, dateRange.endDate);

  const policiesPerDay = data.policiesSold / days;
  const revenuePerDay = data.totalRevenue / days;

  const cards: CardDef[] = [
    {
      label: "Avg Policies / Day",
      tooltip: `${data.policiesSold.toLocaleString()} policies over ${days} day${days !== 1 ? "s" : ""}`,
      value: policiesPerDay,
      format: "number",
      icon: FileText,
      accentIcon: CalendarDays,
    },
    {
      label: "Avg Annual Premium / Day",
      tooltip: `$${data.totalRevenue.toLocaleString()} annual premium over ${days} day${days !== 1 ? "s" : ""}`,
      value: revenuePerDay,
      format: "currency",
      icon: DollarSign,
      accentIcon: CalendarDays,
    },
  ];

  if (showMonthly) {
    const policiesPerMonth = data.policiesSold / months;
    const revenuePerMonth = data.totalRevenue / months;

    cards.push(
      {
        label: "Avg Policies / Month",
        tooltip: `${data.policiesSold.toLocaleString()} policies over ${months} month${months !== 1 ? "s" : ""}`,
        value: policiesPerMonth,
        format: "number",
        icon: FileText,
        accentIcon: CalendarRange,
      },
      {
        label: "Avg Annual Premium / Month",
        tooltip: `$${data.totalRevenue.toLocaleString()} annual premium over ${months} month${months !== 1 ? "s" : ""}`,
        value: revenuePerMonth,
        format: "currency",
        icon: DollarSign,
        accentIcon: CalendarRange,
      }
    );
  }

  return (
    <div
      className={`grid grid-cols-2 ${
        showMonthly ? "lg:grid-cols-4" : "lg:grid-cols-2"
      } gap-4`}
    >
      {cards.map((card) => (
        <CardItem key={card.label} card={card} />
      ))}
    </div>
  );
}
