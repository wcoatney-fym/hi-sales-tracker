import { useState, useEffect, useCallback } from "react";
import {
  Users,
  Database,
  Upload,
  Megaphone,
  ChevronRight,
  Coins,
  UserX,
  AlertTriangle,
  ClipboardCheck,
  FileText,
  KeyRound,
} from "lucide-react";
import AgentsTable from "../admin/AgentsTable";
import DataSourcesPanel from "../admin/DataSourcesPanel";
import CsvUploader from "../admin/CsvUploader";
import RosterHistory from "../admin/RosterHistory";
import PromotionsPanel from "../admin/PromotionsPanel";
import TokensPanel from "../admin/TokensPanel";
import UnassignedAgentsPanel from "../admin/UnassignedAgentsPanel";
import FuzzyMatchPanel from "../admin/FuzzyMatchPanel";
import AuditPanel from "../admin/AuditPanel";
import IntakeSubmissionsPanel from "../admin/IntakeSubmissionsPanel";
import AgencyCredentialsPanel from "../admin/AgencyCredentialsPanel";
import {
  adminGetRosterStatus,
  adminGetRosterUploads,
} from "../../lib/api";
import type { RosterStatus, RosterUpload } from "../../types";

type SettingsSection = "agents" | "sources" | "rosters" | "promotions" | "tokens" | "unassigned" | "fuzzy" | "audit" | "intake" | "credentials";

const SECTIONS: { key: SettingsSection; label: string; icon: React.ElementType; description: string }[] = [
  { key: "agents", label: "Agent Directory", icon: Users, description: "Manage agents, fix names, sync rosters" },
  { key: "sources", label: "Data Sources", icon: Database, description: "Configure external data integrations" },
  { key: "rosters", label: "Rosters", icon: Upload, description: "UNL and GTL roster management" },
  { key: "unassigned", label: "Unassigned Agents", icon: UserX, description: "Agents not in any agency roster" },
  { key: "fuzzy", label: "Pending Approvals", icon: AlertTriangle, description: "Fuzzy roster matches awaiting review" },
  { key: "promotions", label: "Promotions & Incentives", icon: Megaphone, description: "Manage token goal campaigns and rewards by period" },
  { key: "tokens", label: "Agent Tokens", icon: Coins, description: "Manage talk time and token balances" },
  { key: "audit", label: "Data Audit", icon: ClipboardCheck, description: "Review and resolve duplicate agents and data conflicts" },
  { key: "intake", label: "Intake Submissions", icon: FileText, description: "Full history of intake form submissions for auditing" },
  { key: "credentials", label: "Agency Access", icon: KeyRound, description: "View and manage agency portal login credentials" },
];

interface SettingsPanelProps {
  token: string;
}

export default function SettingsPanel({ token }: SettingsPanelProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection | null>(null);
  const [rosterStatus, setRosterStatus] = useState<RosterStatus>({ unl: { count: 0 }, gtl: { count: 0 } });
  const [rosterUploads, setRosterUploads] = useState<RosterUpload[]>([]);

  const fetchRosterData = useCallback(async () => {
    if (!token) return;
    try {
      const [statusResult, uploadsResult] = await Promise.all([
        adminGetRosterStatus(token),
        adminGetRosterUploads(token),
      ]);
      setRosterStatus(statusResult);
      setRosterUploads(uploadsResult.uploads || []);
    } catch { /* ignore */ }
  }, [token]);

  useEffect(() => {
    if (activeSection === "rosters") fetchRosterData();
  }, [activeSection, fetchRosterData]);

  if (!activeSection) {
    return (
      <div className="animate-fade-in">
        <div className="mb-6">
          <h2 className="text-lg font-bold text-white">Settings</h2>
          <p className="text-sm text-slate-400 mt-1">Manage operational tools and configurations</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <button
                key={section.key}
                onClick={() => setActiveSection(section.key)}
                className="bg-navy rounded-xl border border-slate-700/50 p-5 text-left hover:border-gold/30 transition-all group"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 rounded-lg bg-gold/10 flex items-center justify-center group-hover:bg-gold/20 transition-colors">
                    <Icon size={18} className="text-gold" />
                  </div>
                  <ChevronRight size={16} className="text-slate-500 group-hover:text-gold transition-colors" />
                </div>
                <h3 className="text-sm font-semibold text-white mb-1">{section.label}</h3>
                <p className="text-xs text-slate-400">{section.description}</p>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const currentSection = SECTIONS.find((s) => s.key === activeSection)!;

  return (
    <div className="animate-fade-in">
      <div className="flex items-center gap-2 mb-6">
        <button
          onClick={() => setActiveSection(null)}
          className="text-sm text-slate-400 hover:text-gold transition-colors font-medium"
        >
          Settings
        </button>
        <ChevronRight size={14} className="text-slate-500" />
        <span className="text-sm font-semibold text-white">{currentSection.label}</span>
      </div>

      {activeSection === "agents" && <AgentsTable token={token} />}
      {activeSection === "sources" && <DataSourcesPanel token={token} />}
      {activeSection === "rosters" && (
        <div className="space-y-8">
          <div className="grid md:grid-cols-2 gap-6">
            <CsvUploader carrier="UNL" token={token} agentCount={rosterStatus.unl?.count || 0} onUploadSuccess={fetchRosterData} />
            <CsvUploader carrier="GTL" token={token} agentCount={rosterStatus.gtl?.count || 0} onUploadSuccess={fetchRosterData} />
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            <RosterHistory carrier="UNL" uploads={rosterUploads} token={token} onUpdate={fetchRosterData} />
            <RosterHistory carrier="GTL" uploads={rosterUploads} token={token} onUpdate={fetchRosterData} />
          </div>
        </div>
      )}
      {activeSection === "promotions" && <PromotionsPanel token={token} />}
      {activeSection === "tokens" && <TokensPanel token={token} />}
      {activeSection === "unassigned" && <UnassignedAgentsPanel token={token} />}
      {activeSection === "fuzzy" && <FuzzyMatchPanel token={token} />}
      {activeSection === "audit" && <AuditPanel token={token} />}
      {activeSection === "intake" && <IntakeSubmissionsPanel token={token} />}
      {activeSection === "credentials" && <AgencyCredentialsPanel token={token} />}
    </div>
  );
}
