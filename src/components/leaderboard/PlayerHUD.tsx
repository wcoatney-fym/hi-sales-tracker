import { Shield, Flame, Star, ChevronUp, Coins, Award } from "lucide-react";
import type { LeaderboardEntry } from "../../types/leaderboard";
import { TIER_CONFIG } from "../../types/leaderboard";

interface PlayerHUDProps {
  agent: { id: string; firstName: string; lastName: string };
  entry: LeaderboardEntry | undefined;
}

const TIER_ORDER = ["Rookie", "Bronze", "Silver", "Gold", "Platinum", "Diamond"];

function TierEmblem({ tier }: { tier: string }) {
  const tierConf = TIER_CONFIG[tier] || TIER_CONFIG.Rookie;
  const glowClass =
    tier === "Diamond" ? "tier-glow-diamond" :
    tier === "Platinum" ? "tier-glow-platinum" :
    tier === "Gold" ? "tier-glow-gold" : "";

  return (
    <div className={`w-12 h-12 rounded-full flex items-center justify-center ring-2 ${tierConf.ringClass} bg-navy-dark ${glowClass}`}>
      <Shield size={22} className={tierConf.textClass} />
    </div>
  );
}

function XpBar({ xp, level }: { xp: number; level: number }) {
  const xpForCurrentLevel = level * 100;
  const xpForNextLevel = (level + 1) * 100;
  const xpInLevel = xp - xpForCurrentLevel;
  const xpNeeded = xpForNextLevel - xpForCurrentLevel;
  const pct = Math.min(100, Math.max(0, (xpInLevel / xpNeeded) * 100));

  return (
    <div className="flex-1">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
          LVL {level}
        </span>
        <span className="text-[10px] text-slate-400">
          {xpInLevel} / {xpNeeded} XP
        </span>
      </div>
      <div className="xp-bar">
        <div className="xp-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center justify-end mt-0.5">
        <span className="text-[9px] text-slate-500 flex items-center gap-0.5">
          <ChevronUp size={8} />
          LVL {level + 1}
        </span>
      </div>
    </div>
  );
}

function ComboStreak({ streak }: { streak: number }) {
  if (streak === 0) return null;

  const intensity =
    streak >= 7 ? "text-red-400" :
    streak >= 5 ? "text-orange-400" :
    streak >= 3 ? "text-yellow-400" :
    "text-slate-400";

  const glowIntensity =
    streak >= 7 ? "combo-text" :
    streak >= 5 ? "combo-text" : "";

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-navy-dark/80 border border-slate-700/30">
      <Flame size={16} className={`${intensity} ${streak >= 5 ? "animate-flame-flicker" : ""}`} />
      <div>
        <div className={`text-sm font-black ${intensity} ${glowIntensity} animate-combo-pulse`}>
          x{streak} COMBO
        </div>
        <span className="text-[9px] text-slate-500 uppercase tracking-wider">Day Streak</span>
      </div>
    </div>
  );
}

function TierLadder({ currentTier }: { currentTier: string }) {
  const currentIdx = TIER_ORDER.indexOf(currentTier);

  return (
    <div className="flex items-center gap-1">
      {TIER_ORDER.map((tier, i) => {
        const tierConf = TIER_CONFIG[tier] || TIER_CONFIG.Rookie;
        const isCurrent = i === currentIdx;
        const isPast = i < currentIdx;

        return (
          <div
            key={tier}
            className={`flex flex-col items-center gap-0.5 ${
              isCurrent ? "scale-110" : ""
            }`}
          >
            <div
              className={`w-5 h-5 rounded-full flex items-center justify-center border transition-all ${
                isCurrent
                  ? `border-2 ${tierConf.ringClass} bg-navy-light`
                  : isPast
                  ? "border-slate-600 bg-slate-700/50"
                  : "border-slate-700 bg-navy-dark/50"
              }`}
            >
              {isCurrent && <Star size={9} className={tierConf.textClass} fill="currentColor" />}
              {isPast && <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
            </div>
            {isCurrent && (
              <span className={`text-[8px] font-bold ${tierConf.textClass}`}>{tier}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function PlayerHUD({ agent, entry }: PlayerHUDProps) {
  if (!entry) return null;

  return (
    <div className="card-navy p-4 border-gold/20 relative overflow-hidden">
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute top-0 right-0 w-32 h-32 border border-gold/20 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-24 h-24 border border-gold/20 rounded-full translate-y-1/2 -translate-x-1/2" />
      </div>

      <div className="relative flex items-center gap-4">
        {/* Avatar with tier emblem */}
        <div className="relative">
          <TierEmblem tier={entry.tier} />
          <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-navy border-2 border-emerald-400 flex items-center justify-center">
            <span className="text-[8px] font-black text-emerald-400">{entry.level}</span>
          </div>
        </div>

        {/* Player info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-bold text-white truncate">
              {agent.firstName} {agent.lastName}
            </h3>
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-gold/15 text-gold border border-gold/20">
              {entry.tier}
            </span>
          </div>
          <XpBar xp={entry.xp} level={entry.level} />
        </div>

        {/* Combo streak */}
        <ComboStreak streak={entry.currentStreak} />
      </div>

      {/* Bottom row: Tokens + Policy Club + Tier Ladder */}
      <div className="mt-3 pt-3 border-t border-slate-700/30 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          {/* Token counter */}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <Coins size={13} className="text-amber-400" />
            <span className="text-xs font-bold text-amber-300">{entry.tokens.toLocaleString()}</span>
            <span className="text-[9px] text-amber-400/60 font-medium">tokens</span>
          </div>

          {/* Policy club badge */}
          {entry.policyClub && (
            <div className={`flex items-center gap-1 px-2 py-1.5 rounded-lg border ${
              entry.policyClub === "15"
                ? "bg-gold/10 border-gold/25"
                : "bg-emerald-500/10 border-emerald-500/20"
            }`}>
              <Award size={12} className={entry.policyClub === "15" ? "text-gold" : "text-emerald-400"} />
              <span className={`text-[10px] font-bold ${entry.policyClub === "15" ? "text-gold" : "text-emerald-400"}`}>
                {entry.policyClub} Policy Club
              </span>
            </div>
          )}
        </div>

        <TierLadder currentTier={entry.tier} />
      </div>
    </div>
  );
}
