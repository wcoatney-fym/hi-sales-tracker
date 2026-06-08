import { useState, useEffect } from "react";
import { Search, ChevronLeft, ChevronRight, Loader2, Calendar } from "lucide-react";
import { adminGetLeadSubmissions } from "../../lib/api";

interface LeadSubmission {
  id: string;
  agent_first_name: string;
  agent_last_name: string;
  agent_number: string;
  carrier: string;
  client_first_name: string;
  client_last_name: string;
  phone: string;
  lead_vendor: string;
  agency: string;
  created_at: string;
}

export default function LeadSubmissionsPanel({ token }: { token: string }) {
  const [submissions, setSubmissions] = useState<LeadSubmission[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const pageSize = 25;

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await adminGetLeadSubmissions(token, {
        page,
        pageSize,
        search: search || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setSubmissions(res.submissions || []);
      setTotal(res.total || 0);
    } catch {
      setSubmissions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [page, token]);

  useEffect(() => {
    setPage(1);
    const timer = setTimeout(loadData, 400);
    return () => clearTimeout(timer);
  }, [search, startDate, endDate]);

  const totalPages = Math.ceil(total / pageSize);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by agent, client, or vendor..."
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-slate-400" />
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-2 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          />
          <span className="text-slate-400 text-sm">to</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-2 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
      </div>

      {/* Results count */}
      <p className="text-xs text-slate-500">{total} lead{total !== 1 ? "s" : ""} found</p>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 font-medium text-slate-600">Agent</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Writing #</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Client</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Phone</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Vendor</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Carrier</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Date</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-slate-400 mx-auto" />
                  </td>
                </tr>
              ) : submissions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-slate-400">
                    No lead submissions found
                  </td>
                </tr>
              ) : (
                submissions.map((s) => (
                  <tr key={s.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {s.agent_first_name} {s.agent_last_name}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{s.agent_number}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {s.client_first_name} {s.client_last_name}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{s.phone}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                        {s.lead_vendor}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{s.carrier}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{formatDate(s.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1 px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg hover:bg-slate-100 transition-all"
            >
              <ChevronLeft className="w-4 h-4" /> Previous
            </button>
            <span className="text-sm text-slate-500">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="flex items-center gap-1 px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg hover:bg-slate-100 transition-all"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
