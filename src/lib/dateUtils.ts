import type { DateRange, DatePreset } from "../types/dashboard";

export function getDateRange(preset: DatePreset): DateRange {
  const now = new Date();

  switch (preset) {
    case "thisMonth": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      return { startDate: start.toISOString(), endDate: end.toISOString(), label: "This Month" };
    }
    case "today": {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return { startDate: start.toISOString(), endDate: end.toISOString(), label: "Today" };
    }
    case "past7": {
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const start = new Date(end);
      start.setDate(start.getDate() - 7);
      return { startDate: start.toISOString(), endDate: end.toISOString(), label: "Past 7 Days" };
    }
    case "lastMonth": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 1);
      return { startDate: start.toISOString(), endDate: end.toISOString(), label: "Last Month" };
    }
    case "pastYear": {
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const start = new Date(end);
      start.setFullYear(start.getFullYear() - 1);
      return { startDate: start.toISOString(), endDate: end.toISOString(), label: "Past Year" };
    }
    case "thisQuarter": {
      const qMonth = Math.floor(now.getMonth() / 3) * 3;
      const start = new Date(now.getFullYear(), qMonth, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const qLabel = `Q${Math.floor(qMonth / 3) + 1} ${now.getFullYear()}`;
      return { startDate: start.toISOString(), endDate: end.toISOString(), label: qLabel };
    }
    case "past6Months": {
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const start = new Date(end);
      start.setMonth(start.getMonth() - 6);
      return { startDate: start.toISOString(), endDate: end.toISOString(), label: "Past 6 Months" };
    }
    case "allTime": {
      const start = new Date(2020, 0, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      return { startDate: start.toISOString(), endDate: end.toISOString(), label: "All Time" };
    }
    default:
      return getDateRange("thisMonth");
  }
}

export function getPreviousPeriod(range: DateRange): DateRange {
  const start = new Date(range.startDate);
  const end = new Date(range.endDate);
  const duration = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime());
  const prevStart = new Date(start.getTime() - duration);
  return { startDate: prevStart.toISOString(), endDate: prevEnd.toISOString(), label: "Previous period" };
}

export function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

export function formatPercent(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? "+100%" : "0%";
  const change = ((current - previous) / previous) * 100;
  const sign = change >= 0 ? "+" : "";
  return `${sign}${change.toFixed(1)}%`;
}

export function getChangeDirection(current: number, previous: number): "up" | "down" | "flat" {
  if (current > previous) return "up";
  if (current < previous) return "down";
  return "flat";
}

export function getDaysInRange(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)));
}

export function getMonthsInRange(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const months =
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth());
  return Math.max(1, months);
}

export function shouldShowMonthlyAverages(startDate: string, endDate: string): boolean {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const months =
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth());
  return months >= 2;
}
