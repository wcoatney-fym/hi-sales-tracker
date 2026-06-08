import { Swords, Flame, Trophy } from "lucide-react";
import type { LeaderboardEntry } from "../../types/leaderboard";

interface RaceTrackerProps {
  entries: LeaderboardEntry[];
  dailyGoal: number;
  currentAgentId?: string | null;
}

const BAR_COLORS = [
  "from-gold to-gold-light",
  "from-slate-300 to-slate-400",
  "from-amber-600 to-amber-500",
  "from-slate-500 to-slate-400",
  "from-slate-600 to-slate-500",
];

export default function RaceTracker({ entries, dailyGoal, currentAgentId }: RaceTrackerProps) {
  const top5 = entries.slice(0, 5);
  if (top5.length === 0) return null;

  const maxVal = Math.max(dailyGoal, top5[0]?.policies || 0);

  // Detect close battles (within 1 policy of each other)
  const battlePairs: Set<number> = new Set();
  for (let i = 0; i < top5.length - 1; i++) {
    if (top5[i].policies - top5[i + 1].policies <= 1 && top5[i].policies > 0) {
      battlePairs.add(i);
      battlePairs.add(i + 1);
    }
  }

  return (
    <div className="card-navy p-5 overflow-hidden">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <Trophy size={16} className="text-gold" />
          <h3 className="text-sm font-bold text-white">Race to the Top</h3>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-navy-light border border-slate-700/50">
          <span className="text-[10px] text-slate-400">Goal:</span>
          <span className="text-[10px] font-bold text-gold">{dailyGoal} policies</span>
        </div>
      </div>

      {/* Goal line indicator */}
      <div className="relative">
        <div className="space-y-2.5">
          {top5.map((entry, i) => {
            const pct = maxVal > 0 ? Math.min(100, (entry.policies / maxVal) * 100) : 0;
            const isCurrentAgent = !!(currentAgentId && entry.agentId === currentAgentId);
            const isBattling = battlePairs.has(i);
            const initials = `${entry.firstName.charAt(0)}${entry.lastName.charAt(0)}`;

            return (
              <div key={`${entry.firstName}-${entry.lastName}`}>
                <div className="flex items-center gap-3">
                  {/* Agent avatar mini */}
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                    isCurrentAgent ? "ring-2 ring-gold bg-gold/20 text-gold" : "bg-navy-light text-slate-300"
                  }`}>
                    {initials}
                  </div>

                  {/* Bar container */}
                  <div className="flex-1 relative">
                    <div className="h-6 bg-navy-dark/80 rounded-md overflow-hidden border border-slate-700/30">
                      <div
                        className={`h-full rounded-md bg-gradient-to-r ${BAR_COLORS[i]} transition-all duration-1000 ease-out flex items-center`}
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      >
                        {pct > 20 && (
                          <span className="text-[10px] font-bold text-navy-dark ml-2 whitespace-nowrap">
                            {entry.firstName} {entry.lastName.charAt(0)}.
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Policy count */}
                  <div className="flex items-center gap-1.5 w-12 justify-end flex-shrink-0">
                    {isBattling && <Swords size={11} className="text-orange-400 animate-pulse" />}
                    <span className={`text-xs font-bold ${isCurrentAgent ? "text-gold" : "text-white"}`}>
                      {entry.policies}
                    </span>
                  </div>
                </div>

                {/* Battle indicator between adjacent agents */}
                {battlePairs.has(i) && battlePairs.has(i + 1) && i < top5.length - 1 && (
                  <div className="flex items-center justify-center py-0.5">
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-500/10">
                      <Swords size={9} className="text-orange-400" />
                      <span className="text-[9px] font-medium text-orange-400">Close battle!</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Goal line */}
        <div
          className="absolute top-0 bottom-0 border-r-2 border-dashed border-gold/40"
          style={{ left: `calc(${(dailyGoal / maxVal) * 100}% + 40px)`, right: "48px" }}
        />
      </div>

      {/* On Fire spotlight */}
      {top5.some((e) => e.currentStreak >= 5) && (
        <div className="mt-4 pt-3 border-t border-slate-700/30">
          <div className="flex items-center gap-2 mb-2">
            <Flame size={13} className="text-orange-400 animate-flame-flicker" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-orange-400">On Fire</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {top5.filter((e) => e.currentStreak >= 5).map((e) => (
              <div
                key={`streak-${e.firstName}-${e.lastName}`}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-orange-500/10 border border-orange-500/20"
              >
                <Flame size={11} className="text-orange-400" />
                <span className="text-[10px] font-medium text-orange-300">
                  {e.firstName} {e.lastName.charAt(0)}.
                </span>
                <span className="text-[10px] font-bold text-orange-400">{e.currentStreak}d</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
