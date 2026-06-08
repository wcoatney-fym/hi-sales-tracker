import { Target, Users, DollarSign, Zap, Star, Trophy } from "lucide-react";
import type { LeaderboardEntry } from "../../types/leaderboard";

interface AgencyGoalTrackerProps {
  dailyEntries: LeaderboardEntry[];
  loading: boolean;
}

const DAILY_POLICY_GOAL = 25;
const DAILY_PREMIUM_GOAL = 5000;

const MILESTONES = [
  { pct: 25, label: "Bronze", color: "text-amber-700" },
  { pct: 50, label: "Silver", color: "text-slate-300" },
  { pct: 75, label: "Gold", color: "text-gold" },
  { pct: 100, label: "Legendary", color: "text-blue-400" },
];

function GoalBar({
  current,
  target,
  label,
  icon: Icon,
  format,
}: {
  current: number;
  target: number;
  label: string;
  icon: typeof Target;
  format: (n: number) => string;
}) {
  const pct = Math.min(100, (current / target) * 100);
  const isComplete = current >= target;
  const isClose = pct >= 75 && !isComplete;

  return (
    <div className="flex-1">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <Icon size={13} className={isComplete ? "text-emerald-400" : "text-gold"} />
          <span className="text-[11px] font-semibold text-slate-300">{label}</span>
        </div>
        <span className={`text-sm font-black tabular-nums ${isComplete ? "text-emerald-400" : "text-white"}`}>
          {format(current)} <span className="text-slate-500 font-normal text-xs">/ {format(target)}</span>
        </span>
      </div>

      {/* Progress track */}
      <div className="relative h-4 bg-navy-dark rounded-full overflow-hidden border border-slate-700/50">
        {/* Milestone markers */}
        {MILESTONES.map((m) => (
          <div
            key={m.pct}
            className="absolute top-0 bottom-0 flex items-center z-10"
            style={{ left: `${m.pct}%` }}
          >
            <div className={`w-px h-full ${pct >= m.pct ? "bg-white/20" : "bg-slate-600/50"}`} />
          </div>
        ))}

        {/* Fill bar */}
        <div
          className={`h-full rounded-full transition-all duration-1000 ease-out relative ${
            isComplete
              ? "bg-gradient-to-r from-emerald-600 to-emerald-400"
              : isClose
              ? "progress-bar-shimmer"
              : "bg-gradient-to-r from-gold-dark via-gold to-gold-light"
          }`}
          style={{ width: `${pct}%` }}
        >
          {/* Inner shine */}
          <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent rounded-full" />
        </div>

        {/* Percentage in center */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`text-[10px] font-black ${
            pct > 50 ? "text-navy-dark" : "text-slate-400"
          }`}>
            {Math.round(pct)}%
          </span>
        </div>
      </div>

      {/* Milestone indicators below */}
      <div className="relative mt-1 h-3">
        {MILESTONES.map((m) => {
          const reached = pct >= m.pct;
          return (
            <div
              key={m.pct}
              className="absolute flex flex-col items-center -translate-x-1/2"
              style={{ left: `${m.pct}%` }}
            >
              {reached ? (
                <Star size={8} className={`${m.color} fill-current`} />
              ) : (
                <div className="w-1.5 h-1.5 rounded-full bg-slate-700" />
              )}
            </div>
          );
        })}
      </div>

      {isComplete && (
        <div className="flex items-center gap-1 mt-1">
          <Trophy size={10} className="text-emerald-400" />
          <span className="text-[9px] font-black text-emerald-400 uppercase tracking-wider animate-neon-flicker">
            Goal Crushed!
          </span>
        </div>
      )}
    </div>
  );
}

export default function AgencyGoalTracker({ dailyEntries, loading }: AgencyGoalTrackerProps) {
  const totalPolicies = dailyEntries.reduce((sum, e) => sum + e.policies, 0);
  const totalPremium = dailyEntries.reduce((sum, e) => sum + e.commission, 0);
  const topStreak = Math.max(0, ...dailyEntries.map((e) => e.currentStreak));

  if (loading) {
    return (
      <div className="card-navy p-5 animate-pulse">
        <div className="h-4 bg-navy-light rounded w-48 mb-4" />
        <div className="h-4 bg-navy-light rounded-full w-full mb-6" />
        <div className="h-4 bg-navy-light rounded-full w-full" />
      </div>
    );
  }

  return (
    <div className="card-navy p-5 border-gold/15 gold-glow-card overflow-hidden relative">
      {/* Ambient effects */}
      <div className="absolute -top-10 -right-10 w-40 h-40 bg-gold/5 rounded-full blur-3xl" />
      <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-emerald-500/3 rounded-full blur-3xl" />

      <div className="relative">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-gold/20 to-gold/5 flex items-center justify-center border border-gold/20">
              <Users size={17} className="text-gold" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Agency Daily Mission</h3>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] text-slate-400">
                  {dailyEntries.length} agent{dailyEntries.length !== 1 ? "s" : ""} deployed
                </span>
                {topStreak >= 3 && (
                  <>
                    <span className="text-slate-600">|</span>
                    <span className="text-[10px] text-orange-400 font-medium flex items-center gap-0.5">
                      <Zap size={8} /> Best streak: x{topStreak}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <span className="live-dot" />
            <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-wider">Active</span>
          </div>
        </div>

        <div className="space-y-5">
          <GoalBar
            current={totalPolicies}
            target={DAILY_POLICY_GOAL}
            label="Policies Deployed"
            icon={Target}
            format={(n) => n.toString()}
          />
          <GoalBar
            current={Math.ceil(totalPremium)}
            target={DAILY_PREMIUM_GOAL}
            label="Monthly Premium Secured"
            icon={DollarSign}
            format={(n) => `$${n.toLocaleString()}`}
          />
        </div>
      </div>
    </div>
  );
}
