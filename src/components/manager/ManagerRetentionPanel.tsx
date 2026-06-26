import { useEffect, useState } from "react";
import { Trophy, Loader2 } from "lucide-react";
import { getLeaderboard } from "../../lib/api";
import QualityMetrics from "../QualityMetrics";

interface ManagerRetentionPanelProps {
  agencyId: string;
  agencyName: string;
}

interface AgencyRank {
  rank: number;
  total: number;
  annualPremium: number;
}

// Derives the agency's leaderboard rank by aggregating the public agent
// leaderboard (monthly) by agency name and ranking on annual premium.
// This avoids inventing a dedicated agency-rank backend endpoint.
export default function ManagerRetentionPanel({ agencyId, agencyName }: ManagerRetentionPanelProps) {
  const [rank, setRank] = useState<AgencyRank | null>(null);
  const [rankLoading, setRankLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setRankLoading(true);
      try {
        const data = await getLeaderboard("monthly");
        const entries: { agencyName?: string; annualPremium: number }[] = data.leaderboard || [];
        const totals = new Map<string, number>();
        for (const e of entries) {
          const name = e.agencyName || "Unknown";
          totals.set(name, (totals.get(name) || 0) + (e.annualPremium || 0));
        }
        const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
        const idx = ranked.findIndex(([name]) => name.toLowerCase() === agencyName.toLowerCase());
        if (!cancelled) {
          setRank(
            idx >= 0
              ? { rank: idx + 1, total: ranked.length, annualPremium: ranked[idx][1] }
              : null
          );
        }
      } catch {
        if (!cancelled) setRank(null);
      } finally {
        if (!cancelled) setRankLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agencyName]);

  return (
    <div className="space-y-5">
      {/* Leaderboard rank callout */}
      <div className="bg-navy rounded-xl border border-slate-700/50 p-5 flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-gold/10 flex items-center justify-center shrink-0">
          <Trophy size={22} className="text-gold" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-slate-400">Leaderboard Rank (this month, by AP)</p>
          {rankLoading ? (
            <Loader2 size={18} className="animate-spin text-gold mt-1" />
          ) : rank ? (
            <p className="text-lg font-bold text-white">
              #{rank.rank}
              <span className="text-sm font-normal text-slate-400"> of {rank.total} agencies</span>
            </p>
          ) : (
            <p className="text-sm text-slate-500 mt-0.5">No ranking data yet</p>
          )}
        </div>
      </div>

      {/* 90-day retention gauge vs the 90% line (reuses the shared component,
          scoped to this manager's agency). Uses manager_token from localStorage. */}
      <div className="bg-navy rounded-xl border border-slate-700/50 p-5">
        <h3 className="text-sm font-semibold text-white mb-3">
          Agency 90-Day Retention vs the 90% Line
        </h3>
        {/* TODO(diamond): QualityMetrics reads manager_token from localStorage via
            getQualityMetrics; if the backend rejects the manager token shape on
            leaderboard-api, this panel will show empty — swap to a manager-scoped
            endpoint once confirmed. */}
        <QualityMetrics agencyId={agencyId} agencyName={agencyName} />
      </div>
    </div>
  );
}
