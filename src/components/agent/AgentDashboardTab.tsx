import { useState, useEffect, useCallback } from "react";
import {
  Flame,
  TrendingUp,
  TrendingDown,
  Minus,
  Trophy,
  AlertTriangle,
  DollarSign,
  FileText,
  Target,
  Loader2,
  ChevronUp,
  Clock,
  Gift,
  ShieldCheck,
} from "lucide-react";
import {
  agentGetDashboardStats,
  agentGetProductionHistory,
  agentGetLeaderboardPosition,
  agentGetAtRiskPolicies,
  getActivePromotions,
  agentGetQualitySnapshot,
  agentGetGoal,
  agentSaveGoal,
} from "../../lib/api";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { TIER_CONFIG, QualitySnapshot, AgentGoal } from "../../types/leaderboard";

interface DashboardStats {
  today_policies: number;
  today_premium: number;
  week_policies: number;
  week_premium: number;
  month_policies: number;
  month_premium: number;
  month_avg_premium: number;
  prev_month_policies: number;
  prev_month_premium: number;
  prev_month_avg_premium: number;
}

interface ProductionDay {
  day: string;
  policies: number;
  premium: number;
}

interface LeaderboardPosition {
  rank: number;
  total_agents: number;
  my_policies: number;
  my_premium: number;
  agency: string;
  agent_above: { name: string; policies: number; gap: number } | null;
  agent_below: { name: string; policies: number; gap: number } | null;
}

interface AgentDashboardTabProps {
  sessionToken: string;
  profile: {
    xp: number;
    level: number;
    tier: string;
    current_streak: number;
    longest_streak: number;
    total_policies_all_time: number;
  };
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function getMotivationalMessage(todayPolicies: number, streak: number): string {
  if (todayPolicies === 0 && streak > 0) return "Keep the streak alive -- write your first one today!";
  if (todayPolicies === 0) return "Let's get on the board today!";
  if (todayPolicies === 1) return "Great start -- keep the momentum going!";
  if (todayPolicies >= 3) return "Incredible pace! You're on fire today!";
  return "Strong work -- push for one more!";
}

function getMomentum(current: number, previous: number): "up" | "down" | "flat" {
  if (previous === 0) return current > 0 ? "up" : "flat";
  const change = ((current - previous) / previous) * 100;
  if (change > 10) return "up";
  if (change < -10) return "down";
  return "flat";
}

export default function AgentDashboardTab({ sessionToken, profile }: AgentDashboardTabProps) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [history, setHistory] = useState<ProductionDay[]>([]);
  const [position, setPosition] = useState<LeaderboardPosition | null>(null);
  const [atRiskCount, setAtRiskCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [promotion, setPromotion] = useState<{ title: string; goal: string; incentive: string; end_date: string } | null>(null);
  const [promoCountdown, setPromoCountdown] = useState("");
  const [quality, setQuality] = useState<QualitySnapshot | null>(null);
  const [goal, setGoal] = useState<AgentGoal | null>(null);
  const [goalInput, setGoalInput] = useState("");
  const [goalSaving, setGoalSaving] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!sessionToken) return;
    setLoading(true);
    try {
      const [statsRes, historyRes, posRes, atRiskRes, qualityRes, goalRes] = await Promise.all([
        agentGetDashboardStats(sessionToken).catch(() => null),
        agentGetProductionHistory(sessionToken).catch(() => ({ history: [] })),
        agentGetLeaderboardPosition(sessionToken).catch(() => null),
        agentGetAtRiskPolicies(sessionToken).catch(() => ({ policies: [] })),
        agentGetQualitySnapshot(sessionToken).catch(() => null),
        agentGetGoal(sessionToken).catch(() => ({ goal: null })),
      ]);
      setStats(statsRes);
      setHistory(historyRes?.history || []);
      setPosition(posRes);
      setAtRiskCount(atRiskRes?.policies?.length || 0);
      setQuality(qualityRes);
      if (goalRes?.goal) {
        setGoal(goalRes.goal);
        setGoalInput(String(goalRes.goal.monthly_ap_target));
      }

      try {
        const promoRes = await getActivePromotions();
        if (promoRes.promotions?.length) setPromotion(promoRes.promotions[0]);
      } catch { /* no promo */ }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [sessionToken]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (!promotion?.end_date) return;
    const target = new Date(promotion.end_date).getTime();
    const update = () => {
      const diff = target - Date.now();
      if (diff <= 0) { setPromoCountdown("Ended"); return; }
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      setPromoCountdown(days > 0 ? `${days}d ${hours}h ${mins}m` : `${hours}h ${mins}m`);
    };
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [promotion?.end_date]);

  const handleGoalSave = async () => {
    const target = parseFloat(goalInput);
    if (isNaN(target) || target <= 0) return;
    setGoalSaving(true);
    try {
      const res = await agentSaveGoal(sessionToken, target);
      if (res.goal) setGoal(res.goal);
    } catch { /* silently fail */ }
    setGoalSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-gold" size={24} />
      </div>
    );
  }

  const todayPolicies = stats?.today_policies || 0;
  const monthMomentum = getMomentum(stats?.month_policies || 0, stats?.prev_month_policies || 0);

  const tierConf = TIER_CONFIG[profile.tier] || TIER_CONFIG.Rookie;
  const tierThresholds = [0, 50, 150, 300, 500, 1000, Infinity];
  const tierNames = ["Rookie", "Bronze", "Silver", "Gold", "Platinum", "Diamond"];
  const currentTierIdx = tierNames.indexOf(profile.tier);
  const nextTierThreshold = tierThresholds[currentTierIdx + 1] || Infinity;
  const policiesToNextTier = Math.max(0, nextTierThreshold - profile.total_policies_all_time);

  const chartData = history.map((d) => ({
    date: new Date(d.day).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    policies: d.policies,
    premium: d.premium,
  }));

  const monthPremium = stats?.month_premium || 0;
  const goalTarget = goal?.monthly_ap_target || 0;
  const goalPace = goalTarget > 0 ? Math.min(100, Math.round((monthPremium / goalTarget) * 100)) : 0;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* At-Risk Alert */}
      {atRiskCount > 0 && (
        <section className="bg-amber-950/20 border border-amber-500/20 rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
            <AlertTriangle size={18} className="text-amber-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-white">
              {atRiskCount} {atRiskCount === 1 ? "policy needs" : "policies need"} attention
            </p>
            <p className="text-xs text-slate-400 mt-0.5">Review and follow up in your book</p>
          </div>
        </section>
      )}

      {/* Quality Snapshot */}
      {quality && (
        <section className="bg-navy rounded-xl border border-slate-700/50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck size={14} className="text-emerald-400" />
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Quality Health</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <QualityChip
              label="Policies Taken"
              value={quality.policies_taken}
              suffix=" MTD"
              eligible={true}
            />
            <QualityChip
              label="30d Retention"
              value={quality.retention_30d}
              suffix="%"
              eligible={quality.retention_30d_eligible}
              eligibleDate={quality.retention_30d_eligible_date}
            />
            <QualityChip
              label="90d Retention"
              value={quality.retention_90d}
              suffix="%"
              eligible={quality.retention_90d_eligible}
              eligibleDate={quality.retention_90d_eligible_date}
            />
            <QualityChip
              label="Attention Rate"
              value={quality.attention_rate}
              suffix="%"
              eligible={true}
              lower
            />
          </div>
        </section>
      )}

      {/* Greeting + Today's Pulse */}
      <section className="bg-gradient-to-br from-navy-light to-navy rounded-xl border border-slate-700/50 p-5">
        <p className="text-sm text-slate-400 mb-1">{getGreeting()},</p>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-baseline gap-3">
              <span className="text-4xl font-black text-white">{todayPolicies}</span>
              <span className="text-sm text-slate-400">
                {todayPolicies === 1 ? "policy" : "policies"} today
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1.5">{getMotivationalMessage(todayPolicies, profile.current_streak)}</p>
          </div>
          {profile.current_streak > 0 && (
            <div className="flex flex-col items-center">
              <Flame size={28} className="text-orange-400" />
              <span className="text-lg font-bold text-orange-400">{profile.current_streak}</span>
              <span className="text-[9px] text-slate-500 uppercase tracking-wider">streak</span>
            </div>
          )}
        </div>
      </section>

      {/* Active Promotion */}
      {promotion && promoCountdown !== "Ended" && (
        <section className="relative overflow-hidden rounded-xl border border-emerald-500/30 bg-gradient-to-r from-emerald-900/20 via-teal-900/15 to-emerald-900/20 p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-emerald-500/20 border border-emerald-500/30 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[9px] font-bold text-emerald-300 uppercase tracking-widest">Promotion</span>
            </span>
            <span className="ml-auto flex items-center gap-1 px-2 py-0.5 bg-white/5 border border-white/10 rounded-full">
              <Clock size={11} className="text-amber-400" />
              <span className="text-[11px] font-mono font-bold text-amber-300">{promoCountdown}</span>
            </span>
          </div>
          <h4 className="text-sm font-bold text-white mb-2">{promotion.title}</h4>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-start gap-2 bg-white/5 rounded-lg p-2.5">
              <Target size={13} className="text-emerald-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-[9px] font-semibold text-emerald-300 uppercase tracking-wide">Goal</p>
                <p className="text-xs text-slate-200 mt-0.5">{promotion.goal}</p>
              </div>
            </div>
            <div className="flex items-start gap-2 bg-white/5 rounded-lg p-2.5">
              <Gift size={13} className="text-amber-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-[9px] font-semibold text-amber-300 uppercase tracking-wide">Incentive</p>
                <p className="text-xs text-slate-200 mt-0.5">{promotion.incentive}</p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Period KPIs + Goal Pace */}
      <section className="grid grid-cols-3 gap-3" data-tour="agent-stats">
        <KpiCard
          label="This Week"
          value={stats?.week_policies || 0}
          sublabel={`$${(stats?.week_premium || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} AP`}
          icon={FileText}
        />
        <KpiCard
          label="This Month"
          value={stats?.month_policies || 0}
          sublabel={`$${(stats?.month_premium || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} AP`}
          icon={DollarSign}
          momentum={monthMomentum}
          goalPace={goalTarget > 0 ? goalPace : undefined}
        />
        <KpiCard
          label="Avg AP"
          value={`$${(stats?.month_avg_premium || 0).toFixed(0)}`}
          sublabel="per policy"
          icon={TrendingUp}
          momentum={getMomentum(stats?.month_avg_premium || 0, stats?.prev_month_avg_premium || 0)}
        />
      </section>

      {/* Monthly Goal */}
      <section className="bg-navy rounded-xl border border-slate-700/50 p-4" data-tour="agent-goal-section">
        <div className="flex items-center gap-2 mb-3">
          <Target size={14} className="text-sky-400" />
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Monthly AP Goal</h3>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 flex-1">
            <span className="text-xs text-slate-500">$</span>
            <input
              type="number"
              value={goalInput}
              onChange={(e) => setGoalInput(e.target.value)}
              onBlur={handleGoalSave}
              onKeyDown={(e) => e.key === "Enter" && handleGoalSave()}
              placeholder="Set target..."
              className="w-28 bg-navy-dark border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
            />
            {goalSaving && <Loader2 size={12} className="text-sky-400 animate-spin" />}
          </div>
          {goalTarget > 0 && (
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-lg font-bold text-white">{goalPace}%</p>
                <p className="text-[9px] text-slate-500">of goal</p>
              </div>
              <div className="w-10 h-10 relative">
                <svg viewBox="0 0 36 36" className="w-10 h-10 -rotate-90">
                  <circle cx="18" cy="18" r="15" fill="none" stroke="#1e293b" strokeWidth="3" />
                  <circle
                    cx="18" cy="18" r="15" fill="none"
                    stroke={goalPace >= 80 ? "#10b981" : goalPace >= 50 ? "#f59e0b" : "#ef4444"}
                    strokeWidth="3"
                    strokeDasharray={`${goalPace * 0.94} 100`}
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            </div>
          )}
        </div>
        {goalTarget > 0 && stats && (
          <p className="text-[10px] text-slate-500 mt-2">
            ${monthPremium.toLocaleString(undefined, { maximumFractionDigits: 0 })} of ${goalTarget.toLocaleString(undefined, { maximumFractionDigits: 0 })} AP MTD
          </p>
        )}
      </section>

      {/* 30-Day Production Trend */}
      {chartData.length > 0 && (
        <section className="bg-navy rounded-xl border border-slate-700/50 p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">30-Day Production</h3>
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="agentProdGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#d4a017" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#d4a017" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tick={{ fill: "#64748b", fontSize: 10 }}
                interval="preserveStartEnd"
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fill: "#64748b", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #475569", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "#e2e8f0" }}
              />
              <Area
                type="monotone"
                dataKey="policies"
                stroke="#d4a017"
                strokeWidth={2}
                fill="url(#agentProdGrad)"
                dot={false}
                activeDot={{ r: 3, fill: "#d4a017" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* Leaderboard Position */}
      {position && (
        <section>
          <div className="bg-navy rounded-xl border border-slate-700/50 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Trophy size={14} className="text-gold" />
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Agency Rank</h3>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-white">#{position.rank}</span>
              <span className="text-xs text-slate-500">of {position.total_agents} agents</span>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">{position.agency}</p>

            {position.agent_above && (
              <div className="mt-3 flex items-center gap-2 text-xs">
                <ChevronUp size={12} className="text-emerald-400" />
                <span className="text-slate-400">
                  <span className="text-white font-medium">{position.agent_above.name}</span>
                  {" "}is {position.agent_above.gap} ahead
                </span>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Streak + Tier Progress Row */}
      <section className="grid grid-cols-2 gap-3">
        <div className="bg-navy rounded-xl border border-slate-700/50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Flame size={14} className="text-orange-400" />
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Streak</h3>
          </div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-2xl font-black text-white">{profile.current_streak}</span>
            <span className="text-[10px] text-slate-500">days</span>
          </div>
          <StreakDots history={history} />
          <p className="text-[10px] text-slate-500 mt-2">Best: {profile.longest_streak} days</p>
        </div>

        <div className="bg-navy rounded-xl border border-slate-700/50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className={`text-xs font-bold ${tierConf.textClass}`}>{profile.tier}</span>
          </div>
          <div className="flex items-baseline gap-1 mb-2">
            <span className="text-2xl font-black text-white">{profile.total_policies_all_time}</span>
            <span className="text-[10px] text-slate-500">lifetime</span>
          </div>
          {policiesToNextTier < Infinity && (
            <>
              <div className="h-2 bg-navy-dark rounded-full overflow-hidden mb-1.5">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${tierConf.ringClass.includes("gold") ? "bg-gold" : "bg-sky-400"}`}
                  style={{ width: `${Math.min(100, ((profile.total_policies_all_time - (tierThresholds[currentTierIdx] || 0)) / (nextTierThreshold - (tierThresholds[currentTierIdx] || 0))) * 100)}%` }}
                />
              </div>
              <p className="text-[10px] text-slate-500">
                {policiesToNextTier} more to <span className="font-medium text-slate-300">{tierNames[currentTierIdx + 1]}</span>
              </p>
            </>
          )}
        </div>
      </section>

    </div>
  );
}

function QualityChip({
  label,
  value,
  suffix,
  eligible,
  eligibleDate,
  lower,
}: {
  label: string;
  value: number | null;
  suffix: string;
  eligible: boolean;
  eligibleDate?: string | null;
  lower?: boolean;
}) {
  if (!eligible) {
    const dateStr = eligibleDate
      ? new Date(eligibleDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : "soon";
    return (
      <div className="bg-navy-dark/50 rounded-lg p-2.5 border border-slate-700/30">
        <p className="text-[9px] text-slate-600 uppercase tracking-wider mb-1">{label}</p>
        <p className="text-[10px] text-slate-500">Check back {dateStr}</p>
      </div>
    );
  }

  const displayValue = value !== null ? `${value}${suffix}` : "--";
  const color = value === null
    ? "text-slate-400"
    : lower
      ? (value <= 10 ? "text-emerald-400" : value <= 20 ? "text-amber-400" : "text-rose-400")
      : (value >= 85 ? "text-emerald-400" : value >= 70 ? "text-amber-400" : "text-rose-400");

  return (
    <div className="bg-navy-dark/50 rounded-lg p-2.5 border border-slate-700/30">
      <p className="text-[9px] text-slate-600 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-base font-bold ${color}`}>{displayValue}</p>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sublabel,
  icon: Icon,
  momentum,
  goalPace,
}: {
  label: string;
  value: number | string;
  sublabel: string;
  icon: React.ElementType;
  momentum?: "up" | "down" | "flat";
  goalPace?: number;
}) {
  const MomentumIcon = momentum === "up" ? TrendingUp : momentum === "down" ? TrendingDown : Minus;
  const momentumColor = momentum === "up" ? "text-emerald-400" : momentum === "down" ? "text-rose-400" : "text-slate-500";

  return (
    <div className="bg-navy rounded-xl border border-slate-700/50 p-3.5">
      <div className="flex items-center justify-between mb-2">
        <Icon size={14} className="text-slate-500" />
        {momentum && <MomentumIcon size={12} className={momentumColor} />}
      </div>
      <p className="text-xl font-bold text-white">{value}</p>
      <p className="text-[10px] text-slate-500 mt-0.5">{sublabel}</p>
      <p className="text-[9px] text-slate-600 uppercase tracking-wider mt-1">{label}</p>
      {goalPace !== undefined && (
        <div className="mt-2 h-1 bg-navy-dark rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${goalPace >= 80 ? "bg-emerald-500" : goalPace >= 50 ? "bg-amber-500" : "bg-rose-500"}`}
            style={{ width: `${goalPace}%` }}
          />
        </div>
      )}
    </div>
  );
}

function StreakDots({ history }: { history: ProductionDay[] }) {
  const last14 = history.slice(-14);
  return (
    <div className="flex gap-1 flex-wrap">
      {last14.map((day) => (
        <div
          key={day.day}
          className={`w-4 h-4 rounded-sm transition-colors ${
            day.policies > 0
              ? "bg-emerald-500/70"
              : "bg-slate-700/50"
          }`}
          title={`${new Date(day.day).toLocaleDateString()}: ${day.policies} policies`}
        />
      ))}
    </div>
  );
}
