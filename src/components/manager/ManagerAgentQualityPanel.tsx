import { useState, useEffect, useCallback } from "react";
import { Loader2, RefreshCw, GraduationCap, AlertTriangle, ShieldCheck, PhoneCall } from "lucide-react";
import { LineChart, Line, ResponsiveContainer, YAxis, Tooltip } from "recharts";
import { mgrGetAgentQuality, mgrGetAgentPersistency } from "../../lib/api";

// ---- shared types ----
interface FollowUpRow {
  agent_id: string | null;
  agent_name: string;
  handed_off: number;
  contacted_in_sla: number;
  followup_rate_pct: number;
}
interface ContactTrendPoint { month: string; handed_off: number; rate_pct: number | null; }

interface PersistTrendPoint { month: string; drafted_first: number; pct: number | null; }
interface PersistRow {
  agent_number: string | null;
  agent_name: string;
  drafted_first: number;
  retained: number;
  persistency_pct: number;
  trend: PersistTrendPoint[];
}
interface AgencyPersist {
  drafted_first: number;
  retained: number;
  persistency_pct: number;
  trend: PersistTrendPoint[];
}

interface ManagerAgentQualityPanelProps {
  token: string;
}

// Retention target (FYM north-star) and the follow-up coaching threshold.
const RETENTION_TARGET_PCT = 90;
const COACH_THRESHOLD_PCT = 80;

type View = "persistency" | "followup";

function shortMonth(m: string): string {
  // "2026-07" → "Jul"
  const d = new Date(`${m}-01T00:00:00`);
  return Number.isNaN(d.getTime()) ? m : d.toLocaleString(undefined, { month: "short" });
}

function Sparkline({
  data,
  color,
}: {
  data: { month: string; value: number | null }[];
  color: string;
}) {
  const hasAny = data.some((d) => d.value !== null);
  if (!hasAny) {
    return <div className="h-9 flex items-center text-[10px] text-slate-600">no history yet</div>;
  }
  return (
    <div className="h-9 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, bottom: 2, left: 0, right: 0 }}>
          <YAxis domain={[0, 100]} hide />
          <Tooltip
            contentStyle={{ background: "#0b1220", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
            labelStyle={{ color: "#94a3b8" }}
            formatter={(v) => [v === null || v === undefined ? "—" : `${v}%`, "rate"]}
            labelFormatter={(l) => shortMonth(String(l ?? ""))}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={{ r: 2, fill: color }}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function ManagerAgentQualityPanel({ token }: ManagerAgentQualityPanelProps) {
  const [view, setView] = useState<View>("persistency");

  const [followup, setFollowup] = useState<FollowUpRow[]>([]);
  const [contactTrend, setContactTrend] = useState<ContactTrendPoint[]>([]);
  const [slaDays, setSlaDays] = useState(5);

  const [persist, setPersist] = useState<PersistRow[]>([]);
  const [agencyPersist, setAgencyPersist] = useState<AgencyPersist | null>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const fetchAll = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const [q, p] = await Promise.all([
        mgrGetAgentQuality(token),
        mgrGetAgentPersistency(token),
      ]);
      setFollowup((q.agents as FollowUpRow[]) || []);
      setContactTrend((q.contact_trend as ContactTrendPoint[]) || []);
      if (typeof q.sla_days === "number") setSlaDays(q.sla_days);
      setPersist((p.agents as PersistRow[]) || []);
      setAgencyPersist((p.agency as AgencyPersist) ?? null);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agent quality");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="animate-spin text-gold" size={28} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-400 text-sm">{error}</p>
        <button onClick={() => fetchAll()} className="mt-3 text-xs text-gold hover:underline">
          Retry
        </button>
      </div>
    );
  }

  const ViewSwitch = (
    <div className="flex gap-1 bg-navy p-1 rounded-lg w-fit border border-slate-700/50">
      {([
        { key: "persistency", label: "Persistency", icon: ShieldCheck },
        { key: "followup", label: "5-Day Follow-Up", icon: PhoneCall },
      ] as const).map((t) => {
        const Icon = t.icon;
        const active = view === t.key;
        return (
          <button
            key={t.key}
            onClick={() => setView(t.key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              active ? "bg-navy-light text-gold border border-gold/20" : "text-slate-400 hover:text-white"
            }`}
          >
            <Icon size={14} />
            {t.label}
          </button>
        );
      })}
    </div>
  );

  const Header = (
    <div className="flex items-center gap-2">
      <GraduationCap size={16} className="text-gold" />
      <h3 className="text-sm font-semibold text-white">Agent Quality</h3>
      <button
        onClick={() => fetchAll(true)}
        disabled={refreshing}
        className="ml-auto text-slate-400 hover:text-white p-1 disabled:opacity-50"
        aria-label="Refresh"
        title="Refresh"
      >
        <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      {Header}
      {ViewSwitch}
      {view === "persistency" ? (
        <PersistencyView agents={persist} agency={agencyPersist} />
      ) : (
        <FollowUpView agents={followup} slaDays={slaDays} trend={contactTrend} />
      )}
    </div>
  );
}

// ---------------- Persistency view ----------------
function PersistencyView({ agents, agency }: { agents: PersistRow[]; agency: AgencyPersist | null }) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        90-day retention on the business each agent wrote — of the policies that drafted a first premium, the
        share still on the books at the 3rd draw. Target {RETENTION_TARGET_PCT}%. Worst-first.
      </p>

      {agency && agency.drafted_first > 0 && (
        <div className="bg-navy rounded-xl p-3 border border-slate-700/50">
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wide text-slate-400">Agency-wide</span>
            <span
              className={`ml-auto text-lg font-bold ${
                agency.persistency_pct >= RETENTION_TARGET_PCT ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {agency.persistency_pct}%
            </span>
          </div>
          <div className="mt-1">
            <Sparkline
              data={agency.trend.map((t) => ({ month: t.month, value: t.pct }))}
              color="#fbbf24"
            />
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {agency.retained} of {agency.drafted_first} retained · trend by effective-month cohort
          </p>
        </div>
      )}

      {agents.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm bg-navy rounded-xl border border-slate-700/50">
          No agents with an eligible book yet (policies need to be old enough for the 3rd draw).
        </div>
      ) : (
        <div className="space-y-2">
          {agents.map((a) => {
            const below = a.persistency_pct < RETENTION_TARGET_PCT;
            const barColor =
              a.persistency_pct >= RETENTION_TARGET_PCT ? "bg-emerald-400"
              : a.persistency_pct >= 80 ? "bg-amber-400"
              : "bg-rose-400";
            const lineColor =
              a.persistency_pct >= RETENTION_TARGET_PCT ? "#34d399"
              : a.persistency_pct >= 80 ? "#fbbf24"
              : "#fb7185";
            return (
              <div
                key={a.agent_number ?? a.agent_name}
                className={`bg-navy rounded-lg p-3 border ${below ? "border-rose-500/40" : "border-slate-700/50"}`}
              >
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-white truncate">{a.agent_name}</p>
                  {below && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30 flex items-center gap-1">
                      <AlertTriangle size={9} /> BELOW {RETENTION_TARGET_PCT}%
                    </span>
                  )}
                  <span className="ml-auto text-sm font-bold text-white">{a.persistency_pct}%</span>
                </div>
                <div className="mt-2 h-1.5 w-full rounded-full bg-slate-700/60 overflow-hidden">
                  <div className={`h-full ${barColor}`} style={{ width: `${Math.min(100, a.persistency_pct)}%` }} />
                </div>
                <div className="mt-1.5">
                  <Sparkline data={a.trend.map((t) => ({ month: t.month, value: t.pct }))} color={lineColor} />
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  {a.retained} of {a.drafted_first} retained
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------- Follow-up (5-day SLA) view ----------------
function FollowUpView({
  agents,
  slaDays,
  trend,
}: {
  agents: FollowUpRow[];
  slaDays: number;
  trend: ContactTrendPoint[];
}) {
  const totalHanded = agents.reduce((s, a) => s + a.handed_off, 0);
  const totalInSla = agents.reduce((s, a) => s + a.contacted_in_sla, 0);
  const agencyRate = totalHanded ? Math.round((1000 * totalInSla) / totalHanded) / 10 : 0;

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Of the at-risk policies handed to each agent, the share they made contact on within the {slaDays}-day SLA.
        A low rate flags an agent who isn't chasing their own clients — a coaching signal.
      </p>

      {totalHanded > 0 && (
        <div className="bg-navy rounded-xl p-3 border border-slate-700/50">
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wide text-slate-400">Agency-wide</span>
            <span
              className={`ml-auto text-lg font-bold ${agencyRate >= COACH_THRESHOLD_PCT ? "text-emerald-400" : "text-rose-400"}`}
            >
              {agencyRate}%
            </span>
          </div>
          <div className="mt-1">
            <Sparkline data={trend.map((t) => ({ month: t.month, value: t.rate_pct }))} color="#fbbf24" />
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {totalInSla} of {totalHanded} contacted in SLA · trend by handoff month
          </p>
        </div>
      )}

      {agents.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm bg-navy rounded-xl border border-slate-700/50">
          No agent handoffs yet. Hand an at-risk policy to an agent to start tracking.
        </div>
      ) : (
        <div className="space-y-2">
          {agents.map((a) => {
            const flag = a.followup_rate_pct < COACH_THRESHOLD_PCT;
            const barColor =
              a.followup_rate_pct >= 90 ? "bg-emerald-400"
              : a.followup_rate_pct >= COACH_THRESHOLD_PCT ? "bg-amber-400"
              : "bg-rose-400";
            return (
              <div
                key={a.agent_id ?? a.agent_name}
                className={`bg-navy rounded-lg p-3 border ${flag ? "border-rose-500/40" : "border-slate-700/50"}`}
              >
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-white truncate">{a.agent_name}</p>
                  {flag && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30 flex items-center gap-1">
                      <AlertTriangle size={9} /> NEEDS COACHING
                    </span>
                  )}
                  <span className="ml-auto text-sm font-bold text-white">{a.followup_rate_pct}%</span>
                </div>
                <div className="mt-2 h-1.5 w-full rounded-full bg-slate-700/60 overflow-hidden">
                  <div className={`h-full ${barColor}`} style={{ width: `${Math.min(100, a.followup_rate_pct)}%` }} />
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5">
                  {a.contacted_in_sla} of {a.handed_off} contacted within {slaDays} days
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
