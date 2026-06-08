import { RefreshCw, Loader2, FileSpreadsheet } from "lucide-react";
import { resolvePlanName } from "../../lib/planCodes";
import type { FormSubmission } from "../../types";

interface SubmissionsTableProps {
  submissions: FormSubmission[];
  loading: boolean;
  onRefresh: () => void;
}

export default function SubmissionsTable({
  submissions,
  loading,
  onRefresh,
}: SubmissionsTableProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
        <Loader2 className="animate-spin text-slate-400 mx-auto" size={32} />
        <p className="mt-3 text-sm text-slate-500">Loading submissions...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200">
      <div className="flex items-center justify-between p-4 border-b border-slate-200">
        <h3 className="text-lg font-semibold text-slate-800">
          Form Submissions
          <span className="ml-2 text-sm font-normal text-slate-500">
            ({submissions.length})
          </span>
        </h3>
        <button
          onClick={onRefresh}
          className="btn-secondary text-sm flex items-center gap-2 px-3 py-1.5"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {submissions.length === 0 ? (
        <div className="p-12 text-center">
          <FileSpreadsheet className="text-slate-300 mx-auto" size={40} />
          <p className="mt-3 text-sm text-slate-500">No submissions yet</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left">
                <th className="px-4 py-3 font-medium text-slate-600">Date</th>
                <th className="px-4 py-3 font-medium text-slate-600">Agent</th>
                <th className="px-4 py-3 font-medium text-slate-600">
                  Carrier
                </th>
                <th className="px-4 py-3 font-medium text-slate-600">
                  Type
                </th>
                <th className="px-4 py-3 font-medium text-slate-600">
                  Client
                </th>
                <th className="px-4 py-3 font-medium text-slate-600">Plan</th>
                <th className="px-4 py-3 font-medium text-slate-600">
                  Premium
                </th>
                <th className="px-4 py-3 font-medium text-slate-600">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {submissions.map((sub) => (
                <tr
                  key={sub.id}
                  className="hover:bg-slate-50 transition-colors"
                >
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                    {new Date(sub.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-slate-800 whitespace-nowrap">
                    {sub.agent_first_name} {sub.agent_last_name}
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-teal-50 text-teal-700 rounded text-xs font-medium">
                      {sub.carrier}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      sub.product_type === "HI"
                        ? "bg-sky-50 text-sky-700"
                        : sub.product_type === "HHC"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-600"
                    }`}>
                      {sub.product_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-800 whitespace-nowrap">
                    {sub.client_first_name} {sub.client_last_name}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {resolvePlanName(sub.plan_name)}
                  </td>
                  <td className="px-4 py-3 text-slate-800 font-medium">
                    ${Number(sub.plan_premium).toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${
                        sub.status === "pending"
                          ? "bg-amber-50 text-amber-700"
                          : sub.status === "approved"
                            ? "bg-green-50 text-green-700"
                            : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {sub.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
