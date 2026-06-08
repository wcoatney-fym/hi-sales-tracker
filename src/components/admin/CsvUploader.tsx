import { useState, useRef } from "react";
import {
  Upload,
  CheckCircle,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { adminUploadRoster } from "../../lib/api";

interface CsvUploaderProps {
  carrier: "UNL" | "GTL";
  token: string;
  agentCount: number;
  onUploadSuccess: () => void;
}

const REQUIRED_HEADERS = ["First Name", "Last Name", "Agent Number"];

function parseCsv(text: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return { headers: [] as string[], rows: [] as Record<string, string>[] };

  const headers = lines[0]
    .split(",")
    .map((h) => h.trim().replace(/^"|"$/g, ""));

  const rows = lines.slice(1).map((line) => {
    const values = line
      .split(",")
      .map((v) => v.trim().replace(/^"|"$/g, ""));
    return headers.reduce(
      (obj, header, i) => {
        obj[header] = values[i] || "";
        return obj;
      },
      {} as Record<string, string>
    );
  });

  return { headers, rows };
}

export default function CsvUploader({
  carrier,
  token,
  agentCount,
  onUploadSuccess,
}: CsvUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file.name.endsWith(".csv")) {
      setMessage({ type: "error", text: "Please upload a CSV file." });
      return;
    }

    const text = await file.text();
    const { headers, rows } = parseCsv(text);

    const missingHeaders = REQUIRED_HEADERS.filter(
      (h) => !headers.includes(h)
    );
    if (missingHeaders.length > 0) {
      setMessage({
        type: "error",
        text: "Invalid CSV format. Please ensure the file contains 'First Name', 'Last Name', and 'Agent Number' columns.",
      });
      return;
    }

    if (rows.length === 0) {
      setMessage({ type: "error", text: "CSV file contains no data rows." });
      return;
    }

    setUploading(true);
    setMessage(null);

    try {
      const result = await adminUploadRoster(token, carrier, rows, file.name);
      setMessage({
        type: "success",
        text: `Successfully uploaded ${result.count} agents.`,
      });
      onUploadSuccess();
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Upload failed.",
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <div className="bg-navy rounded-xl shadow-sm border border-slate-700/50 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">
          {carrier} Agent Roster
        </h3>
        <span className="text-xs font-medium px-2.5 py-1 bg-navy-light text-slate-300 rounded-full">
          {agentCount} agents
        </span>
      </div>

      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
          dragOver
            ? "border-gold bg-gold/10"
            : "border-slate-700/50 hover:border-slate-600"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label={`Upload ${carrier} roster CSV`}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
        }}
      >
        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="animate-spin text-gold" size={32} />
            <span className="text-sm text-slate-300">
              Uploading roster...
            </span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="w-12 h-12 bg-navy-light rounded-lg flex items-center justify-center">
              <Upload className="text-slate-400" size={24} />
            </div>
            <p className="text-sm font-medium text-slate-200">
              Drop CSV file here or click to browse
            </p>
            <p className="text-xs text-slate-400">
              Required columns: First Name, Last Name, Agent Number
            </p>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleInputChange}
          aria-hidden="true"
        />
      </div>

      {message && (
        <div
          className={`mt-4 flex items-start gap-2 p-3 rounded-lg border ${
            message.type === "success"
              ? "bg-emerald-900/30 border-emerald-700/50"
              : "bg-red-900/30 border-red-700/50"
          }`}
          role={message.type === "error" ? "alert" : "status"}
        >
          {message.type === "success" ? (
            <CheckCircle
              className="text-emerald-400 flex-shrink-0 mt-0.5"
              size={16}
            />
          ) : (
            <AlertCircle
              className="text-red-400 flex-shrink-0 mt-0.5"
              size={16}
            />
          )}
          <span
            className={`text-sm ${
              message.type === "success" ? "text-emerald-300" : "text-red-400"
            }`}
          >
            {message.text}
          </span>
        </div>
      )}
    </div>
  );
}
