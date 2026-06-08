import {
  Crown,
  Swords,
  TrendingUp,
  TrendingDown,
  Minus,
  Flame,
  Shield,
  Star,
  Gem,
  Diamond,
  Medal,
  Coins,
  Award,
} from "lucide-react";
import type { LeaderboardEntry, BadgeDefinition } from "../../types/leaderboard";
import { TIER_CONFIG } from "../../types/leaderboard";
import BadgeIcon from "./BadgeIcon";

interface LeaderboardTableProps {
  entries: LeaderboardEntry[];
  battles: [number, number][];
  showCommission: boolean;
  badges: BadgeDefinition[];
  currentAgentId?: string | null;
}

function TierIcon({ tier, size = 14 }: { tier: string; size?: number }) {
  const tierConf = TIER_CONFIG[tier] || TIER_CONFIG.Rookie;
  const cls = tierConf.textClass;
  switch (tier) {
    case "Diamond": return <Diamond size={size} className={cls} />;
    case "Platinum": return <Gem size={size} className={cls} />;
    case "Gold": return <Crown size={size} className={cls} />;
    case "Silver": return <Star size={size} className={cls} />;
    case "Bronze": return <Medal size={size} className={cls} />;
    default: return <Shield size={size} className={cls} />;
  }
}

function RankChange({ change }: { change: number }) {
  if (change > 0) {
    return (
      <span className="flex items-center gap-0.5 text-[10px] font-bold text-emerald-400">
        <TrendingUp size={10} />+{change}
      </span>
    );
  }
  if (change < 0) {
    return (
      <span className="flex items-center gap-0.5 text-[10px] font-medium text-red-400">
        <TrendingDown size={10} />{change}
      </span>
    );
  }
  return <Minus size={10} className="text-slate-600" />;
}

function PolicyClubBadge({ club }: { club: "10" | "15" }) {
  if (club === "15") {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-gold/15 border border-gold/30 text-[9px] font-black text-gold uppercase tracking-wide">
        <Award size={9} /> 15 Club
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-[9px] font-black text-emerald-400 uppercase tracking-wide">
      <Award size={9} /> 10 Club
    </span>
  );
}

export default function LeaderboardTable({
  entries,
  battles,
  showCommission,
  badges,
  currentAgentId,
}: LeaderboardTableProps) {
  const battleRanks = new Set(battles.flat());

  if (entries.length === 0) {
    return (
      <div className="mt-8 card-navy p-12 text-center">
        <Crown size={48} className="text-slate-600 mx-auto mb-4" />
        <p className="text-slate-400 text-lg">No submissions yet for this period</p>
        <p className="text-slate-500 text-sm mt-2">Be the first to claim the top spot!</p>
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-slate-700/50 bg-navy-light">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-slate-700/60 bg-navy-dark/50">
            <th className="text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider py-3 px-3 w-14">#</th>
            <th className="text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider py-3 px-3">Agent</th>
            <th className="text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider py-3 px-3 hidden md:table-cell">Tier</th>
            <th className="text-right text-[10px] font-semibold text-slate-500 uppercase tracking-wider py-3 px-3">Policies</th>
            <th className="text-right text-[10px] font-semibold text-slate-500 uppercase tracking-wider py-3 px-3">AP</th>
            <th className="text-right text-[10px] font-semibold text-slate-500 uppercase tracking-wider py-3 px-3 hidden sm:table-cell">Tokens</th>
            <th className="text-center text-[10px] font-semibold text-slate-500 uppercase tracking-wider py-3 px-3 hidden lg:table-cell">Streak</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const isBattle = battleRanks.has(entry.rank);
            const isCurrentAgent = !!(currentAgentId && entry.agentId === currentAgentId);
            const tierConf = TIER_CONFIG[entry.tier] || TIER_CONFIG.Rookie;

            const rowBg =
              entry.rank === 1
                ? "bg-gradient-to-r from-gold/10 via-gold/5 to-transparent"
                : entry.rank === 2
                ? "bg-slate-300/[0.03]"
                : entry.rank === 3
                ? "bg-amber-700/[0.03]"
                : "";

            const borderClass = isCurrentAgent
              ? "border-l-2 border-l-gold"
              : isBattle
              ? "border-l-2 border-l-orange-500/60"
              : "border-l-2 border-l-transparent";

            return (
              <tr
                key={`${entry.firstName}-${entry.lastName}-${entry.agentNumber}`}
                className={`${rowBg} ${borderClass} border-b border-slate-800/40 transition-colors duration-150 hover:bg-white/[0.02]`}
              >
                {/* Rank */}
                <td className="py-3 px-3">
                  <div className="flex flex-col items-center gap-0.5">
                    <span className={`text-sm font-black tabular-nums ${
                      entry.rank === 1 ? "text-gold" :
                      entry.rank === 2 ? "text-slate-300" :
                      entry.rank === 3 ? "text-amber-600" :
                      "text-slate-400"
                    }`}>
                      {entry.rank === 1 && <Crown size={14} className="inline text-gold mr-0.5 -mt-0.5" />}
                      {entry.rank}
                    </span>
                    <RankChange change={entry.rankChange} />
                  </div>
                </td>

                {/* Agent */}
                <td className="py-3 px-3">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-bold ring-2 ${tierConf.ringClass} bg-navy text-white shrink-0`}>
                      {entry.firstName.charAt(0)}{entry.lastName.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`font-semibold truncate text-sm ${
                          entry.rank === 1 ? "text-gold" : "text-white"
                        }`}>
                          {entry.firstName} {entry.lastName}
                        </span>
                        {isCurrentAgent && (
                          <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-gold/20 text-gold border border-gold/30">
                            You
                          </span>
                        )}
                        {isBattle && (
                          <Swords size={11} className="text-orange-400" />
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        {entry.agencyName && (
                          <span className="text-[9px] font-medium text-slate-500 truncate max-w-[120px]">
                            {entry.agencyName}
                          </span>
                        )}
                        {entry.policyClub && <PolicyClubBadge club={entry.policyClub} />}
                        {entry.badges.length > 0 && (
                          <div className="hidden sm:flex items-center gap-0.5">
                            {entry.badges.slice(0, 2).map((slug) => (
                              <BadgeIcon key={slug} slug={slug} size={11} badges={badges} />
                            ))}
                            {entry.badges.length > 2 && (
                              <span className="text-[9px] text-slate-500">+{entry.badges.length - 2}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </td>

                {/* Tier */}
                <td className="py-3 px-3 hidden md:table-cell">
                  <div className="flex items-center gap-1.5">
                    <TierIcon tier={entry.tier} size={14} />
                    <span className={`text-xs font-medium ${tierConf.textClass}`}>
                      {entry.tier}
                    </span>
                  </div>
                </td>

                {/* Policies */}
                <td className="py-3 px-3 text-right">
                  <span className={`text-base font-black tabular-nums ${
                    entry.rank === 1 ? "text-white" : "text-slate-200"
                  }`}>
                    {entry.policies}
                  </span>
                </td>

                {/* AP */}
                <td className="py-3 px-3 text-right">
                  <span className={`text-sm font-bold tabular-nums ${
                    showCommission ? "text-gold" : "text-slate-300"
                  }`}>
                    ${Math.ceil(entry.annualPremium).toLocaleString()}
                  </span>
                </td>

                {/* Tokens */}
                <td className="py-3 px-3 text-right hidden sm:table-cell">
                  <div className="flex items-center justify-end gap-1">
                    <Coins size={12} className="text-amber-400" />
                    <span className="text-sm font-bold text-amber-300 tabular-nums">
                      {entry.tokens.toLocaleString()}
                    </span>
                  </div>
                </td>

                {/* Streak */}
                <td className="py-3 px-3 text-center hidden lg:table-cell">
                  {entry.currentStreak > 0 ? (
                    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      entry.currentStreak >= 7
                        ? "bg-red-500/10 border border-red-500/20 text-red-400"
                        : entry.currentStreak >= 5
                        ? "bg-orange-500/10 border border-orange-500/20 text-orange-400"
                        : entry.currentStreak >= 3
                        ? "bg-yellow-500/10 border border-yellow-500/20 text-yellow-400"
                        : "text-slate-500"
                    }`}>
                      <Flame size={10} /> x{entry.currentStreak}
                    </span>
                  ) : (
                    <span className="text-slate-600 text-xs">-</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
