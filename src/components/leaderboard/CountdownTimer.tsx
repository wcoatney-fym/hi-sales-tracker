import { useState, useEffect } from "react";
import { Clock } from "lucide-react";
import type { TimePeriod } from "../../types/leaderboard";

interface CountdownTimerProps {
  resetTime: string;
  period: TimePeriod;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "Resetting...";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default function CountdownTimer({ resetTime, period }: CountdownTimerProps) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const target = new Date(resetTime).getTime();
    const update = () => setRemaining(target - Date.now());
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [resetTime]);

  const label =
    period === "daily" ? "Daily" : period === "weekly" ? "Weekly" : "Monthly";

  return (
    <div className="flex items-center gap-2 text-sm text-slate-400">
      <Clock size={14} className="text-slate-500" />
      <span>
        {label} resets in{" "}
        <span className="font-semibold text-slate-200">
          {formatCountdown(remaining)}
        </span>
      </span>
    </div>
  );
}
