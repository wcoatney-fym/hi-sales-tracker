import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { LogOut, ShieldCheck, Gauge, AlertTriangle, Users } from "lucide-react";
import { useManagerAuth } from "../hooks/useManagerAuth";
import ManagerRetentionPanel from "../components/manager/ManagerRetentionPanel";
import ManagerWorklistPanel from "../components/manager/ManagerWorklistPanel";
import ManagerProductionPanel from "../components/manager/ManagerProductionPanel";

type Tab = "retention" | "worklist" | "production";

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: "retention", label: "Retention", icon: Gauge },
  { key: "worklist", label: "At-Risk Worklist", icon: AlertTriangle },
  { key: "production", label: "Production", icon: Users },
];

export default function ManagerView() {
  const navigate = useNavigate();
  const { manager, token, isAuthenticated, logout } = useManagerAuth();
  const [activeTab, setActiveTab] = useState<Tab>("worklist");

  if (!isAuthenticated || !manager || !token) {
    return <Navigate to="/manager/login" replace />;
  }

  const handleLogout = () => {
    logout();
    navigate("/manager/login", { replace: true });
  };

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 pb-24 lg:pb-6 text-white">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-gold/10 flex items-center justify-center shrink-0">
            <ShieldCheck size={20} className="text-gold" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-white truncate">
              {manager.agencyName} - Manager
            </h1>
            <p className="text-xs text-slate-400 truncate">Signed in as {manager.displayName}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="btn-secondary flex items-center gap-2 text-sm !px-3 sm:!px-5"
        >
          <LogOut size={16} />
          <span className="hidden sm:inline">Sign Out</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-navy p-1 rounded-lg w-full sm:w-fit border border-slate-700/50 overflow-x-auto scrollbar-hide mb-5">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap min-h-[44px] ${
                activeTab === tab.key
                  ? "bg-navy-light text-gold shadow-sm border border-gold/20"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "retention" && (
        <ManagerRetentionPanel agencyId={manager.agencyId} agencyName={manager.agencyName} />
      )}
      {activeTab === "worklist" && <ManagerWorklistPanel token={token} />}
      {activeTab === "production" && (
        <ManagerProductionPanel token={token} agencyName={manager.agencyName} />
      )}
    </main>
  );
}
