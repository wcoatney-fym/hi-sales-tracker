import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Trophy, FileText, Loader2, Clock, Zap, Gamepad2, Swords, Target, Gift, Filter, Globe } from "lucide-react";
import { getLeaderboard, getAgencyLeaderboard, getChallenges, getBadges, getAgentChallenges, getActivePromotions, getActiveIncentives } from "../lib/api";
import { useAgentAuth } from "../hooks/useAgentAuth";
import { useAdminAuth } from "../hooks/useAdminAuth";
import type {
  LeaderboardData,
  LeaderboardEntry,
  Challenge,
  AgentChallenge,
  BadgeDefinition,
  Incentive,
  IncentiveStanding,
} from "../types/leaderboard";
import LeaderboardTable from "../components/leaderboard/LeaderboardTable";
import CompactLeaderboard from "../components/leaderboard/CompactLeaderboard";
import KpiSummary from "../components/leaderboard/KpiSummary";
import ChallengesPanel from "../components/leaderboard/ChallengesPanel";
import MotivationalQuote from "../components/leaderboard/MotivationalQuote";
import AgencyGoalTracker from "../components/leaderboard/AgencyGoalTracker";
import RaceTracker from "../components/leaderboard/RaceTracker";
import PlayerHUD from "../components/leaderboard/PlayerHUD";
import ActiveBattles from "../components/leaderboard/ActiveBattles";
import TrophyCase from "../components/leaderboard/TrophyCase";
import IncentivesPanel from "../components/leaderboard/IncentivesPanel";

type APPeriod = "daily" | "weekly" | "monthly";
type ClubFilter = "all" | "10" | "15";
type BoardMode = "agency" | "overall";

function formatCountdown(ms: number): string {
  if (ms <= 0) return "00:00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function getSeasonName(): string {
  const month = new Date().toLocaleString("en-US", { month: "long" });
  return `${month} Arena`;
}

export default function Leaderboard() {
  const navigate = useNavigate();
  const { agent, isAuthenticated, loading: authLoading } = useAgentAuth();
  const { token: adminToken, agencyId: adminAgencyId, agencyName: adminAgencyName, agencySlug: adminAgencySlug, isGlobalAdmin } = useAdminAuth();

  const [dailyData, setDailyData] = useState<LeaderboardData | null>(null);
  const [weeklyData, setWeeklyData] = useState<LeaderboardData | null>(null);
  const [monthlyData, setMonthlyData] = useState<LeaderboardData | null>(null);
  const [yearlyData, setYearlyData] = useState<LeaderboardData | null>(null);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [personalChallenges, setPersonalChallenges] = useState<AgentChallenge[]>([]);
  const [badges, setBadges] = useState<BadgeDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCommission, setShowCommission] = useState(false);
  const [apPeriod, setApPeriod] = useState<APPeriod>("weekly");
  const [clubFilter, setClubFilter] = useState<ClubFilter>("all");
  const [countdown, setCountdown] = useState("");
  const [incentives, setIncentives] = useState<Incentive[]>([]);
  const [incentiveStandings, setIncentiveStandings] = useState<IncentiveStanding[]>([]);
  const [activePromotion, setActivePromotion] = useState<{
    id: string; title: string; goal: string; incentive: string; start_date: string; end_date: string;
  } | null>(null);
  const [promoCountdown, setPromoCountdown] = useState("");
  const [boardMode, setBoardMode] = useState<BoardMode>("agency");

  // Resolve agencyId from either auth source; FYM/global admins default to the FYM agency
  const FYM_AGENCY_ID = "04813b3b-4a2c-4c55-9f7d-3964d26533f3";
  const isFymAdmin = isGlobalAdmin || adminAgencySlug === "fym";
  const agencyId = agent?.agencyId || adminAgencyId || (isFymAdmin ? FYM_AGENCY_ID : null);
  const agencyName = agent?.agencyName || adminAgencyName || (isFymAdmin ? "FYM" : null);
  const showToggle = isFymAdmin && !!adminToken;

  const fetchData = useCallback(async (mode: BoardMode) => {
    setLoading(true);
    try {
      const fetchFn = (period: string) =>
        mode === "overall"
          ? getLeaderboard(period)
          : getAgencyLeaderboard(agencyId!, period);

      const [daily, weekly, monthly, yearly, ch, bg] = await Promise.all([
        fetchFn("daily"),
        fetchFn("weekly"),
        fetchFn("monthly"),
        fetchFn("yearly"),
        getChallenges(),
        getBadges(),
      ]);

      setDailyData(daily);
      setWeeklyData(weekly);
      setMonthlyData(monthly);
      setYearlyData(yearly);
      setChallenges(ch.challenges || []);
      setBadges(bg.badges || []);

      if (isAuthenticated && agent?.id) {
        try {
          const agentCh = await getAgentChallenges(agent.id);
          setPersonalChallenges(agentCh.personalChallenges || []);
        } catch { /* no personal challenges */ }
      }

      try {
        const promoRes = await getActivePromotions();
        const promos = promoRes.promotions || [];
        setActivePromotion(promos[0] || null);
      } catch { /* no promo */ }

      try {
        const incRes = await getActiveIncentives();
        setIncentives(incRes.promotions || []);
        setIncentiveStandings(incRes.standings || []);
      } catch { /* no incentives */ }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [agencyId, isAuthenticated, agent?.id]);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated && !adminToken) {
      navigate("/agent");
      return;
    }
    if (!agencyId && boardMode === "agency") return;
    fetchData(boardMode);
  }, [fetchData, authLoading, isAuthenticated, adminToken, agencyId, boardMode, navigate]);

  useEffect(() => {
    if (!dailyData?.resetTime) return;
    const target = new Date(dailyData.resetTime).getTime();
    const update = () => setCountdown(formatCountdown(target - Date.now()));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [dailyData?.resetTime]);

  useEffect(() => {
    if (!activePromotion?.end_date) return;
    const target = new Date(activePromotion.end_date).getTime();
    const update = () => {
      const diff = target - Date.now();
      if (diff <= 0) { setPromoCountdown("Ended"); return; }
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      if (days > 0) {
        setPromoCountdown(`${days}d ${hours}h ${mins}m ${secs}s`);
      } else {
        setPromoCountdown(`${hours}h ${mins}m ${secs}s`);
      }
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [activePromotion?.end_date]);

  const dailyEntries: LeaderboardEntry[] = dailyData?.leaderboard || [];
  const weeklyEntries: LeaderboardEntry[] = weeklyData?.leaderboard || [];
  const monthlyEntries: LeaderboardEntry[] = monthlyData?.leaderboard || [];
  const yearlyEntries: LeaderboardEntry[] = yearlyData?.leaderboard || [];

  const periodDataMap: Record<APPeriod, { entries: LeaderboardEntry[]; battles: [number, number][] }> = {
    daily: { entries: dailyEntries, battles: dailyData?.battles || [] },
    weekly: { entries: weeklyEntries, battles: weeklyData?.battles || [] },
    monthly: { entries: monthlyEntries, battles: monthlyData?.battles || [] },
  };
  const activeData = periodDataMap[apPeriod];

  const filteredEntries = clubFilter === "all"
    ? activeData.entries
    : activeData.entries.filter((e) =>
        clubFilter === "15" ? e.policyClub === "15" : e.policyClub !== null
      );

  const currentAgentEntry = agent
    ? activeData.entries.find((e) => e.agentId === agent.id)
    : undefined;

  const boardTitle = boardMode === "overall"
    ? "Overall Hierarchy"
    : agencyName
      ? `${agencyName} Leaderboard`
      : "Leaderboard";

  return (
    <main className="min-h-screen bg-navy-dark">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-navy via-navy-dark to-navy-dark" />
        <div className="absolute inset-0 hero-glow" />
        <div className="absolute inset-0 scan-lines pointer-events-none" />

        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-5 pb-4">
          {/* FYM Admin Board Mode Toggle */}
          {showToggle && (
            <div className="flex items-center justify-center mb-4">
              <div className="flex items-center gap-1 px-1.5 py-1.5 rounded-xl bg-navy-light/80 border border-slate-700/50">
                <button
                  onClick={() => setBoardMode("agency")}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-200 ${
                    boardMode === "agency"
                      ? "bg-gold text-navy-dark shadow-sm shadow-gold/20"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <Trophy size={13} />
                  FYM Leaderboard
                </button>
                <button
                  onClick={() => setBoardMode("overall")}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-200 ${
                    boardMode === "overall"
                      ? "bg-gold text-navy-dark shadow-sm shadow-gold/20"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <Globe size={13} />
                  Overall Hierarchy
                </button>
              </div>
            </div>
          )}

          {/* Status bar */}
          <div className="flex items-center justify-center gap-4 mb-3">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <span className="live-dot" />
              <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-widest">Round Active</span>
            </div>
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full bg-gold/5 border border-gold/20">
              <Gamepad2 size={11} className="text-gold" />
              <span className="text-[9px] font-bold text-gold uppercase tracking-wider">{getSeasonName()}</span>
            </div>
            {!loading && dailyEntries.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <Swords size={11} className="text-slate-500" />
                <span>
                  <span className="font-bold text-white">{dailyEntries.length}</span> agents active
                </span>
              </div>
            )}
          </div>

          {/* Motivational Quote */}
          <MotivationalQuote />

          {/* Active Promotion Banner */}
          {activePromotion && promoCountdown !== "Ended" && (
            <div className="mt-4 relative overflow-hidden rounded-xl border border-emerald-500/40 bg-gradient-to-r from-emerald-900/40 via-teal-900/30 to-emerald-900/40 p-5 animate-fade-in">
              <div className="absolute top-0 right-0 w-60 h-60 bg-emerald-500/5 rounded-full -translate-y-1/2 translate-x-1/3" />
              <div className="absolute bottom-0 left-0 w-40 h-40 bg-teal-500/5 rounded-full translate-y-1/2 -translate-x-1/4" />
              <div className="relative">
                <div className="flex items-center gap-2 mb-3">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/20 border border-emerald-500/30 rounded-full">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-[10px] font-bold text-emerald-300 uppercase tracking-widest">Active Promotion</span>
                  </span>
                  <span className="ml-auto flex items-center gap-1.5 px-2.5 py-1 bg-white/5 border border-white/10 rounded-full">
                    <Clock size={12} className="text-amber-400" />
                    <span className="text-xs font-mono font-bold text-amber-300">{promoCountdown}</span>
                  </span>
                </div>
                <h3 className="text-lg font-bold text-white mb-2">{activePromotion.title}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex items-start gap-2.5 bg-white/5 rounded-lg p-3 border border-white/5">
                    <Target size={16} className="text-emerald-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[10px] font-semibold text-emerald-300 uppercase tracking-wide mb-0.5">Goal</p>
                      <p className="text-sm text-slate-200">{activePromotion.goal}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5 bg-white/5 rounded-lg p-3 border border-white/5">
                    <Gift size={16} className="text-amber-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[10px] font-semibold text-amber-300 uppercase tracking-wide mb-0.5">Incentive</p>
                      <p className="text-sm text-slate-200">{activePromotion.incentive}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Submit CTA (only for agents, not admins) */}
          {isAuthenticated && agent && (
            <Link to="/submit" className="block mt-4 group">
              <div className="relative overflow-hidden rounded-xl border border-gold/30 bg-gradient-to-r from-navy-light to-navy p-4 transition-all duration-300 hover:border-gold/60 hover:shadow-lg hover:shadow-gold/10 hover:scale-[1.01]">
                <div className="absolute top-0 right-0 w-40 h-40 bg-gold/5 rounded-full -translate-y-1/2 translate-x-1/2 group-hover:bg-gold/10 transition-colors" />
                <div className="flex items-center justify-between gap-4 relative">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gold/10 flex items-center justify-center group-hover:bg-gold/20 group-hover:scale-110 transition-all duration-300">
                      <FileText className="text-gold" size={20} />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">Submit New Enrollment</h3>
                      <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1">
                        <Zap size={9} className="text-emerald-400" />
                        Earn XP and climb the ranks
                      </p>
                    </div>
                  </div>
                  <div className="hidden sm:block btn-primary text-sm px-5 py-2 shadow-lg shadow-gold/20">
                    Submit Now
                  </div>
                </div>
              </div>
            </Link>
          )}
        </div>
      </section>

      {/* Main Content */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-32 lg:pb-12">
        {/* Player HUD */}
        {isAuthenticated && agent && !loading && (
          <div className="mt-4">
            <PlayerHUD agent={agent} entry={currentAgentEntry} />
          </div>
        )}

        {/* Agency Mission Tracker */}
        <div className="mt-5">
          <AgencyGoalTracker dailyEntries={dailyEntries} loading={loading} />
        </div>

        {/* KPI Cards */}
        <div className="mt-5">
          <KpiSummary
            dailyEntries={dailyEntries}
            weeklyEntries={weeklyEntries}
            monthlyEntries={monthlyEntries}
            yearlyEntries={yearlyEntries}
            loading={loading}
          />
        </div>

        {/* Active Battles */}
        {!loading && (activeData.battles || []).length > 0 && (
          <div className="mt-5">
            <ActiveBattles entries={activeData.entries} battles={activeData.battles} />
          </div>
        )}

        {/* Race to the Top */}
        {!loading && dailyEntries.length > 0 && (
          <div className="mt-5">
            <RaceTracker
              entries={dailyEntries}
              dailyGoal={5}
              currentAgentId={agent?.id}
            />
          </div>
        )}

        {/* Quest Board */}
        <div className="mt-6 space-y-4">
          {isAuthenticated && personalChallenges.length > 0 && (
            <ChallengesPanel
              challenges={personalChallenges.map((c) => ({
                ...c,
                teamProgress: c.agentProgress,
              }))}
              title="Your Quests"
              variant="personal"
            />
          )}
          <ChallengesPanel challenges={challenges} title="Agency Quest Board" variant="agency" />
        </div>

        {/* Trophy Case */}
        {isAuthenticated && !loading && badges.length > 0 && (
          <div className="mt-5">
            <TrophyCase
              earnedBadges={currentAgentEntry?.badges || []}
              allBadges={badges}
            />
          </div>
        )}

        {/* HIGH SCORES */}
        <div className="mt-8">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-3">
            <div>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-gold/10 flex items-center justify-center border border-gold/20">
                  <Trophy size={18} className="text-gold" />
                </div>
                <div>
                  <h2 className="text-xl sm:text-2xl font-black text-white uppercase tracking-wide">
                    {boardTitle}
                  </h2>
                  <p className="text-[10px] text-slate-400 uppercase tracking-widest font-medium mt-0.5">
                    {apPeriod === "daily" ? "Today" : apPeriod === "weekly" ? "This Week" : "This Month"}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              {countdown && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-navy-dark/80 border border-slate-700/50">
                  <Clock size={12} className="text-slate-500" />
                  <div className="flex flex-col">
                    <span className="text-[8px] text-slate-500 uppercase tracking-wider font-medium">Next Round</span>
                    <span className="text-sm font-black text-gold digital-clock animate-neon-flicker">
                      {countdown}
                    </span>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-1 px-1 py-1 rounded-lg bg-navy-light/60 border border-slate-700/40">
                {(["daily", "weekly", "monthly"] as APPeriod[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setApPeriod(p)}
                    className={`px-3 py-1.5 rounded-md text-[10px] font-semibold uppercase tracking-wide transition-all duration-200 ${
                      apPeriod === p
                        ? "bg-gold text-navy-dark shadow-sm shadow-gold/20"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {p === "daily" ? "Day" : p === "weekly" ? "Week" : "Month"}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1 px-1 py-1 rounded-lg bg-navy-light/60 border border-slate-700/40">
                <Filter size={11} className="text-slate-500 ml-1.5" />
                {(["all", "10", "15"] as ClubFilter[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setClubFilter(f)}
                    className={`px-2 py-1.5 rounded-md text-[10px] font-semibold transition-all duration-200 ${
                      clubFilter === f
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {f === "all" ? "All" : `${f}+ Club`}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-navy-light/50 border border-slate-700/30">
                <span className={`text-[10px] font-semibold transition-colors ${!showCommission ? "text-white" : "text-slate-500"}`}>
                  Policies
                </span>
                <button
                  onClick={() => setShowCommission(!showCommission)}
                  className={`relative w-9 h-5 rounded-full transition-colors duration-200 ${
                    showCommission ? "bg-gold" : "bg-slate-600"
                  }`}
                >
                  <div
                    className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-md transition-transform duration-200 ${
                      showCommission ? "translate-x-4" : ""
                    }`}
                  />
                </button>
                <span className={`text-[10px] font-semibold transition-colors ${showCommission ? "text-gold" : "text-slate-500"}`}>
                  AP
                </span>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center h-48 gap-4">
              <div className="w-64 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-gold/80 to-gold rounded-full animate-[indeterminate_1.5s_ease-in-out_infinite]" />
              </div>
              <span className="text-xs text-slate-500">Loading leaderboard data...</span>
            </div>
          ) : (
            <LeaderboardTable
              entries={filteredEntries}
              battles={activeData.battles}
              showCommission={showCommission}
              badges={badges}
              currentAgentId={agent?.id}
            />
          )}
        </div>

        {/* Incentives */}
        {!loading && incentives.length > 0 && (
          <div className="mt-8">
            <IncentivesPanel incentives={incentives} standings={incentiveStandings} />
          </div>
        )}

        {/* Compact views for non-active periods */}
        <div className="mt-10 grid md:grid-cols-2 gap-5">
          {loading ? (
            <>
              <div className="card-navy p-8 flex items-center justify-center">
                <Loader2 className="animate-spin text-slate-600" size={24} />
              </div>
              <div className="card-navy p-8 flex items-center justify-center">
                <Loader2 className="animate-spin text-slate-600" size={24} />
              </div>
            </>
          ) : (
            <>
              {apPeriod !== "weekly" && (
                <CompactLeaderboard
                  entries={weeklyEntries}
                  title="This Week"
                  subtitle={weeklyData?.periodKey}
                  icon="flame"
                  currentAgentId={agent?.id}
                />
              )}
              {apPeriod !== "monthly" && (
                <CompactLeaderboard
                  entries={monthlyEntries}
                  title="This Month"
                  subtitle={monthlyData?.periodKey}
                  icon="trophy"
                  currentAgentId={agent?.id}
                />
              )}
              {apPeriod !== "daily" && (
                <CompactLeaderboard
                  entries={dailyEntries}
                  title="Today"
                  subtitle={dailyData?.periodKey}
                  icon="flame"
                  currentAgentId={agent?.id}
                />
              )}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
