import { useState, useEffect, useCallback } from "react";
import { planCodeMap } from "../../lib/planCodes";
import {
  ArrowLeft,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Search,
  Eye,
  EyeOff,
  Download,
  CalendarDays,
} from "lucide-react";
import { adminGetSourceRecords } from "../../lib/api";

function useActiveDate() {
  const format = () =>
    new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", month: "2-digit", day: "2-digit", year: "numeric" });
  const [date, setDate] = useState(format);
  useEffect(() => {
    const id = setInterval(() => setDate(format()), 60_000);
    return () => clearInterval(id);
  }, []);
  return date;
}

interface SourceUpload {
  id: string;
  carrier: string;
  filename: string;
  row_count: number;
  status: string;
  uploaded_by: string;
  created_at: string;
}

interface SourceRecord {
  id: string;
  raw_data: Record<string, string>;
  mapped_data: Record<string, string>;
  processing_status: string;
  error_reason: string | null;
}

interface SourceRecordsTableProps {
  token: string;
  upload: SourceUpload;
  onBack: () => void;
}

export default function SourceRecordsTable({ token, upload, onBack }: SourceRecordsTableProps) {
  const [records, setRecords] = useState<SourceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [viewMode, setViewMode] = useState<"mapped" | "raw">("mapped");
  const [exporting, setExporting] = useState(false);
  const activeDate = useActiveDate();
  const pageSize = 50;

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminGetSourceRecords(token, upload.id, page, pageSize);
      setRecords(res.records || []);
      setTotalCount(res.totalCount || 0);
    } finally {
      setLoading(false);
    }
  }, [token, upload.id, page]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const hasMappedData = records.length > 0 && records[0].mapped_data && Object.keys(records[0].mapped_data).length > 0;
  const effectiveView = hasMappedData ? viewMode : "raw";

  const toProperCase = (str: string) =>
    str.toLowerCase().replace(/(?:^|\s|[-'])\S/g, (c) => c.toUpperCase());

  const getRecordData = (record: SourceRecord) => {
    if (effectiveView !== "mapped") return record.raw_data;
    const data = { ...record.mapped_data };
    const firstName = (data["First Name"] || "").trim();
    const parts = firstName.split(/\s+/);
    if (parts.length > 1) {
      data["First Name"] = toProperCase(parts[0]);
      data["Middle Initial"] = parts[parts.length - 1].charAt(0).toUpperCase();
    } else {
      data["First Name"] = toProperCase(firstName);
      data["Middle Initial"] = "";
    }
    if (data["Last Name"]) {
      data["Last Name"] = toProperCase(data["Last Name"].trim());
    }

    const writingAgent = (data["Writing Agent"] || "").trim();
    if (writingAgent) {
      const agentParts = writingAgent.split(/\s+/).filter(Boolean);
      data["Writing Agent First Name"] = agentParts.length > 0 ? toProperCase(agentParts[0]) : "";
      data["Writing Agent Last Name"] = agentParts.length > 1 ? toProperCase(agentParts[agentParts.length - 1]) : "";
      data["Writing Agent"] = toProperCase(writingAgent);
    } else {
      data["Writing Agent First Name"] = "";
      data["Writing Agent Last Name"] = "";
    }
    return data;
  };

  const dateColumns = new Set(["Submit Date", "Paid To Date", "Effective Date"]);
  const billingModeMap: Record<string, string> = { "1": "Monthly", "3": "Quarterly", "6": "Semi-Annual", "12": "Annual" };
  const contractCodeMap: Record<string, string> = { T: "Terminated", S: "Suspended", P: "Pending", A: "Active" };
  const contractReasonMap: Record<string, string> = {
    WI: "Withdrawn", LP: "Lapsed", DE: "Declined", CA: "Canceled",
    DC: "Claim", IC: "Incomplete", RS: "Reinstated/Restored", OW: "Owner Withdrawn",
    RI: "Ready to Issue", NT: "Not Taken", CV: "Converted", AC: "Canceled",
    HO: "Suspended (Pending - NSF)", SR: "Surrendered", RE: "Reinstated",
    SM: "Submitted", PC: "Policy Change",
  };

  const formatCellValue = (col: string, value: string | undefined): string => {
    if (!value) return "";
    if (effectiveView === "mapped" && col === "Contract Code") {
      return contractCodeMap[value.trim().toUpperCase()] || value;
    }
    if (effectiveView === "mapped" && col === "Contract Reason") {
      return contractReasonMap[value.trim().toUpperCase()] || value;
    }
    if (effectiveView === "mapped" && col === "Plan Code") {
      return planCodeMap[value.trim().toUpperCase()] || value;
    }
    if (effectiveView === "mapped" && col === "Billing Mode") {
      return billingModeMap[value.trim()] || value;
    }
    if (effectiveView === "mapped" && dateColumns.has(col)) {
      const trimmed = value.trim();
      if (/^\d{8}$/.test(trimmed)) {
        const yyyy = trimmed.slice(0, 4);
        const mm = trimmed.slice(4, 6);
        const dd = trimmed.slice(6, 8);
        return `${mm}/${dd}/${yyyy}`;
      }
      if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
        const [yyyy, mm, dd] = trimmed.slice(0, 10).split("-");
        return `${mm}/${dd}/${yyyy}`;
      }
    }
    return value;
  };

  const allColumns = records.length > 0
    ? Object.keys(getRecordData(records[0]))
    : [];

  if (effectiveView === "mapped") {
    const miIdx = allColumns.indexOf("Middle Initial");
    if (miIdx !== -1) allColumns.splice(miIdx, 1);

    const fnIdx = allColumns.indexOf("First Name");
    const lnIdx = allColumns.indexOf("Last Name");
    if (fnIdx !== -1 && lnIdx !== -1 && fnIdx > lnIdx) {
      allColumns.splice(fnIdx, 1);
      allColumns.splice(allColumns.indexOf("Last Name"), 0, "First Name");
    }

    const lnPos = allColumns.indexOf("Last Name");
    if (lnPos !== -1) {
      allColumns.splice(lnPos, 0, "Middle Initial");
    }
  }

  const displayColumnName = (col: string) =>
    effectiveView === "mapped" && col === "Plan Code" ? "Plan Name" : col;

  const visibleColumns = allColumns.filter((c) => !hiddenColumns.has(c));

  const filteredRecords = searchTerm
    ? records.filter((r) =>
        Object.values(getRecordData(r)).some((v) =>
          v?.toLowerCase().includes(searchTerm.toLowerCase())
        )
      )
    : records;

  const totalPages = Math.ceil(totalCount / pageSize);

  const toggleColumn = (col: string) => {
    const next = new Set(hiddenColumns);
    if (next.has(col)) {
      next.delete(col);
    } else {
      next.add(col);
    }
    setHiddenColumns(next);
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "imported": return "bg-emerald-900/30 text-emerald-300";
      case "skipped": return "bg-amber-900/30 text-amber-300";
      case "error": return "bg-red-900/30 text-red-300";
      default: return "bg-slate-700/30 text-slate-300";
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const batchSize = 500;
      const pages = Math.ceil(totalCount / batchSize);
      let allRecords: SourceRecord[] = [];
      for (let p = 1; p <= pages; p++) {
        const res = await adminGetSourceRecords(token, upload.id, p, batchSize);
        allRecords = allRecords.concat(res.records || []);
      }

      const cols = visibleColumns;
      const escapeCsv = (val: string) => {
        if (val.includes(",") || val.includes('"') || val.includes("\n")) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      };

      const header = cols.map(escapeCsv).join(",");
      const rows = allRecords.map((record) => {
        const data = effectiveView === "mapped"
          ? (() => {
              const d = { ...record.mapped_data };
              const firstName = (d["First Name"] || "").trim();
              const parts = firstName.split(/\s+/);
              if (parts.length > 1) {
                d["First Name"] = parts[0];
                d["Middle Initial"] = parts[parts.length - 1].charAt(0).toUpperCase();
              } else {
                d["Middle Initial"] = "";
              }
              return d;
            })()
          : record.raw_data;
        return cols.map((col) => escapeCsv(formatCellValue(col, data[col]))).join(",");
      });

      const csv = [header, ...rows].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${upload.filename.replace(/\.[^.]+$/, "")}_mapped.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
          >
            <ArrowLeft size={16} />
            Back
          </button>
          <span className="text-sm font-medium text-white">{upload.filename}</span>
          <span className="text-xs text-slate-400">
            {upload.carrier} -- {upload.row_count.toLocaleString()} records -- {new Date(upload.created_at).toLocaleDateString()}
          </span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-navy-light border border-slate-700/50 rounded-lg">
          <CalendarDays size={14} className="text-gold/70" />
          <div className="flex flex-col leading-tight">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Active Date</span>
            <span className="text-sm font-semibold font-mono text-white">{activeDate}</span>
          </div>
        </div>
      </div>

      <div className="bg-navy rounded-xl border border-slate-700/50 p-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search records..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-sm border border-slate-600 rounded-lg bg-navy-light text-white focus:outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold"
            />
          </div>

          {hasMappedData && (
            <div className="flex items-center border border-slate-600 rounded-lg overflow-hidden">
              <button
                onClick={() => { setViewMode("mapped"); setHiddenColumns(new Set()); }}
                className={`px-3 py-2 text-xs font-medium transition-colors ${
                  effectiveView === "mapped"
                    ? "bg-gold/10 text-gold border-r border-slate-600"
                    : "text-slate-400 hover:bg-navy-light/30 border-r border-slate-600"
                }`}
              >
                Mapped
              </button>
              <button
                onClick={() => { setViewMode("raw"); setHiddenColumns(new Set()); }}
                className={`px-3 py-2 text-xs font-medium transition-colors ${
                  effectiveView === "raw"
                    ? "bg-gold/10 text-gold"
                    : "text-slate-400 hover:bg-navy-light/30"
                }`}
              >
                Raw
              </button>
            </div>
          )}

          <div className="relative">
            <button
              onClick={() => setShowColumnPicker(!showColumnPicker)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 border border-slate-600 rounded-lg hover:bg-navy-light/30 transition-colors"
            >
              {showColumnPicker ? <EyeOff size={14} /> : <Eye size={14} />}
              Columns ({visibleColumns.length}/{allColumns.length})
            </button>

            {showColumnPicker && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-navy border border-slate-700/50 rounded-lg shadow-lg p-3 max-h-[300px] overflow-y-auto w-64">
                <p className="text-xs font-medium text-slate-300 mb-2">Toggle Columns</p>
                <div className="space-y-1">
                  {allColumns.map((col) => (
                    <label key={col} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer py-0.5">
                      <input
                        type="checkbox"
                        checked={!hiddenColumns.has(col)}
                        onChange={() => toggleColumn(col)}
                        className="w-3 h-3 rounded border-slate-600 text-gold focus:ring-gold/20"
                      />
                      <span className="truncate font-mono">{displayColumnName(col)}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {effectiveView === "mapped" && (
            <button
              onClick={handleExport}
              disabled={exporting || totalCount === 0}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 border border-slate-600 rounded-lg hover:bg-navy-light/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              Export CSV
            </button>
          )}

          <div className="ml-auto flex items-center gap-2 text-xs text-slate-400">
            <span>
              Page {page} of {totalPages || 1} ({totalCount.toLocaleString()} total)
            </span>
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="p-1 border border-slate-600 rounded disabled:opacity-30 hover:bg-navy-light/30"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
              className="p-1 border border-slate-600 rounded disabled:opacity-30 hover:bg-navy-light/30"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="animate-spin text-gold" size={28} />
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="text-center py-12 text-sm text-slate-400">
            {searchTerm ? "No records match your search." : "No records found."}
          </div>
        ) : (
          <div className="overflow-x-auto border border-slate-700/50 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-navy-light border-b border-slate-700/30 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 text-gold/80 text-xs uppercase tracking-wider font-medium whitespace-nowrap">Status</th>
                  {visibleColumns.map((col) => (
                    <th key={col} className="text-left px-3 py-2 text-gold/80 text-xs uppercase tracking-wider font-medium whitespace-nowrap">
                      {displayColumnName(col)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {filteredRecords.map((record) => (
                  <tr key={record.id} className="hover:bg-navy-light/30">
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${statusColor(record.processing_status)}`}>
                        {record.processing_status}
                      </span>
                    </td>
                    {visibleColumns.map((col) => (
                      <td key={col} className="px-3 py-2 text-slate-200 whitespace-nowrap max-w-[180px] truncate">
                        {formatCellValue(col, getRecordData(record)[col])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
