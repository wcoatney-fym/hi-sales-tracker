import { useState, useEffect, useCallback } from "react";
import { UserX, Search, Building2 } from "lucide-react";
import { adminGetUnassignedAgents } from "../../lib/api";

interface UnassignedAgent {
  id: string;
  first_name: string;
  last_name: string;
  unl_writing_number: string;
  gtl_writing_number: string;
  npn: string;
  agency: string;
  agency_id: string | null;
  status: string;
}

interface UnassignedAgentsPanelProps {
  token: string;
}

export default function UnassignedAgentsPanel({ token }: UnassignedAgentsPanelProps) {
  const [agents, setAgents] = useState<UnassignedAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchUnassigned = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminGetUnassignedAgents(token);
      setAgents(data.agents || []);
    } catch {
      // ignore
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    fetchUnassigned();
  }, [fetchUnassigned]);

  const filtered = search
    ? agents.filter(
        (a) =>
          a.first_name.toLowerCase().includes(search.toLowerCase()) ||
          a.last_name.toLowerCase().includes(search.toLowerCase()) ||
          a.unl_writing_number.toLowerCase().includes(search.toLowerCase()) ||
          (a.npn || "").toLowerCase().includes(search.toLowerCase())
      )
    : agents;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <UserX size={16} className="text-amber-400" />
          <h3 className="text-sm font-semibold text-white">Unassigned Agents</h3>
          <span className="text-[10px] text-slate-400 bg-slate-700/50 px-1.5 py-0.5 rounded">
            {agents.length} agents
          </span>
        </div>
      </div>

      <p className="text-xs text-slate-400">
        These agents are not in any agency roster. They use legacy agency assignment (defaulting to FYM).
        Add them to an agency roster to assign them.
      </p>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          placeholder="Search agents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-8 pr-3 py-2 text-sm bg-slate-800/50 border border-slate-700/50 rounded-lg text-white placeholder-slate-500 focus:border-sky-500/50 focus:outline-none"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin h-5 w-5 border-2 border-sky-500 border-t-transparent rounded-full" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8">
          <Building2 size={24} className="mx-auto text-slate-600 mb-2" />
          <p className="text-sm text-slate-400">All agents are assigned to rosters.</p>
        </div>
      ) : (
        <div className="bg-slate-800/30 border border-slate-700/40 rounded-xl overflow-hidden">
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-800">
                <tr className="border-b border-slate-700/50">
                  <th className="text-left px-3 py-2 text-slate-400 font-medium">Name</th>
                  <th className="text-left px-3 py-2 text-slate-400 font-medium">UNL Number</th>
                  <th className="text-left px-3 py-2 text-slate-400 font-medium hidden sm:table-cell">GTL Number</th>
                  <th className="text-left px-3 py-2 text-slate-400 font-medium hidden sm:table-cell">NPN</th>
                  <th className="text-left px-3 py-2 text-slate-400 font-medium">Current Agency</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((agent) => (
                  <tr key={agent.id} className="border-b border-slate-700/30 hover:bg-slate-700/20 transition-colors">
                    <td className="px-3 py-2 text-white font-medium">
                      {agent.first_name} {agent.last_name}
                    </td>
                    <td className="px-3 py-2 text-slate-300 font-mono text-[10px]">
                      {agent.unl_writing_number || "---"}
                    </td>
                    <td className="px-3 py-2 text-slate-300 font-mono text-[10px] hidden sm:table-cell">
                      {agent.gtl_writing_number || "---"}
                    </td>
                    <td className="px-3 py-2 text-slate-400 hidden sm:table-cell">
                      {agent.npn || "---"}
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-[10px] text-slate-400 bg-slate-700/50 px-1.5 py-0.5 rounded">
                        {agent.agency || "FYM"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
