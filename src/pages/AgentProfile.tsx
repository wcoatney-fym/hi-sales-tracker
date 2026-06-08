import { useState, useEffect, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  LogOut,
  Loader2,
  LayoutDashboard,
  BookOpen,
  Award,
  Send,
} from "lucide-react";
import { useAgentAuth } from "../hooks/useAgentAuth";
import { getAgentStats, getLeadFormConfig } from "../lib/api";
import { TIER_CONFIG } from "../types/leaderboard";
import AgentDashboardTab from "../components/agent/AgentDashboardTab";
import AgentBookTab from "../components/agent/AgentBookTab";
import AgentAchievementsTab from "../components/agent/AgentAchievementsTab";

interface AgentProfileData {
  xp: number;
  level: number;
  tier: string;
  current_streak: number;
  longest_streak: number;
  total_policies_all_time: number;
}

type Tab = "dashboard" | "book" | "achievements";

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "book", label: "My Book", icon: BookOpen },
  { key: "achievements", label: "Achievements", icon: Award },
];

export default function AgentProfile() {
  const navigate = useNavigate();
  const { agent, isAuthenticated, loading: authLoading, logout } = useAgentAuth();
  const [profile, setProfile] = useState<AgentProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [showLeadForm, setShowLeadForm] = useState(false);

  const fetchProfile = useCallback(async () => {
    if (!agent) return;
    setLoading(true);
    try {
      const statsData = await getAgentStats(agent.id);
      setProfile(statsData.profile);

      // Check if lead form is available for FYM agents
      if (!agent.agencySlug || agent.agencySlug === "fym") {
        try {
          const config = await getLeadFormConfig();
          setShowLeadForm(config.enabled);
        } catch { /* ignore */ }
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [agent]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate("/agent");
      return;
    }
    if (agent) fetchProfile();
  }, [agent, authLoading, isAuthenticated, navigate, fetchProfile]);

  if (authLoading || loading) {
    return (
      <main className="min-h-screen bg-navy-dark flex items-center justify-center">
        <Loader2 className="animate-spin text-gold" size={32} />
      </main>
    );
  }

  if (!agent || !profile) return null;

  const tierConf = TIER_CONFIG[profile.tier] || TIER_CONFIG.Rookie;
  const sessionToken = localStorage.getItem("agent_session_token") || "";

  const handleLogout = async () => {
    await logout();
    navigate("/agent");
  };

  const xpForNextLevel = profile.level * 500;
  const xpProgress = Math.min(100, (profile.xp % 500) / 5);

  return (
    <main className="min-h-screen bg-navy-dark pb-24 lg:pb-8">
      {/* Compact Profile Header */}
      <header className="sticky top-0 z-30 bg-navy-dark/95 backdrop-blur-md border-b border-slate-700/40">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full ring-2 ${tierConf.ringClass} flex items-center justify-center bg-navy-light`}>
                <span className={`text-sm font-bold ${tierConf.textClass}`}>
                  {agent.firstName[0]}{agent.lastName[0]}
                </span>
              </div>
              <div>
                <h1 className="text-sm font-bold text-white leading-tight">
                  {agent.firstName} {agent.lastName}
                </h1>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-semibold ${tierConf.textClass}`}>
                    {profile.tier}
                  </span>
                  <span className="text-slate-600 text-[10px]">|</span>
                  <span className="text-[10px] text-slate-400">
                    Lv {profile.level}
                  </span>
                  {agent.agencyName && (
                    <>
                      <span className="text-slate-600 text-[10px]">|</span>
                      <span className="text-[10px] text-slate-400">
                        {agent.agencyName}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>

          {/* XP Bar */}
          <div className="mt-2" data-tour="agent-xp-bar">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[10px] text-slate-500">Level {profile.level}</span>
              <span className="text-[10px] text-slate-500">{profile.xp} / {xpForNextLevel} XP</span>
            </div>
            <div className="h-1.5 bg-navy rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-gold-dark to-gold rounded-full transition-all duration-700"
                style={{ width: `${xpProgress}%` }}
              />
            </div>
          </div>

          {/* Desktop Tabs */}
          <nav className="hidden sm:flex gap-1 mt-3 -mb-3 border-b-0">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  data-tour={`agent-tab-${tab.key}`}
                  className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-t-lg transition-colors border-b-2 ${
                    activeTab === tab.key
                      ? "border-gold text-gold bg-navy-light/50"
                      : "border-transparent text-slate-400 hover:text-white"
                  }`}
                >
                  <Icon size={14} />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Tab Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-5">
        {showLeadForm && (
          <Link
            to="/lead-submit"
            className="flex items-center gap-2 mb-5 px-4 py-3 bg-blue-600/10 border border-blue-500/20 rounded-xl text-blue-400 hover:bg-blue-600/20 transition-all group"
          >
            <Send size={16} className="text-blue-400 group-hover:text-blue-300" />
            <span className="text-sm font-medium">Submit a Lead</span>
            <span className="ml-auto text-xs text-blue-500/60">New client lead form</span>
          </Link>
        )}
        {activeTab === "dashboard" && (
          <AgentDashboardTab
            sessionToken={sessionToken}
            profile={profile}
          />
        )}
        {activeTab === "book" && (
          <AgentBookTab sessionToken={sessionToken} />
        )}
        {activeTab === "achievements" && (
          <AgentAchievementsTab
            agentId={agent.id}
            profile={profile}
          />
        )}
      </div>

      {/* Mobile Bottom Tab Bar */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-navy border-t border-slate-700/50 px-2 pb-safe">
        <div className="flex justify-around">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex flex-col items-center gap-0.5 py-2.5 px-3 min-w-[56px] transition-colors ${
                  activeTab === tab.key ? "text-gold" : "text-slate-500"
                }`}
              >
                <Icon size={18} />
                <span className="text-[9px] font-medium">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </main>
  );
}
