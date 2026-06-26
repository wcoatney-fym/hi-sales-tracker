import { useState, useMemo, useEffect, useRef } from "react";
import { Navigate, useNavigate, useParams, useLocation } from "react-router-dom";
import {
  LogOut,
  LayoutDashboard,
  FileSpreadsheet,
  Settings,
  Home,
  AlertTriangle,
  Loader2,
  Trophy,
  ClipboardList,
  ArrowLeft,
  Eye,
} from "lucide-react";
import { useAdminAuth } from "../hooks/useAdminAuth";
import DateRangeSelector from "../components/dashboard/DateRangeSelector";
import PoliciesTable from "../components/dashboard/PoliciesTable";
import AdminLeaderboardTab from "../components/admin/AdminLeaderboardTab";
import OverviewTab from "../components/production/OverviewTab";
import InternalTab from "../components/production/InternalTab";
import SettingsPanel from "../components/production/SettingsPanel";
import AtRiskTab from "../components/production/AtRiskTab";
import AgencyRosterPanel from "../components/admin/AgencyRosterPanel";
import AgencyManagersPanel from "../components/admin/AgencyManagersPanel";
import type { DateRange, DatePreset } from "../types/dashboard";
import { getDateRange } from "../lib/dateUtils";
import { adminResolveAgencySlug } from "../lib/api";

type Tab = "overview" | "internal" | "at-risk" | "policies" | "leaderboard" | "settings" | "roster" | "managers";

export default function AdminDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { agencySlug } = useParams<{ agencySlug?: string }>();
  const { token, email, isAuthenticated, isGlobalAdmin, agencyId: adminAgencyId, agencySlug: adminAgencySlug, agencyName, verifying, logout } = useAdminAuth();

  // Resolve agency context from navigation state or API
  const navState = location.state as { agencyName?: string; agencyId?: string } | null;
  const [resolvedAgencyName, setResolvedAgencyName] = useState<string | null>(navState?.agencyName || null);
  const [resolvedAgencyId, setResolvedAgencyId] = useState<string | null>(navState?.agencyId || null);
  // FYM's own agency id, resolved for the global-admin (FYM) standard Roster tab.
  const [fymAgencyId, setFymAgencyId] = useState<string | null>(null);

  const isAgencyView = !!agencySlug;
  const isImpersonating = isAgencyView && isGlobalAdmin;
  const tabStripRef = useRef<HTMLDivElement>(null);

  // Scroll to top whenever the impersonation context changes so the
  // "Viewing as" banner is actually in view after tapping View As on mobile.
  useEffect(() => {
    if (isImpersonating) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [isImpersonating, agencySlug]);

  // Global (FYM) admin: resolve FYM's own agency id so the standard Roster tab
  // can scope to it, mirroring what an agency admin (e.g. Wisechoice) sees.
  useEffect(() => {
    if (token && isGlobalAdmin && !isAgencyView && !fymAgencyId) {
      adminResolveAgencySlug(token, "fym")
        .then((a) => setFymAgencyId(a.id))
        .catch(() => {});
    }
  }, [token, isGlobalAdmin, isAgencyView, fymAgencyId]);

  // Entering an agency view should land on Overview so the admin immediately
  // sees the agency's data, not whatever tab (e.g. Settings) they came from.
  // The component doesn't remount on FYM -> agency (same route, param change),
  // so reset the active tab explicitly and scroll the (horizontally scrollable)
  // tab strip fully left so the highlighted Overview tab is in view on mobile.
  useEffect(() => {
    if (isAgencyView) {
      setActiveTab("overview");
      tabStripRef.current?.scrollTo({ left: 0, behavior: "smooth" });
    }
  }, [isAgencyView, agencySlug]);

  useEffect(() => {
    if (!agencySlug) {
      setResolvedAgencyName(null);
      setResolvedAgencyId(null);
      return;
    }
    if (!isGlobalAdmin) {
      setResolvedAgencyName(agencyName || null);
      setResolvedAgencyId(adminAgencyId || null);
      return;
    }
    if (navState?.agencyName && navState?.agencyId) {
      setResolvedAgencyName(navState.agencyName);
      setResolvedAgencyId(navState.agencyId);
      return;
    }
    if (token) {
      adminResolveAgencySlug(token, agencySlug).then((res) => {
        setResolvedAgencyName(res.name || null);
        setResolvedAgencyId(res.id || null);
      }).catch(() => {});
    }
  }, [agencySlug, isGlobalAdmin, token, agencyName, adminAgencyId, navState?.agencyName, navState?.agencyId]);

  const [activeTab, setActiveTab] = useState<Tab>(isAgencyView ? "overview" : (isGlobalAdmin ? "internal" : "overview"));
  const [dateRange, setDateRange] = useState<DateRange>(getDateRange("thisMonth"));
  const [datePreset, setDatePreset] = useState<DatePreset>("thisMonth");

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = useMemo(() => {
    const allTabs: { key: Tab; label: string; icon: React.ElementType; globalOnly?: boolean; fymOnly?: boolean; agencyOnly?: boolean }[] = [
      { key: "overview", label: "Overview", icon: LayoutDashboard },
      { key: "internal", label: "Internal", icon: Home, fymOnly: true },
      { key: "at-risk", label: "At Risk", icon: AlertTriangle },
      { key: "policies", label: "Policies", icon: FileSpreadsheet },
      { key: "leaderboard", label: "Leaderboard", icon: Trophy },
      { key: "roster", label: "Roster", icon: ClipboardList },
      { key: "managers", label: "Managers", icon: ShieldCheck },
      { key: "settings", label: "Settings", icon: Settings, globalOnly: true },
    ];

    return allTabs.filter((tab) => {
      if (tab.globalOnly && (!isGlobalAdmin || isAgencyView)) return false;
      if (tab.fymOnly && isAgencyView) return false;
      if (tab.agencyOnly && !isAgencyView) return false;
      return true;
    });
  }, [agencySlug, isGlobalAdmin, isAgencyView]);

  if (verifying) {
    return (
      <main className="max-w-7xl mx-auto px-4 py-20 flex items-center justify-center">
        <Loader2 className="animate-spin text-gold" size={32} />
      </main>
    );
  }

  if (!isAuthenticated || !token) {
    return <Navigate to="/admin" replace />;
  }

  // Agency admin trying to access a different agency's dashboard
  if (agencySlug && !isGlobalAdmin) {
    const storedSlug = localStorage.getItem("admin_agency_slug");
    if (storedSlug && storedSlug !== agencySlug) {
      return <Navigate to={`/admin/dashboard/${storedSlug}`} replace />;
    }
  }

  const handleLogout = async () => {
    await logout();
    navigate("/admin", { replace: true });
  };

  const handleDateChange = (range: DateRange, preset: DatePreset) => {
    setDateRange(range);
    setDatePreset(preset);
  };

  const handleNavigatePolicies = () => {
    setActiveTab("policies");
  };

  const showDateRange = activeTab === "overview" || activeTab === "internal";

  // Effective agency info for filtering (works for both impersonation and native agency admin)
  const effectiveAgencyName = isAgencyView ? (resolvedAgencyName || agencyName || null) : null;
  const effectiveAgencyId = isAgencyView ? (resolvedAgencyId || adminAgencyId || null) : null;

  const dashboardTitle = agencySlug
    ? `${resolvedAgencyName || agencyName || agencySlug.charAt(0).toUpperCase() + agencySlug.slice(1)} Dashboard`
    : "Activity Tracker";

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 pb-24 lg:pb-6 text-white">
      {isImpersonating && (
        <div className="sticky top-16 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 mb-4 flex items-center gap-3 bg-gold/15 border-y border-gold/40 py-3 backdrop-blur-sm animate-fade-in shadow-sm">
          <Eye size={16} className="text-gold flex-shrink-0" />
          <p className="text-sm text-gold font-medium flex-1 min-w-0 truncate">
            Viewing as {resolvedAgencyName || agencySlug}
          </p>
          <button
            onClick={() => navigate("/admin/dashboard")}
            className="flex items-center gap-1.5 text-xs font-medium text-white bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded-md transition-colors"
          >
            <ArrowLeft size={13} />
            Back to FYM
          </button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-white truncate">{dashboardTitle}</h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-0.5 truncate">Signed in as {email}</p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          {showDateRange && (
            <DateRangeSelector
              value={dateRange}
              preset={datePreset}
              onChange={handleDateChange}
            />
          )}
          <button
            onClick={handleLogout}
            className="btn-secondary flex items-center gap-2 text-sm !px-3 sm:!px-6"
          >
            <LogOut size={16} />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </div>

      <div className="relative mb-4 sm:mb-6">
        <div ref={tabStripRef} className="flex gap-1 bg-navy p-1 rounded-lg w-full sm:w-fit border border-slate-700/50 overflow-x-auto scrollbar-hide snap-x snap-mandatory">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                data-tour={`admin-tab-${tab.key}`}
                className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap snap-start min-h-[44px] ${
                  activeTab === tab.key
                    ? "bg-navy-light text-gold shadow-sm border border-gold/20"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Icon size={16} />
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden text-xs">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === "overview" && (
        <OverviewTab
          token={token}
          dateRange={dateRange}
          lockedAgency={effectiveAgencyName || undefined}
          onNavigatePolicies={handleNavigatePolicies}
        />
      )}

      {activeTab === "internal" && (
        <InternalTab
          token={token}
          dateRange={dateRange}
          onNavigatePolicies={handleNavigatePolicies}
        />
      )}

      {activeTab === "at-risk" && (
        <AtRiskTab token={token} lockedAgency={effectiveAgencyName || undefined} />
      )}

      {activeTab === "policies" && (
        <div className="animate-fade-in">
          <PoliciesTable token={token} lockedAgency={effectiveAgencyName || undefined} />
        </div>
      )}

      {activeTab === "leaderboard" && (
        <AdminLeaderboardTab
          agencyId={effectiveAgencyId}
          agencyName={effectiveAgencyName || agencyName}
          isFymAdmin={!isAgencyView && (isGlobalAdmin || adminAgencySlug === "fym")}
        />
      )}

      {activeTab === "roster" && (
        <div className="animate-fade-in">
          <AgencyRosterPanel token={token} overrideAgencyId={isImpersonating ? resolvedAgencyId : (isGlobalAdmin && !isAgencyView ? fymAgencyId : undefined)} />
        </div>
      )}

      {activeTab === "managers" && (
        <div className="animate-fade-in">
          <AgencyManagersPanel
            token={token}
            scopeAgencyId={isAgencyView ? effectiveAgencyId : undefined}
          />
        </div>
      )}

      {activeTab === "settings" && (
        <SettingsPanel token={token} />
      )}
    </main>
  );
}
