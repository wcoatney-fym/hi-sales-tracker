import { Gift, Trophy, Coins, Calendar, Star, Clock, Target } from "lucide-react";
import type { Incentive, IncentiveStanding } from "../../types/leaderboard";

interface IncentivesPanelProps {
  incentives: Incentive[];
  standings: IncentiveStanding[];
}

const PERIOD_LABELS: Record<string, { label: string; icon: typeof Gift }> = {
  daily: { label: "Daily", icon: Clock },
  weekly: { label: "Weekly", icon: Calendar },
  monthly: { label: "Monthly", icon: Trophy },
  yearly: { label: "Yearly", icon: Star },
};

export default function IncentivesPanel({ incentives, standings }: IncentivesPanelProps) {
  const grouped: Record<string, Incentive[]> = { daily: [], weekly: [], monthly: [], yearly: [] };
  for (const inc of incentives) {
    if (grouped[inc.period_type]) {
      grouped[inc.period_type].push(inc);
    }
  }

  const periods = (["daily", "weekly", "monthly", "yearly"] as const).filter(
    (p) => grouped[p].length > 0
  );

  if (periods.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
          <Gift size={16} className="text-amber-400" />
        </div>
        <div>
          <h3 className="text-base font-bold text-white">Promotions & Incentives</h3>
          <p className="text-[10px] text-slate-400 uppercase tracking-wider">Current rewards up for grabs</p>
        </div>
      </div>

      <div className={`grid gap-4 ${periods.length === 1 ? "grid-cols-1" : periods.length === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"}`}>
        {periods.map((period) => {
          const conf = PERIOD_LABELS[period];
          const Icon = conf.icon;
          return (
            <div
              key={period}
              className="rounded-xl border border-slate-700/50 bg-navy-light p-5 hover:border-amber-500/30 transition-colors duration-200"
            >
              <div className="flex items-center gap-2 mb-3">
                <Icon size={14} className="text-amber-400" />
                <span className="text-xs font-bold text-amber-300 uppercase tracking-wider">
                  {conf.label}
                </span>
              </div>

              <div className="space-y-3">
                {grouped[period].map((inc) => (
                  <div key={inc.id} className="bg-navy/60 rounded-lg p-3 border border-slate-800/50">
                    <p className="text-sm font-semibold text-white">{inc.title}</p>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <Target size={11} className="text-slate-400" />
                      <span className="text-xs text-slate-300">{inc.goal_tokens.toLocaleString()} tokens</span>
                    </div>
                    {inc.incentive && (
                      <div className="flex items-center gap-1.5 mt-2 px-2 py-1 bg-gold/5 rounded border border-gold/15 w-fit">
                        <Gift size={11} className="text-gold" />
                        <span className="text-[11px] font-semibold text-gold">{inc.incentive}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {standings.length > 0 && (
        <div className="mt-4 rounded-xl border border-slate-700/50 bg-navy-light p-5">
          <div className="flex items-center gap-2 mb-3">
            <Coins size={14} className="text-amber-400" />
            <span className="text-xs font-bold text-amber-300 uppercase tracking-wider">
              Token Leaders
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {standings.map((s) => (
              <div
                key={s.rank}
                className={`flex items-center gap-3 p-3 rounded-lg border ${
                  s.rank === 1
                    ? "bg-gold/5 border-gold/20"
                    : s.rank === 2
                    ? "bg-slate-300/5 border-slate-400/15"
                    : "bg-amber-700/5 border-amber-700/15"
                }`}
              >
                <span className={`text-lg font-black ${
                  s.rank === 1 ? "text-gold" : s.rank === 2 ? "text-slate-300" : "text-amber-600"
                }`}>
                  #{s.rank}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{s.agentName}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <Coins size={10} className="text-amber-400" />
                    <span className="text-xs font-bold text-amber-300">{s.tokens.toLocaleString()} tokens</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
