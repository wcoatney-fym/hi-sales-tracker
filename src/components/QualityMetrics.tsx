import { useEffect, useState } from "react";
import { getQualityMetrics } from "../lib/api";

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
    const large = to - from > 50 ? 1 : 0;
    return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`;
  };
  const needleAngle = pct === null ? Math.PI / 2 : Math.PI * (1 - pct / 100);
  const nx = cx + (r - 12) * Math.cos(needleAngle);
  const ny = cy - (r - 12) * Math.sin(needleAngle);
  const tick = toXY(90); // target marker at 90%
  const tickInner = { x: cx + (r - 14) * Math.cos(Math.PI * (1 - 90 / 100)), y: cy - (r - 14) * Math.sin(Math.PI * (1 - 90 / 100)) };

  return (
    <svg viewBox="0 0 200 120" className="w-full max-w-[260px] mx-auto">
      {/* colored bands: red 0-80, amber 80-90, green 90-100 */}
      <path d={arc(0, 80)} fill="none" stroke="#ef4444" strokeWidth="12" strokeLinecap="round" opacity="0.35" />
      <path d={arc(80, 90)} fill="none" stroke="#f59e0b" strokeWidth="12" opacity="0.35" />
      <path d={arc(90, 100)} fill="none" stroke="#22c55e" strokeWidth="12" strokeLinecap="round" opacity="0.35" />
      {/* 90% target tick */}
      <line x1={tickInner.x} y1={tickInner.y} x2={tick.x} y2={tick.y} stroke="#e2e8f0" strokeWidth="2" />
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
      <text x={tick.x + 2} y={tick.y - 4} fontSize="8" fill="#cbd5e1">90% target</text>
    </svg>
  );
}

// Placement = submitted apps whose first premium drafted (paid-to moved past
// effective). Persistency = of policies that went active in a month, the share
// still active today. The gauge surfaces the *current 90-day* number (the
// 3-months-ago cohort: policies old enough to have had their 3rd draw).
export default function QualityMetrics({
  agencyId = null,
  agencyName = null,
  agencyNames = null,
}: {
  agencyId?: string | null;
  agencyName?: string | null;
  agencyNames?: string[] | null;
}) {
  const [placement, setPlacement] = useState<PlacementRow[]>([]);
  const [persistency, setPersistency] = useState<PersistencyRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getQualityMetrics(agencyId, agencyName, agencyNames);
        if (cancelled) return;
        setPlacement((data.placement as PlacementRow[]) || []);
        setPersistency((data.persistency as PersistencyRow[]) || []);
        setLoaded(true);
      } catch {
        if (!cancelled) setLoaded(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agencyId, agencyName, agencyNames]);

  if (!loaded || (placement.length === 0 && persistency.every((p) => !p.went_active))) return null;

  const fmtPct = (v: number | null) => (v === null || v === undefined ? "—" : `${v}%`);
  const monthLabel = (ym: string) => {
    const [y, m] = ym.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short" });
  };

  // "Current 90-day persistency" = the 3-months-ago cohort.
  const current = persistency.find((p) => p.months_ago === 3);

  return (
    <div className="bg-navy rounded-xl border border-slate-700/50 p-5 mt-6">
      <h3 className="text-sm font-semibold text-white mb-1">Book Quality</h3>
      <p className="text-xs text-slate-400 mb-4">
        Placement: of apps that have reached their effective date, the share that drafted their first
        premium (future-dated policies are excluded until their start date). Persistency: of policies
        that went active, the share still active today.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div className="flex flex-col">
          <h4 className="text-xs uppercase tracking-wider text-slate-400 mb-2">90-Day Persistency</h4>
          <PersistencyGauge value={current ? current.persistency_pct : null} />
          <p className="text-[11px] text-slate-400 text-center mt-1">
            {current && current.went_active
              ? `${current.still_active}/${current.went_active} policies from ${monthLabel(current.cohort_month)} still active`
              : "Not enough seasoned policies yet"}
          </p>
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
