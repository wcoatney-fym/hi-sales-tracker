import { useState, useEffect, useCallback } from "react";
import {
  Zap,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { adminGetGhlAgencies, adminRunGhlBackfill } from "../../lib/api";
import type { GhlAgencyBackfillInfo } from "../../lib/api";

interface GhlBackfillPanelProps {
  token: string;
}

interface BackfillState {
  status: "idle" | "running" | "success" | "error";
  result?: { fired?: number; held?: number; total?: number; dry?: boolean };
  error?: string;
}

function formatRelativeTime(isoString: string): string {
  const d = new Date(isoString);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
}

function TriggerCountRow({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="flex items-center justify-between text-sm py-1">
      <span className="text-slate-400">{label}</span>
      <span className={`font-semibold tabular-nums ${color}`}>{count.toLocaleString()}</span>
    </div>
  );
}

function AgencyCard({
  agency,
  token,
  onRefresh,
}: {
  agency: GhlAgencyBackfillInfo;
  token: string;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [backfill, setBackfill] = useState<BackfillState>({ status: "idle" });
  const [confirming, setConfirming] = useState(false);

  const npnPct = agency.roster_total > 0
    ? Math.round((agency.npn_covered / agency.roster_total) * 100)
    : 0;

  const totalFires = agency.total_unfired;

  async function handleRunBackfill(dry = false) {
    setConfirming(false);
    setBackfill({ status: "running" });
    try {
      const res = await adminRunGhlBackfill(token, agency.id, { dry });
      const r = res.result ?? {};
      setBackfill({
        status: "success",
        result: {
          fired: typeof r.fired === "number" ? r.fired : undefined,
          held: typeof r.held === "number" ? r.held : undefined,
          total: typeof r.total === "number" ? r.total : undefined,
          dry: typeof r.dry === "boolean" ? r.dry : dry,
        },
      });
      if (!dry) onRefresh();
    } catch (e) {
      setBackfill({ status: "error", error: e instanceof Error ? e.message : "Unknown error" });
    }
  }

  const isRunning = backfill.status === "running";

  return (
    <div className="bg-navy rounded-xl border border-slate-700/50 overflow-hidden">
      {/* Header */}
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-semibold text-white truncate">{agency.name}</span>
              <span className="text-xs text-slate-500 font-mono shrink-0">
                {agency.writing_numbers[0] ?? "—"}
                {agency.writing_numbers.length > 1 && ` +${agency.writing_numbers.length - 1}`}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span>NPN coverage: <span className={npnPct === 100 ? "text-emerald-400" : "text-amber-400"}>{agency.npn_covered}/{agency.roster_total} ({npnPct}%)</span></span>
              {agency.last_run && (
                <span>Last run: <span className="text-slate-300">{formatRelativeTime(agency.last_run.ran_at)}</span></span>
              )}
            </div>
          </div>

          {/* Total badge */}
          <div className="text-right shrink-0">
            <div className="text-2xl font-bold text-gold tabular-nums">{totalFires.toLocaleString()}</div>
            <div className="text-xs text-slate-400">unfired triggers</div>
          </div>
        </div>

        {/* Breakdown toggle */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
        >
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {expanded ? "Hide breakdown" : "Show breakdown"}
        </button>

        {expanded && (
          <div className="mt-3 border-t border-slate-700/50 pt-3">
            <TriggerCountRow label="Approved (P→A)"    count={agency.counts.approved}   color="text-emerald-400" />
            <TriggerCountRow label="Terminated (A→T)"  count={agency.counts.terminated} color="text-red-400" />
            <TriggerCountRow label="Submission (new)"  count={agency.counts.submission} color="text-blue-400" />
            <TriggerCountRow label="At-Risk (newly set)" count={agency.counts.at_risk} color="text-amber-400" />
            <div className="flex items-center justify-between text-sm py-1 border-t border-slate-700/50 mt-1 pt-2">
              <span className="text-white font-medium">Total</span>
              <span className="font-bold text-white tabular-nums">{totalFires.toLocaleString()}</span>
            </div>
          </div>
        )}
      </div>

      {/* Action footer */}
      <div className="px-5 pb-5">
        {backfill.status === "success" && (
          <div className="mb-3 flex items-start gap-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
            <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
            <span>
              {backfill.result?.dry ? "Dry run: " : ""}
              {backfill.result?.fired?.toLocaleString() ?? "—"} fired
              {backfill.result?.held ? `, ${backfill.result.held} held (missing NPN)` : ""}
            </span>
          </div>
        )}

        {backfill.status === "error" && (
          <div className="mb-3 flex items-start gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>{backfill.error}</span>
          </div>
        )}

        {/* Confirm step */}
        {confirming && !isRunning && (
          <div className="mb-3 p-3 bg-amber-500/10 border border-amber-500/25 rounded-lg">
            <p className="text-xs text-amber-300 mb-3">
              This will push <strong>{totalFires.toLocaleString()} GHL contacts</strong> for <strong>{agency.name}</strong>. This cannot be undone. Fired triggers are idempotent — re-running won't duplicate existing entries.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => handleRunBackfill(false)}
                className="flex-1 bg-gold hover:bg-gold/90 text-navy text-xs font-bold py-2 px-3 rounded-lg transition-colors"
              >
                Yes, run backfill
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white text-xs font-medium py-2 px-3 rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {!confirming && (
          <div className="flex gap-2">
            <button
              disabled={isRunning || totalFires === 0}
              onClick={() => setConfirming(true)}
              className="flex-1 flex items-center justify-center gap-2 bg-gold hover:bg-gold/90 disabled:opacity-40 disabled:cursor-not-allowed text-navy text-sm font-bold py-2.5 px-4 rounded-lg transition-colors"
            >
              {isRunning ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
              {isRunning ? "Running…" : "Run Backfill"}
            </button>
            <button
              disabled={isRunning || totalFires === 0}
              onClick={() => handleRunBackfill(true)}
              title="Dry run — counts only, no GHL pushes"
              className="flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium py-2.5 px-4 rounded-lg transition-colors"
            >
              {isRunning ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Dry Run
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function GhlBackfillPanel({ token }: GhlBackfillPanelProps) {
  const [agencies, setAgencies] = useState<GhlAgencyBackfillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAgencies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminGetGhlAgencies(token);
      setAgencies(res.agencies ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load agencies");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { loadAgencies(); }, [loadAgencies]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="animate-spin text-gold" size={28} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-3 text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-5">
        <AlertTriangle size={18} className="shrink-0" />
        <span className="text-sm">{error}</span>
        <button onClick={loadAgencies} className="ml-auto text-xs text-slate-400 hover:text-white underline">Retry</button>
      </div>
    );
  }

  if (agencies.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400">
        <Zap size={32} className="mx-auto mb-3 opacity-30" />
        <p className="text-sm">No GHL-enabled agencies found.</p>
        <p className="text-xs mt-1">Enable GHL API access for an agency in Agency Access settings.</p>
      </div>
    );
  }

  const grandTotal = agencies.reduce((s, a) => s + a.total_unfired, 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-400 mt-1">
            Push policy lifecycle events to GHL for all enabled agencies. Counts are live from Max's DB — zero <code className="text-xs bg-slate-800 px-1 py-0.5 rounded">form_submissions</code> reads.
          </p>
        </div>
        <div className="text-right shrink-0 ml-4">
          <div className="text-3xl font-bold text-gold tabular-nums">{grandTotal.toLocaleString()}</div>
          <div className="text-xs text-slate-400">total across all agencies</div>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {agencies.map((agency) => (
          <AgencyCard
            key={agency.id}
            agency={agency}
            token={token}
            onRefresh={loadAgencies}
          />
        ))}
      </div>

      <p className="text-xs text-slate-500">
        Trigger counts include all historical unfired events (approved, terminated, submission, at-risk) from <code className="bg-slate-800 px-1 py-0.5 rounded">typed.unl_fym_policy_latest_load</code>. Backfill is idempotent — already-fired triggers are skipped via <code className="bg-slate-800 px-1 py-0.5 rounded">fired_triggers</code> gate.
      </p>
    </div>
  );
}
