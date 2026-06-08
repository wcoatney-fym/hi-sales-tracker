import { Award, Lock } from "lucide-react";
import type { BadgeDefinition } from "../../types/leaderboard";
import BadgeIcon from "./BadgeIcon";

interface TrophyCaseProps {
  earnedBadges: string[];
  allBadges: BadgeDefinition[];
}

function getRarity(slug: string): { label: string; color: string } {
  if (["apex-predator", "monthly-dominator", "centurion"].includes(slug)) {
    return { label: "Legendary", color: "text-gold" };
  }
  if (["high-roller", "weekly-champion", "sharpshooter"].includes(slug)) {
    return { label: "Epic", color: "text-blue-400" };
  }
  if (["on-fire", "lightning-round", "rising-star", "comeback-kid"].includes(slug)) {
    return { label: "Rare", color: "text-emerald-400" };
  }
  return { label: "Common", color: "text-slate-400" };
}

export default function TrophyCase({ earnedBadges, allBadges }: TrophyCaseProps) {
  if (allBadges.length === 0) return null;

  return (
    <div className="card-navy p-4 border-gold/10">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gold/10 flex items-center justify-center">
            <Award size={14} className="text-gold" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Trophy Case</h3>
            <p className="text-[10px] text-slate-400">
              {earnedBadges.length}/{allBadges.length} Collected
            </p>
          </div>
        </div>
        {/* Collection progress */}
        <div className="flex items-center gap-2">
          <div className="w-20 h-1.5 bg-navy-dark rounded-full overflow-hidden border border-slate-700/30">
            <div
              className="h-full rounded-full bg-gradient-to-r from-gold-dark to-gold"
              style={{ width: `${(earnedBadges.length / allBadges.length) * 100}%` }}
            />
          </div>
          <span className="text-[10px] text-gold font-bold">
            {Math.round((earnedBadges.length / allBadges.length) * 100)}%
          </span>
        </div>
      </div>

      {/* Scrollable badge strip */}
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
        {allBadges.map((badge) => {
          const isEarned = earnedBadges.includes(badge.slug);
          const rarity = getRarity(badge.slug);

          return (
            <div
              key={badge.slug}
              className={`flex-shrink-0 w-20 p-2.5 rounded-lg border text-center group relative ${
                isEarned
                  ? "bg-navy-dark/60 border-gold/20 hover:border-gold/40"
                  : "bg-navy-dark/30 border-slate-700/20"
              }`}
            >
              <div className={`mx-auto mb-1.5 ${!isEarned ? "badge-locked" : ""}`}>
                {isEarned ? (
                  <BadgeIcon slug={badge.slug} size={18} badges={allBadges} />
                ) : (
                  <div className="w-6 h-6 mx-auto rounded-full bg-slate-700/50 flex items-center justify-center">
                    <Lock size={10} className="text-slate-600" />
                  </div>
                )}
              </div>
              <p className={`text-[9px] font-medium truncate ${isEarned ? "text-white" : "text-slate-600"}`}>
                {badge.label}
              </p>
              <p className={`text-[8px] font-bold mt-0.5 ${isEarned ? rarity.color : "text-slate-700"}`}>
                {rarity.label}
              </p>

              {/* Tooltip */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-navy border border-slate-600 rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 w-36">
                <p className="text-[10px] font-semibold text-gold">{badge.label}</p>
                <p className="text-[9px] text-slate-400 mt-0.5">{badge.description}</p>
                {!isEarned && (
                  <p className="text-[9px] text-slate-500 mt-1 italic">{badge.requirement_description}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
