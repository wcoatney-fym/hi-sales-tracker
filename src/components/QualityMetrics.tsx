import { useEffect, useState } from "react";
import { getQualityMetricsDirect } from "../lib/api";

interface Retention90d {
  drafted_first: number;
  retained: number;
  retention_pct: number | null;
}

interface PlacementRow {
  month: string;
  submitted: number;
  eligible: number;
  placed: number;
  placement_pct: number | null;
}

interface PersistencyRow {
  months_ago: number;
  cohort_month: string;
  went_active: number;
  still_active: number;
  persistency_pct: number | null;
}

// Color bands against the 90-day retention target:
//   green >= 90, amber 80-89, red < 80
function bandColor(pct: number | null): string {
  if (pct === null || pct === undefined) return "#64748b"; // slate-500
  if (pct >= 90) return "#22c55e"; // green-500
  if (pct >= 80) return "#f59e0b"; // amber-500
  return "#ef4444"; // red-500
}

// Semicircular gauge (0-100%) with a needle at `value`, a 90% target tick,
// and the current number called out in the center.
function PersistencyGauge({ value }: { value: number | null }) {
  const pct = value === null || value === undefined ? null : Math.max(0, Math.min(100, value));
  const cx = 100;
  const cy = 100;
  const r = 80;
  // Map 0..100% to 180deg..0deg (left to right across the top semicircle).
  const toXY = (p: number) => {
    const angle = Math.PI * (1 - p / 100);
    return { x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle) };
  };
  const arc = (from: number, to: number) => {
    const a = toXY(from);
    const b = toXY(to);
    // No single band spans > 180deg, so the large-arc-flag is always 0;
    // sweep-flag 1 draws the minor arc over the top of the semicircle.
    return `M ${a.x} ${a.y} A ${r} ${r} 0 0 1 ${b.x} ${b.y}`;
  };
  const needleAngle = pct === null ? Math.PI / 2 : Math.PI * (1 - pct / 100);
  const nx = cx + (r - 14) * Math.cos(needleAngle);
  const ny = cy - (r - 14) * Math.sin(needleAngle);
  // 90% target tick: a clean radial mark spanning the band width.
  const tickAngle = Math.PI * (1 - 90 / 100);
  const tickOuter = { x: cx + (r + 8) * Math.cos(tickAngle), y: cy - (r + 8) * Math.sin(tickAngle) };
  const tickInner = { x: cx + (r - 8) * Math.cos(tickAngle), y: cy - (r - 8) * Math.sin(tickAngle) };
  // Which band is the value in (brighten only that one for a clean read).
  const active = pct === null ? null : pct >= 90 ? "green" : pct >= 80 ? "amber" : "red";
  const bandOpacity = (band: string) => (active === band ? 1 : 0.25);

  return (
    <svg viewBox="0 0 200 124" className="w-full max-w-[260px] mx-auto">
      {/* colored bands: red 0-80, amber 80-90, green 90-100 (active band brightened) */}
      <path d={arc(0, 80)} fill="none" stroke="#ef4444" strokeWidth="12" strokeLinecap="round" opacity={bandOpacity("red")} />
      <path d={arc(80, 90)} fill="none" stroke="#f59e0b" strokeWidth="12" opacity={bandOpacity("amber")} />
      <path d={arc(90, 100)} fill="none" stroke="#22c55e" strokeWidth="12" strokeLinecap="round" opacity={bandOpacity("green")} />
      {/* 90% target tick + label */}
      <line x1={tickInner.x} y1={tickInner.y} x2={tickOuter.x} y2={tickOuter.y} stroke="#e2e8f0" strokeWidth="2" />
      <text x={tickOuter.x} y={tickOuter.y - 4} textAnchor="middle" fontSize="8" fontWeight="600" fill="#cbd5e1">90%</text>
      {/* scale endpoints */}
      <text x={toXY(0).x} y={toXY(0).y + 14} textAnchor="middle" fontSize="8" fill="#64748b">0%</text>
      <text x={toXY(100).x} y={toXY(100).y + 14} textAnchor="middle" fontSize="8" fill="#64748b">100%</text>
      {/* needle */}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={bandColor(pct)} strokeWidth="3" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="5" fill={bandColor(pct)} />
      {/* center value */}
      <text x={cx} y={cy - 26} textAnchor="middle" fontSize="26" fontWeight="700" fill={bandColor(pct)}>
        {pct === null ? "—" : `${pct}%`}
      </text>
      <text x={cx} y={cy - 10} textAnchor="middle" fontSize="9" fill="#94a3b8">
        90-day persistency
      </text>
      {/* target label */}
      <text x={tickOuter.x + 2} y={tickOuter.y - 4} fontSize="8" fill="#cbd5e1">90% target</text>
    </svg>
  );
}

// Placement = submitted apps whose first premium drafted (paid-to moved past
// effective). Persistency = of policies that went active in a month, the share
// still active today. The gauge surfaces the *current 90-day* number (the
// 3-months-ago cohort: policies old enough to have had their 3rd draw).
interface CarrierBreakdownRow {
  carrier: string;
  total_policies: number;
  seasoned: number;
  drafted_first: number;
  retained: number;
  retention_pct: number | null;
}

export default function QualityMetrics({
  agencyId = null,
  agencyName = null,
  agencyNames = null,
}: {
  agencyId?: string | null;
  agencyName?: string | null;
  agencyNames?: string[] | null;
}) {
  const [retention, setRetention] = useState<Retention90d | null>(null);
  const [placement, setPlacement] = useState<PlacementRow[]>([]);
  const [persistency, setPersistency] = useState<PersistencyRow[]>([]);
  const [carrierBreakdown, setCarrierBreakdown] = useState<CarrierBreakdownRow[]>([]);
  const [carrierFilter, setCarrierFilter] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Option A: computed live on Max's production DB (single source of truth).
        // Scoped by writing number server-side (agencyId | agencyName | agencyNames).
        const data = await getQualityMetricsDirect(agencyId, agencyName, agencyNames, carrierFilter);
        if (cancelled) return;
        setRetention((data.retention_90d as Retention90d) || null);
        setPlacement((data.placement as PlacementRow[]) || []);
        setPersistency((data.persistency as PersistencyRow[]) || []);
        setCarrierBreakdown((data.carrier_breakdown as CarrierBreakdownRow[]) || []);
        setLoaded(true);
      } catch {
        if (!cancelled) setLoaded(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agencyId, agencyName, agencyNames, carrierFilter]);

  if (!loaded || (!retention && placement.length === 0 && persistency.every((p) => !p.went_active))) return null;

  const fmtPct = (v: number | null) => (v === null || v === undefined ? "—" : `${v}%`);
  const monthLabel = (ym: string) => {
    const [y, m] = ym.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short" });
  };

  // "Current 90-day persistency" = the 3-months-ago cohort.
  const current = persistency.find((p) => p.months_ago === 3);

  return (
    <div className="bg-navy rounded-xl border border-slate-700/50 p-5 mt-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-white">Book Quality</h3>
        {/* Carrier filter — only show when there are multiple carriers */}
        {carrierBreakdown.length > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCarrierFilter(null)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                carrierFilter === null
                  ? "bg-blue-600 text-white"
                  : "bg-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              All Carriers
            </button>
            {carrierBreakdown.map((cb) => (
              <button
                key={cb.carrier}
                onClick={() => setCarrierFilter(cb.carrier)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  carrierFilter === cb.carrier
                    ? "bg-blue-600 text-white"
                    : "bg-slate-800 text-slate-400 hover:text-slate-200"
                }`}
              >
                {cb.carrier}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="text-xs text-slate-400 mb-4">
        90-day retention (north-star): of policies that drafted a 1st premium, the share that also
        retained through the 3rd draft (a single successful draft on non-monthly billing counts as
        retained). Placement: of apps that have reached their effective date, the share that drafted
        their first premium. Live from production.
      </p>
      {/* Carrier breakdown mini-cards — show when combined view and multiple carriers */}
      {!carrierFilter && carrierBreakdown.length > 1 && (
        <div className="grid grid-cols-2 gap-2 mb-4">
          {carrierBreakdown.map((cb) => (
            <div
              key={cb.carrier}
              className="rounded-lg bg-slate-800/50 border border-slate-700/50 p-3 cursor-pointer hover:border-blue-500/50 transition-colors"
              onClick={() => setCarrierFilter(cb.carrier)}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-white">{cb.carrier}</span>
                <span className="text-[10px] text-slate-500">{cb.total_policies} policies</span>
              </div>
              <div className="flex items-center gap-3">
                <div>
                  <div className="text-lg font-bold" style={{ color: bandColor(cb.retention_pct) }}>
                    {cb.retention_pct !== null ? `${cb.retention_pct}%` : "—"}
                  </div>
                  <div className="text-[10px] text-slate-500">90d retention</div>
                </div>
                <div className="text-[10px] text-slate-500">
                  {cb.seasoned > 0
                    ? `${cb.retained}/${cb.drafted_first} retained`
                    : "No seasoned policies"}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div className="flex flex-col">
          <h4 className="text-xs uppercase tracking-wider text-slate-400 mb-2">90-Day Retention</h4>
          <PersistencyGauge value={retention ? retention.retention_pct : null} />
          <p className="text-[11px] text-slate-400 text-center mt-1">
            {retention && retention.drafted_first
              ? `${retention.retained}/${retention.drafted_first} policies retained through the 3rd draft`
              : "Not enough seasoned policies yet"}
          </p>
          {current && current.went_active ? (
            <p className="text-[10px] text-slate-500 text-center mt-1">
              Cohort survival (still active today): {fmtPct(current.persistency_pct)} · {current.still_active}/{current.went_active} from {monthLabel(current.cohort_month)}
            </p>
          ) : null}
        </div>
        <div>
          <h4 className="text-xs uppercase tracking-wider text-slate-400 mb-2">Placement (last 3 months)</h4>
          <div className="grid grid-cols-3 gap-2">
            {placement.map((p) => (
              <div key={p.month} className="rounded-lg bg-slate-800/50 border border-slate-700/50 p-3 text-center">
                <div className="text-lg font-bold" style={{ color: bandColor(p.placement_pct) }}>{fmtPct(p.placement_pct)}</div>
                <div className="text-[11px] text-slate-400">
                  {monthLabel(p.month)} · {p.placed}/{p.eligible}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
