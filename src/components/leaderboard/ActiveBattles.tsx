import { Swords, Zap } from "lucide-react";
import type { LeaderboardEntry } from "../../types/leaderboard";
import { TIER_CONFIG } from "../../types/leaderboard";

interface ActiveBattlesProps {
  entries: LeaderboardEntry[];
  battles: [number, number][];
}

function BattleCard({ agentA, agentB }: { agentA: LeaderboardEntry; agentB: LeaderboardEntry }) {
  const tierA = TIER_CONFIG[agentA.tier] || TIER_CONFIG.Rookie;
  const tierB = TIER_CONFIG[agentB.tier] || TIER_CONFIG.Rookie;
  const initialsA = `${agentA.firstName.charAt(0)}${agentA.lastName.charAt(0)}`;
  const initialsB = `${agentB.firstName.charAt(0)}${agentB.lastName.charAt(0)}`;
  const gap = Math.abs(agentA.policies - agentB.policies);
  const isTied = gap === 0;

  return (
    <div className="relative flex items-center gap-2 p-3 rounded-lg bg-navy-dark/60 border border-red-500/20 hover:border-red-500/40 transition-all">
      {/* Agent A */}
      <div className="flex-1 flex items-center gap-2">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold ring-1 ${tierA.ringClass} bg-navy-light text-white`}>
          {initialsA}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-white truncate">
            {agentA.firstName} {agentA.lastName.charAt(0)}.
          </p>
          <p className="text-lg font-black text-white">{agentA.policies}</p>
        </div>
      </div>

      {/* VS Divider */}
      <div className="flex flex-col items-center px-2">
        <div className="w-8 h-8 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center">
          <span className="vs-badge text-red-400">VS</span>
        </div>
        {isTied && (
          <div className="flex items-center gap-0.5 mt-1">
            <Zap size={8} className="text-yellow-400" />
            <span className="text-[8px] font-bold text-yellow-400 uppercase">Tied!</span>
          </div>
        )}
        {!isTied && gap <= 1 && (
          <span className="text-[8px] font-bold text-orange-400 mt-1 animate-pulse">CLOSE!</span>
        )}
      </div>

      {/* Agent B */}
      <div className="flex-1 flex items-center gap-2 justify-end">
        <div className="min-w-0 text-right">
          <p className="text-xs font-semibold text-white truncate">
            {agentB.firstName} {agentB.lastName.charAt(0)}.
          </p>
          <p className="text-lg font-black text-white">{agentB.policies}</p>
        </div>
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold ring-1 ${tierB.ringClass} bg-navy-light text-white`}>
          {initialsB}
        </div>
      </div>
    </div>
  );
}

export default function ActiveBattles({ entries, battles }: ActiveBattlesProps) {
  if (battles.length === 0) return null;

  const battlePairs = battles.map(([rankA, rankB]) => {
    const a = entries.find((e) => e.rank === rankA);
    const b = entries.find((e) => e.rank === rankB);
    return a && b ? { a, b } : null;
  }).filter(Boolean) as { a: LeaderboardEntry; b: LeaderboardEntry }[];

  if (battlePairs.length === 0) return null;

  return (
    <div className="card-navy p-4 border-red-500/10 overflow-hidden relative">
      {/* Ambient red glow */}
      <div className="absolute -top-10 right-0 w-32 h-32 bg-red-500/5 rounded-full blur-3xl" />

      <div className="relative">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg bg-red-500/10 flex items-center justify-center">
            <Swords size={14} className="text-red-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Active Battles</h3>
            <p className="text-[10px] text-slate-400">Head-to-head matchups within 1 policy</p>
          </div>
          <div className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
            <span className="text-[9px] font-bold text-red-400 uppercase">Live</span>
          </div>
        </div>

        <div className="space-y-2">
          {battlePairs.slice(0, 3).map(({ a, b }) => (
            <BattleCard key={`${a.rank}-${b.rank}`} agentA={a} agentB={b} />
          ))}
        </div>
      </div>
    </div>
  );
}
