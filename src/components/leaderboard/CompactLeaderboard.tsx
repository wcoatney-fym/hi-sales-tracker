import { useState } from "react";
import { Crown, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus, Flame, Trophy } from "lucide-react";
import type { LeaderboardEntry } from "../../types/leaderboard";
import { TIER_CONFIG } from "../../types/leaderboard";

interface CompactLeaderboardProps {
  entries: LeaderboardEntry[];
  title: string;
  subtitle?: string;
  icon?: "flame" | "trophy";
  currentAgentId?: string | null;
}

function RankChange({ change }: { change: number }) {
  if (change > 0) {
    return (
      <span className="flex items-center gap-0.5 text-[10px] font-medium text-emerald-400">
        <TrendingUp size={10} />
        {change}
      </span>
    );
  }
  if (change < 0) {
    return (
      <span className="flex items-center gap-0.5 text-[10px] font-medium text-red-400">
        <TrendingDown size={10} />
        {Math.abs(change)}
      </span>
    );
  }
  return <Minus size={10} className="text-slate-600" />;
}

export default function CompactLeaderboard({ entries, title, subtitle, icon, currentAgentId }: CompactLeaderboardProps) {
  const [expanded, setExpanded] = useState(false);
  const displayEntries = expanded ? entries : entries.slice(0, 5);

  if (entries.length === 0) {
    return (
      <div className="card-navy p-5">
        <div className="flex items-center gap-2">
          {icon === "flame" && <Flame size={16} className="text-orange-400" />}
          {icon === "trophy" && <Trophy size={16} className="text-gold" />}
          <h3 className="text-sm font-semibold text-gold">{title}</h3>
        </div>
        <p className="text-xs text-slate-500 mt-2">No data yet for this period</p>
      </div>
    );
  }

  return (
    <div className="card-navy overflow-hidden">
      <div className="px-5 pt-5 pb-3 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          {icon === "flame" && <Flame size={16} className="text-orange-400" />}
          {icon === "trophy" && <Trophy size={16} className="text-gold" />}
          <h3 className="text-sm font-bold text-gold">{title}</h3>
        </div>
        {subtitle && <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>}
      </div>

      <div className="divide-y divide-slate-700/30">
        {displayEntries.map((entry) => {
          const tierConf = TIER_CONFIG[entry.tier] || TIER_CONFIG.Rookie;
          const isCurrentAgent = !!(currentAgentId && entry.agentId === currentAgentId);
          return (
            <div
              key={`${entry.firstName}-${entry.lastName}-${entry.rank}`}
              className={`flex items-center gap-3 px-5 py-3 hover:bg-navy-light/30 transition-colors ${
                isCurrentAgent ? "bg-gold/5 border-l-2 border-l-gold" : ""
              }`}
            >
              {/* Rank */}
              <div className="w-6 flex-shrink-0 text-center">
                {entry.rank <= 3 ? (
                  <Crown
                    size={14}
                    className={
                      entry.rank === 1
                        ? "text-gold mx-auto"
                        : entry.rank === 2
                        ? "text-slate-300 mx-auto"
                        : "text-amber-600 mx-auto"
                    }
                  />
                ) : (
                  <span className="text-xs font-bold text-slate-500">
                    {entry.rank}
                  </span>
                )}
              </div>

              {/* Name */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p
                    className={`text-sm font-medium truncate ${
                      entry.tier === "Gold" || entry.tier === "Platinum" || entry.tier === "Diamond"
                        ? "text-gold"
                        : "text-white"
                    }`}
                  >
                    {entry.firstName} {entry.lastName}
                  </p>
                  {isCurrentAgent && (
                    <span className="text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-gold/20 text-gold">
                      You
                    </span>
                  )}
                </div>
                <span className={`text-[10px] ${tierConf.textClass}`}>
                  {entry.tier}
                </span>
              </div>

              {/* Rank change */}
              <RankChange change={entry.rankChange} />

              {/* Policies */}
              <div className="text-right w-16">
                <p className="text-sm font-bold text-white">{entry.policies}</p>
                <p className="text-[10px] text-slate-500">policies</p>
              </div>
            </div>
          );
        })}
      </div>

      {entries.length > 5 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-slate-400 hover:text-gold border-t border-slate-700/30 transition-colors"
        >
          {expanded ? (
            <>
              Show Less <ChevronUp size={14} />
            </>
          ) : (
            <>
              View All ({entries.length}) <ChevronDown size={14} />
            </>
          )}
        </button>
      )}
    </div>
  );
}
