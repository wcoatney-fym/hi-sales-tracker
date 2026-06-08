import { useState } from "react";
import { Target, ChevronDown, ChevronUp, Zap, CheckCircle2, Clock, Star, Scroll } from "lucide-react";
import type { Challenge } from "../../types/leaderboard";

interface ChallengesPanelProps {
  challenges: Challenge[];
  title?: string;
  variant?: "personal" | "agency";
}

function getDifficulty(target: number): number {
  if (target >= 20) return 3;
  if (target >= 10) return 2;
  return 1;
}

function DifficultyStars({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3].map((n) => (
        <Star
          key={n}
          size={9}
          className={n <= count ? "text-gold fill-gold" : "text-slate-600"}
        />
      ))}
    </div>
  );
}

function QuestProgressBar({ current, target }: { current: number; target: number }) {
  const pct = Math.min(100, (current / target) * 100);
  const isComplete = pct >= 100;
  const isClose = pct >= 75 && !isComplete;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2.5 bg-navy-dark rounded-full overflow-hidden border border-slate-700/30 relative">
          {/* Milestone notches */}
          {[25, 50, 75].map((m) => (
            <div
              key={m}
              className={`absolute top-0 bottom-0 w-px ${pct >= m ? "bg-slate-600/30" : "bg-slate-700/50"}`}
              style={{ left: `${m}%` }}
            />
          ))}
          <div
            className={`h-full rounded-full transition-all duration-700 ease-out relative ${
              isComplete
                ? "bg-gradient-to-r from-emerald-500 to-emerald-400"
                : isClose
                ? "progress-bar-shimmer"
                : "bg-gradient-to-r from-gold-dark to-gold"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className={`text-xs font-bold whitespace-nowrap tabular-nums ${
          isComplete ? "text-emerald-400" : "text-slate-300"
        }`}>
          {Math.round(current)}/{Math.round(target)}
        </span>
      </div>
    </div>
  );
}

function getTimeRemaining(endDate: string): string | null {
  const end = new Date(endDate + "T23:59:59");
  const now = new Date();
  const diff = end.getTime() - now.getTime();
  if (diff <= 0) return null;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 24) return `${hours}h left`;
  const days = Math.floor(hours / 24);
  return `${days}d left`;
}

export default function ChallengesPanel({ challenges, title = "Quest Board", variant = "agency" }: ChallengesPanelProps) {
  const [expanded, setExpanded] = useState(true);

  if (challenges.length === 0) return null;

  const completedCount = challenges.filter((c) => (c.teamProgress ?? 0) >= c.target_value).length;
  const totalXp = challenges.reduce((sum, c) => sum + c.reward_xp, 0);

  return (
    <div className="card-navy border-gold/10 overflow-hidden relative">
      {/* Quest board header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 sm:p-5 hover:bg-navy-light/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-gold/20 to-gold/5 flex items-center justify-center border border-gold/20">
            {variant === "personal" ? <Target size={17} className="text-gold" /> : <Scroll size={17} className="text-gold" />}
          </div>
          <div className="text-left">
            <h3 className="text-sm font-bold text-white">{title}</h3>
            <div className="flex items-center gap-2 mt-0.5">
              {completedCount > 0 && (
                <span className="text-[10px] text-emerald-400 font-semibold">
                  {completedCount}/{challenges.length} Complete
                </span>
              )}
              <span className="text-[10px] text-slate-500">|</span>
              <span className="text-[10px] text-gold font-medium flex items-center gap-0.5">
                <Zap size={8} /> {totalXp} XP Available
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Completion ring */}
          <div className="hidden sm:flex items-center gap-1.5">
            <svg width="24" height="24" viewBox="0 0 24 24" className="rotate-[-90deg]">
              <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-700/50" />
              <circle
                cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2"
                className="text-emerald-400"
                strokeDasharray={`${(completedCount / challenges.length) * 62.83} 62.83`}
                strokeLinecap="round"
              />
            </svg>
            <span className="text-[10px] text-slate-400 font-medium">
              {Math.round((completedCount / challenges.length) * 100)}%
            </span>
          </div>
          {expanded ? (
            <ChevronUp size={18} className="text-slate-400" />
          ) : (
            <ChevronDown size={18} className="text-slate-400" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-4 sm:px-5 pb-4 sm:pb-5 space-y-3 animate-fade-in">
          {challenges.map((c) => {
            const progress = c.teamProgress ?? 0;
            const isComplete = progress >= c.target_value;
            const timeLeft = getTimeRemaining(c.end_date);
            const difficulty = getDifficulty(c.target_value);

            return (
              <div
                key={c.id}
                className={`quest-card p-4 transition-all duration-300 ${
                  isComplete
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-slate-700/30 hover:border-gold/20"
                }`}
              >
                {/* Quest complete ribbon */}
                {isComplete && (
                  <div className="absolute top-0 right-0 bg-emerald-500 text-navy-dark text-[8px] font-black uppercase tracking-wider px-3 py-0.5 rounded-bl-lg">
                    Complete
                  </div>
                )}

                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                          c.type === "daily"
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : c.type === "weekly"
                            ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                            : c.type === "monthly"
                            ? "bg-gold/10 text-gold border border-gold/20"
                            : "bg-slate-500/10 text-slate-300 border border-slate-500/20"
                        }`}
                      >
                        {c.type}
                      </span>
                      <DifficultyStars count={difficulty} />
                      {isComplete && <CheckCircle2 size={13} className="text-emerald-400" />}
                    </div>
                    <h4 className={`text-sm font-semibold mt-1.5 ${isComplete ? "text-emerald-300" : "text-white"}`}>
                      {c.title}
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">{c.description}</p>
                  </div>

                  {/* Reward loot */}
                  <div className="flex flex-col items-end gap-1.5">
                    <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-gold/10 border border-gold/20">
                      <Zap size={11} className="text-gold" />
                      <span className="text-xs font-bold text-gold">{c.reward_xp}</span>
                      <span className="text-[9px] text-gold/70">XP</span>
                    </div>
                    {timeLeft && c.type === "daily" && (
                      <div className="flex items-center gap-1 text-[10px] text-orange-400 font-medium">
                        <Clock size={9} />
                        {timeLeft}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-3">
                  <QuestProgressBar current={progress} target={c.target_value} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
