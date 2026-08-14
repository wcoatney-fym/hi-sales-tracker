import { useState, useEffect, useCallback } from "react";
import {
  Building2,
  Users,
  ChevronRight,
  Check,
  X,
  Link2,
  Unlink,
  Loader2,
  RefreshCw,
  Lock,
  Search,
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
} from "lucide-react";
import {
  adminListCarrierAgencyMappings,
  adminUpsertCarrierAgencyMapping,
  adminConfirmCarrierAgencyMapping,
  adminDeleteCarrierAgencyMapping,
  adminListCarrierAgentMappings,
  adminFetchCarrierAgentsFromProd,
  adminSearchPortalAgencies,
  type CarrierAgencyMapping,
  type CarrierAgentMapping,
  type CarrierProdAgent,
  type PortalAgencySearchResult,
} from "../../lib/api";

const CARRIERS = ["AHL", "GTL", "Manhattan", "Heartland"] as const;
type CarrierFilter = typeof CARRIERS[number] | "all";

interface CarrierMappingPanelProps {
  token: string;
}

export default function CarrierMappingPanel({ token }: CarrierMappingPanelProps) {
  const [carrier, setCarrier] = useState<CarrierFilter>("all");
  const [mappings, setMappings] = useState<CarrierAgencyMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showUnmatchedOnly, setShowUnmatchedOnly] = useState(false);
  const [showConfirmedOnly, setShowConfirmedOnly] = useState(false);

  // Agent drill-down state
  const [selectedAgency, setSelectedAgency] = useState<CarrierAgencyMapping | null>(null);
  const [agentMappings, setAgentMappings] = useState<CarrierAgentMapping[]>([]);
  const [prodAgents, setProdAgents] = useState<CarrierProdAgent[]>([]);
  const [agentLoading, setAgentLoading] = useState(false);


  // Manual match state
  const [matchingId, setMatchingId] = useState<string | null>(null);
  const [portalSearch, setPortalSearch] = useState("");
  const [portalResults, setPortalResults] = useState<PortalAgencySearchResult[]>([]);
  const [portalSearching, setPortalSearching] = useState(false);

  // Stats
  const [stats, setStats] = useState({ total: 0, matched: 0, confirmed: 0, totalPolicies: 0, matchedPolicies: 0 });

  const fetchMappings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminListCarrierAgencyMappings(token, carrier === "all" ? undefined : carrier);
      setMappings(res.mappings);
      // Compute stats
      const total = res.mappings.length;
      const matched = res.mappings.filter((m) => m.portal_agency_id).length;
      const confirmed = res.mappings.filter((m) => m.is_confirmed).length;
      const totalPolicies = res.mappings.reduce((s, m) => s + (m.policy_count || 0), 0);
      const matchedPolicies = res.mappings.filter((m) => m.portal_agency_id).reduce((s, m) => s + (m.policy_count || 0), 0);
      setStats({ total, matched, confirmed, totalPolicies, matchedPolicies });
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [token, carrier]);

  useEffect(() => {
    fetchMappings();
  }, [fetchMappings]);

  const handleConfirm = async (id: string) => {
    try {
      await adminConfirmCarrierAgencyMapping(token, id, "admin");
      fetchMappings();
    } catch {
      /* ignore */
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this mapping?")) return;
    try {
      await adminDeleteCarrierAgencyMapping(token, id);
      fetchMappings();
    } catch {
      /* ignore */
    }
  };

  const handleUnlink = async (mapping: CarrierAgencyMapping) => {
    try {
      await adminUpsertCarrierAgencyMapping(token, {
        ...mapping,
        portal_agency_id: undefined,
        portal_agency_name: undefined,
        unl_writing_number: undefined,
        match_method: "manual",
        match_confidence: undefined,
        is_confirmed: false,
      });
      fetchMappings();
    } catch {
      /* ignore */
    }
  };

  // Manual match: search Portal agencies
  const handlePortalSearch = async (query: string) => {
    setPortalSearch(query);
    if (query.length < 2) { setPortalResults([]); return; }
    setPortalSearching(true);
    try {
      const res = await adminSearchPortalAgencies(token, query);
      setPortalResults(res.agencies);
    } catch {
      setPortalResults([]);
    } finally {
      setPortalSearching(false);
    }
  };

  const handleManualMatch = async (mapping: CarrierAgencyMapping, portal: PortalAgencySearchResult) => {
    try {
      await adminUpsertCarrierAgencyMapping(token, {
        ...mapping,
        portal_agency_id: portal.id,
        portal_agency_name: portal.name,
        unl_writing_number: portal.unl_writing_number || undefined,
        match_method: "manual",
        match_confidence: 1.0,
        is_confirmed: false,
      });
      setMatchingId(null);
      setPortalSearch("");
      setPortalResults([]);
      fetchMappings();
    } catch {
      /* ignore */
    }
  };


  // Agent drill-down
  const openAgencyDrillDown = async (mapping: CarrierAgencyMapping) => {
    setSelectedAgency(mapping);
    setAgentLoading(true);
    try {
      const [agentRes, prodRes] = await Promise.all([
        adminListCarrierAgentMappings(token, mapping.carrier, mapping.id),
        mapping.carrier_agency_code
          ? adminFetchCarrierAgentsFromProd(token, mapping.carrier, mapping.carrier_agency_code)
          : Promise.resolve({ carrier: mapping.carrier, agency_code: "", agents: [] }),
      ]);
      setAgentMappings(agentRes.mappings);
      setProdAgents(prodRes.agents);
    } catch {
      /* ignore */
    } finally {
      setAgentLoading(false);
    }
  };

  const filteredMappings = mappings.filter((m) => {
    if (search) {
      const q = search.toLowerCase();
      if (
        !m.carrier_agency_name.toLowerCase().includes(q) &&
        !(m.portal_agency_name || "").toLowerCase().includes(q) &&
        !(m.carrier_agency_code || "").toLowerCase().includes(q) &&
        !(m.unl_writing_number || "").toLowerCase().includes(q)
      )
        return false;
    }
    if (showUnmatchedOnly && m.portal_agency_id) return false;
    if (showConfirmedOnly && !m.is_confirmed) return false;
    return true;
  });

  // Group by carrier for display
  const groupedByCarrier = filteredMappings.reduce<Record<string, CarrierAgencyMapping[]>>((acc, m) => {
    (acc[m.carrier] ??= []).push(m);
    return acc;
  }, {});

  // ---- Agent drill-down view ----
  if (selectedAgency) {
    return (
      <div className="space-y-4">
        {/* Back button */}
        <button
          onClick={() => {
            setSelectedAgency(null);
            setAgentMappings([]);
            setProdAgents([]);
          }}
          className="flex items-center gap-2 text-sm text-gold hover:text-gold-light transition-colors"
        >
          <ArrowLeft size={16} />
          Back to Agency Mappings
        </button>

        {/* Agency header */}
        <div className="bg-navy rounded-xl border border-slate-700/50 p-4">
          <div className="flex items-center gap-3 mb-2">
            <Building2 size={20} className="text-gold" />
            <h3 className="text-lg font-semibold text-white">{selectedAgency.carrier_agency_name}</h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-900/50 text-blue-300 border border-blue-700/30">
              {selectedAgency.carrier}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-slate-400">
            <div>
              <span className="text-slate-500">Portal Match:</span>{" "}
              <span className="text-white">{selectedAgency.portal_agency_name || "—"}</span>
            </div>
            <div>
              <span className="text-slate-500">UNL WN:</span>{" "}
              <span className="text-white">{selectedAgency.unl_writing_number || "—"}</span>
            </div>
            <div>
              <span className="text-slate-500">Carrier Code:</span>{" "}
              <span className="text-white">{selectedAgency.carrier_agency_code || "—"}</span>
            </div>
            <div>
              <span className="text-slate-500">Policies:</span>{" "}
              <span className="text-white">{selectedAgency.policy_count.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Agent list */}
        <div className="bg-navy rounded-xl border border-slate-700/50 overflow-hidden">
          <div className="p-4 border-b border-slate-700/50">
            <h4 className="text-sm font-semibold text-white flex items-center gap-2">
              <Users size={16} className="text-slate-400" />
              Agents ({agentLoading ? "..." : prodAgents.length} from production
              {agentMappings.length > 0 && `, ${agentMappings.length} mapped`})
            </h4>
          </div>
          {agentLoading ? (
            <div className="p-8 text-center">
              <Loader2 className="animate-spin mx-auto text-gold" size={24} />
              <p className="text-sm text-slate-400 mt-2">Loading agents from production...</p>
            </div>
          ) : prodAgents.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              No agents found for this agency in production data.
            </div>
          ) : (
            <div className="divide-y divide-slate-700/30">
              {prodAgents.map((agent) => {
                const existingMapping = agentMappings.find(
                  (am) => am.carrier_agent_code === agent.code
                );
                return (
                  <div
                    key={agent.code}
                    className="px-4 py-3 flex items-center justify-between hover:bg-slate-800/30 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Users size={14} className="text-slate-500 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm text-white truncate">{agent.name}</p>
                        <p className="text-xs text-slate-500">{agent.code}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-xs text-slate-400">
                        {agent.policy_count} {agent.policy_count === 1 ? "policy" : "policies"}
                      </span>
                      {existingMapping?.is_confirmed ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/50 text-green-300 border border-green-700/30 flex items-center gap-1">
                          <Lock size={10} /> Confirmed
                        </span>
                      ) : existingMapping ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-900/50 text-yellow-300 border border-yellow-700/30">
                          Mapped
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-600/30">
                          New
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---- Main agency mapping view ----
  return (
    <div className="space-y-4">
      {/* Header + stats */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Link2 size={20} className="text-gold" />
            Carrier Agency Mapping
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Match agencies across carriers to Portal identities. Click an agency to see its agents.
          </p>
        </div>
        <button
          onClick={fetchMappings}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-navy-dark bg-gold rounded-lg hover:bg-gold-light disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: "Total Agencies", value: stats.total, icon: Building2 },
          {
            label: "Matched",
            value: `${stats.matched}/${stats.total}`,
            icon: Link2,
            color: stats.matched === stats.total ? "text-green-400" : "text-yellow-400",
          },
          { label: "Confirmed", value: stats.confirmed, icon: Lock, color: "text-green-400" },
          { label: "Total Policies", value: stats.totalPolicies.toLocaleString(), icon: Users },
          {
            label: "Policy Coverage",
            value: stats.totalPolicies > 0 ? `${Math.round((stats.matchedPolicies / stats.totalPolicies) * 100)}%` : "—",
            icon: CheckCircle2,
            color: stats.matchedPolicies / stats.totalPolicies > 0.9 ? "text-green-400" : "text-yellow-400",
          },
        ].map((stat) => (
          <div key={stat.label} className="bg-navy rounded-xl border border-slate-700/50 p-3">
            <div className="flex items-center gap-2 mb-1">
              <stat.icon size={14} className="text-slate-500" />
              <span className="text-xs text-slate-500">{stat.label}</span>
            </div>
            <p className={`text-lg font-semibold ${("color" in stat && stat.color) || "text-white"}`}>
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Carrier filter */}
        <div className="flex items-center gap-1 bg-navy rounded-lg border border-slate-700/50 p-1">
          {(["all", ...CARRIERS] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCarrier(c)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                carrier === c
                  ? "bg-gold text-navy-dark"
                  : "text-slate-400 hover:text-white hover:bg-slate-800/50"
              }`}
            >
              {c === "all" ? "All" : c}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agencies..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-navy border border-slate-700/50 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-gold/50"
          />
        </div>

        {/* Toggle filters */}
        <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
          <input
            type="checkbox"
            checked={showUnmatchedOnly}
            onChange={(e) => setShowUnmatchedOnly(e.target.checked)}
            className="rounded border-slate-600"
          />
          Unmatched only
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
          <input
            type="checkbox"
            checked={showConfirmedOnly}
            onChange={(e) => setShowConfirmedOnly(e.target.checked)}
            className="rounded border-slate-600"
          />
          Confirmed only
        </label>
      </div>

      {/* Loading */}
      {loading ? (
        <div className="bg-navy rounded-xl border border-slate-700/50 p-8 text-center">
          <Loader2 className="animate-spin mx-auto text-gold" size={24} />
          <p className="text-sm text-slate-400 mt-2">Loading mappings...</p>
        </div>
      ) : filteredMappings.length === 0 ? (
        <div className="bg-navy rounded-xl border border-slate-700/50 p-8 text-center">
          <HelpCircle className="mx-auto text-slate-500 mb-2" size={24} />
          <p className="text-sm text-slate-400">
            {mappings.length === 0
              ? "No carrier agency mappings found. Use the seed script to import agencies from production data."
              : "No agencies match your filters."}
          </p>
        </div>
      ) : (
        /* Agency list grouped by carrier */
        Object.entries(groupedByCarrier).map(([carrierKey, carrierMappings]) => (
          <div key={carrierKey} className="bg-navy rounded-xl border border-slate-700/50 overflow-hidden">
            {/* Carrier header */}
            <div className="px-4 py-3 border-b border-slate-700/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-900/50 text-blue-300 border border-blue-700/30 font-medium">
                  {carrierKey}
                </span>
                <span className="text-xs text-slate-500">
                  {carrierMappings.length} agencies &middot;{" "}
                  {carrierMappings.reduce((s, m) => s + (m.policy_count || 0), 0).toLocaleString()} policies
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">
                  {carrierMappings.filter((m) => m.portal_agency_id).length}/{carrierMappings.length} matched
                </span>
                <span className="text-xs text-slate-500">
                  {carrierMappings.filter((m) => m.is_confirmed).length} confirmed
                </span>
              </div>
            </div>

            {/* Agency rows */}
            <div className="divide-y divide-slate-700/30">
              {carrierMappings.map((m) => (
                <div
                  key={m.id}
                  className="px-4 py-3 hover:bg-slate-800/30 transition-colors cursor-pointer"
                  onClick={() => openAgencyDrillDown(m)}
                >
                  <div className="flex items-center justify-between gap-4">
                    {/* Left: carrier agency info */}
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <Building2 size={16} className="text-slate-500 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm text-white font-medium truncate">
                          {m.carrier_agency_name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {m.carrier_agency_code || "no code"} &middot; {m.policy_count} policies
                        </p>
                      </div>
                    </div>

                    {/* Center: match arrow + portal agency */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {m.portal_agency_id ? (
                        <>
                          <ChevronRight size={14} className="text-green-500" />
                          <div className="text-right min-w-0">
                            <p className="text-sm text-green-300 font-medium truncate max-w-[200px]">
                              {m.portal_agency_name}
                            </p>
                            <p className="text-xs text-slate-500">
                              WN: {m.unl_writing_number || "—"} &middot;{" "}
                              {m.match_method}
                              {m.match_confidence ? ` (${Math.round(m.match_confidence * 100)}%)` : ""}
                            </p>
                          </div>
                        </>
                      ) : matchingId === m.id ? (
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <div className="relative">
                            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
                            <input
                              type="text"
                              value={portalSearch}
                              onChange={(e) => handlePortalSearch(e.target.value)}
                              placeholder="Search Portal agencies..."
                              className="pl-7 pr-2 py-1.5 text-xs bg-slate-800 border border-gold/50 rounded-md text-white placeholder:text-slate-500 focus:outline-none focus:border-gold w-[220px]"
                              autoFocus
                            />
                            {(portalResults.length > 0 || portalSearching) && (
                              <div className="absolute top-full left-0 mt-1 w-[320px] bg-slate-800 border border-slate-600 rounded-lg shadow-xl z-50 max-h-[200px] overflow-y-auto">
                                {portalSearching ? (
                                  <div className="p-3 text-center text-xs text-slate-400">
                                    <Loader2 size={14} className="animate-spin inline mr-1" /> Searching...
                                  </div>
                                ) : portalResults.map((pa) => (
                                  <button
                                    key={pa.id}
                                    onClick={() => handleManualMatch(m, pa)}
                                    className="w-full text-left px-3 py-2 hover:bg-slate-700/50 transition-colors border-b border-slate-700/30 last:border-0"
                                  >
                                    <p className="text-xs text-white font-medium">{pa.name}</p>
                                    <p className="text-xs text-slate-500">
                                      WN: {pa.unl_writing_number || "—"}
                                      {pa.agency_type ? ` · ${pa.agency_type}` : ""}
                                    </p>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); setMatchingId(null); setPortalSearch(""); setPortalResults([]); }}
                            className="text-xs text-slate-400 hover:text-red-300"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); setMatchingId(m.id); setPortalSearch(""); setPortalResults([]); }}
                          className="flex items-center gap-1 text-xs text-yellow-400 hover:text-gold transition-colors"
                        >
                          <AlertTriangle size={12} />
                          Unmatched — click to assign
                        </button>
                      )}
                    </div>

                    {/* Right: status badges + actions */}
                    <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                      {m.is_confirmed ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/50 text-green-300 border border-green-700/30 flex items-center gap-1">
                          <Lock size={10} /> Locked
                        </span>
                      ) : m.portal_agency_id ? (
                        <button
                          onClick={() => handleConfirm(m.id)}
                          className="text-xs px-2 py-1 rounded-md bg-green-900/30 text-green-300 border border-green-700/30 hover:bg-green-900/50 transition-colors flex items-center gap-1"
                        >
                          <Check size={12} /> Confirm
                        </button>
                      ) : null}
                      {!m.is_confirmed && m.portal_agency_id && (
                        <button
                          onClick={() => handleUnlink(m)}
                          className="text-xs px-2 py-1 rounded-md text-slate-400 hover:text-red-300 hover:bg-red-900/20 transition-colors"
                          title="Unlink match"
                        >
                          <Unlink size={12} />
                        </button>
                      )}
                      {!m.is_confirmed && (
                        <button
                          onClick={() => handleDelete(m.id)}
                          className="text-xs px-2 py-1 rounded-md text-slate-400 hover:text-red-300 hover:bg-red-900/20 transition-colors"
                          title="Delete mapping"
                        >
                          <X size={12} />
                        </button>
                      )}
                      <ChevronRight size={14} className="text-slate-600" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
