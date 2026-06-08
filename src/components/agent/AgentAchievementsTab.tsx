import { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  Zap,
  CheckCircle2,
  Target,
  Trophy,
  Lock,
} from "lucide-react";
import { getAgentStats, getAgentChallenges, getBadges } from "../../lib/api";
import type { BadgeDefinition, AgentChallenge } from "../../types/leaderboard";
import { TIER_CONFIG } from "../../types/leaderboard";
import BadgeIcon from "../leaderboard/BadgeIcon";

interface AgentAchievementsTabProps {
  agentId: string;
  profile: {
    xp: number;
    level: number;
    tier: string;
    current_streak: number;
    longest_streak: number;
    total_policies_all_time: number;
  };
}

export default function AgentAchievementsTab({ agentId, profile }: AgentAchievementsTabProps) {
  const [agentBadges, setAgentBadges] = useState<string[]>([]);
  const [allBadges, setAllBadges] = useState<BadgeDefinition[]>([]);
  const [personalChallenges, setPersonalChallenges] = useState<AgentChallenge[]>([]);
  const [agencyChallenges, setAgencyChallenges] = useState<AgentChallenge[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [statsData, challengeData, badgeData] = await Promise.all([
        getAgentStats(agentId),
        getAgentChallenges(agentId),
        getBadges(),
      ]);
      setAgentBadges(statsData.badges?.map((b: { badge_slug: string }) => b.badge_slug) || []);
      setPersonalChallenges(challengeData.personalChallenges || []);
      setAgencyChallenges(challengeData.agencyChallenges || []);
      setAllBadges(badgeData.badges || []);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-gold" size={24} />
      </div>
    );
  }

  const tierConf = TIER_CONFIG[profile.tier] || TIER_CONFIG.Rookie;
  const tierThresholds = [0, 50, 150, 300, 500, 1000, Infinity];
  const tierNames = ["Rookie", "Bronze", "Silver", "Gold", "Platinum", "Diamond"];
  const currentTierIdx = tierNames.indexOf(profile.tier);
  const nextTierThreshold = tierThresholds[currentTierIdx + 1] || Infinity;
  const prevTierThreshold = tierThresholds[currentTierIdx] || 0;
  const progressPct = nextTierThreshold < Infinity
    ? Math.min(100, ((profile.total_policies_all_time - prevTierThreshold) / (nextTierThreshold - prevTierThreshold)) * 100)
    : 100;

  const earnedSet = new Set(agentBadges);
  const earnedBadges = allBadges.filter((b) => earnedSet.has(b.slug));
  const lockedBadges = allBadges.filter((b) => !earnedSet.has(b.slug));

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Tier Progress Card */}
      <section className="bg-navy rounded-xl border border-slate-700/50 p-5">
        <div className="flex items-center gap-4">
          <div className={`w-16 h-16 rounded-full ring-2 ${tierConf.ringClass} flex items-center justify-center bg-navy-dark`}>
            <span className={`text-xl font-black ${tierConf.textClass}`}>{profile.tier[0]}</span>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className={`text-sm font-bold ${tierConf.textClass}`}>{profile.tier}</span>
              <span className="text-xs text-slate-500">Level {profile.level}</span>
            </div>
            <p className="text-2xl font-black text-white mt-0.5">{profile.total_policies_all_time} <span className="text-sm font-normal text-slate-400">lifetime policies</span></p>
            {nextTierThreshold < Infinity && (
              <div className="mt-2">
                <div className="h-2.5 bg-navy-dark rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-gold-dark to-gold rounded-full transition-all duration-700"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  {nextTierThreshold - profile.total_policies_all_time} more to{" "}
                  <span className="font-medium text-slate-300">{tierNames[currentTierIdx + 1]}</span>
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Personal Records */}
        <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-slate-700/30">
          <div className="text-center">
            <p className="text-lg font-bold text-white">{profile.current_streak}</p>
            <p className="text-[9px] text-slate-500 uppercase tracking-wider">Current Streak</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-white">{profile.longest_streak}</p>
            <p className="text-[9px] text-slate-500 uppercase tracking-wider">Best Streak</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-white">{profile.xp.toLocaleString()}</p>
            <p className="text-[9px] text-slate-500 uppercase tracking-wider">Total XP</p>
          </div>
        </div>
      </section>

      {/* Badges */}
      <section className="bg-navy rounded-xl border border-slate-700/50 p-5">
        <h3 className="text-sm font-semibold text-white mb-4">
          Badges Earned ({earnedBadges.length})
        </h3>
        {earnedBadges.length === 0 ? (
          <p className="text-xs text-slate-500">Complete challenges to unlock your first badge!</p>
        ) : (
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">
            {earnedBadges.map((badge) => (
              <div key={badge.slug} className="flex flex-col items-center gap-1.5 p-2 rounded-lg bg-navy-dark/50 border border-slate-700/30">
                <BadgeIcon slug={badge.slug} size={20} badges={allBadges} showTooltip />
                <span className="text-[9px] text-slate-300 text-center leading-tight font-medium">{badge.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Locked Badges */}
        {lockedBadges.length > 0 && (
          <>
            <h4 className="text-xs font-semibold text-slate-500 mt-6 mb-3 flex items-center gap-1.5">
              <Lock size={11} />
              Locked ({lockedBadges.length})
            </h4>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">
              {lockedBadges.map((badge) => (
                <div
                  key={badge.slug}
                  className="flex flex-col items-center gap-1.5 p-2 rounded-lg bg-navy-dark/30 border border-slate-800/50 opacity-40"
                  title={badge.requirement_description}
                >
                  <BadgeIcon slug={badge.slug} size={20} badges={allBadges} />
                  <span className="text-[9px] text-slate-500 text-center leading-tight">{badge.label}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Personal Challenges */}
      <section className="bg-navy rounded-xl border border-slate-700/50 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Target size={16} className="text-gold" />
          <h3 className="text-sm font-semibold text-gold">Your Challenges</h3>
        </div>
        {personalChallenges.length === 0 ? (
          <p className="text-xs text-slate-500">No active personal challenges right now.</p>
        ) : (
          <div className="space-y-3">
            {personalChallenges.map((c) => (
              <ChallengeCard key={c.id} challenge={c} />
            ))}
          </div>
        )}
      </section>

      {/* Agency Challenges */}
      <section className="bg-navy rounded-xl border border-slate-700/50 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Trophy size={16} className="text-slate-300" />
          <h3 className="text-sm font-semibold text-slate-300">Agency Challenges</h3>
        </div>
        {agencyChallenges.length === 0 ? (
          <p className="text-xs text-slate-500">No active agency challenges right now.</p>
        ) : (
          <div className="space-y-3">
            {agencyChallenges.map((c) => (
              <ChallengeCard key={c.id} challenge={c} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ChallengeCard({ challenge }: { challenge: AgentChallenge }) {
  const pct = Math.min(100, (challenge.agentProgress / challenge.target_value) * 100);
  const typeColors: Record<string, string> = {
    daily: "bg-emerald-500/10 text-emerald-400",
    weekly: "bg-blue-500/10 text-blue-400",
    monthly: "bg-gold/10 text-gold",
    team: "bg-slate-500/10 text-slate-300",
  };

  return (
    <div className="p-4 rounded-lg bg-navy-dark/50 border border-slate-700/30">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${typeColors[challenge.type] || typeColors.team}`}>
              {challenge.type}
            </span>
            <h4 className="text-sm font-medium text-white">{challenge.title}</h4>
            {challenge.agentCompleted && (
              <CheckCircle2 size={14} className="text-emerald-400" />
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1">{challenge.description}</p>
        </div>
        <div className="flex items-center gap-1 text-xs font-medium text-gold">
          <Zap size={12} />
          {challenge.reward_xp} XP
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="flex-1 h-2 bg-navy rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              challenge.agentCompleted ? "bg-emerald-400" : "bg-gold"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs text-slate-400 font-medium whitespace-nowrap">
          {Math.round(challenge.agentProgress)}/{Math.round(challenge.target_value)}
        </span>
      </div>
    </div>
  );
}
