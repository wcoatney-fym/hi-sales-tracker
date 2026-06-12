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

// Placement = submitted apps whose first premium drafted (paid-to moved past
// effective). Persistency = of policies that went active in the cohort month,
// the share still active today.
export default function QualityMetrics({
  agencyId = null,
  agencyName = null,
}: {
  agencyId?: string | null;
  agencyName?: string | null;
}) {
  const [placement, setPlacement] = useState<PlacementRow[]>([]);
  const [persistency, setPersistency] = useState<PersistencyRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getQualityMetrics(agencyId, agencyName);
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
  }, [agencyId, agencyName]);

  if (!loaded || (placement.length === 0 && persistency.every((p) => !p.went_active))) return null;

  const fmtPct = (v: number | null) => (v === null || v === undefined ? "—" : `${v}%`);
  const monthLabel = (ym: string) => {
    const [y, m] = ym.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short" });
  };

  return (
    <div className="bg-navy rounded-xl border border-slate-700/50 p-5 mt-6">
      <h3 className="text-sm font-semibold text-white mb-1">Book Quality</h3>
      <p className="text-xs text-slate-400 mb-4">
        Placement: of apps that have reached their effective date, the share that drafted their first
        premium (future-dated policies are excluded until their start date). Persistency: of policies
        that went active in a month, the share still active today.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <h4 className="text-xs uppercase tracking-wider text-slate-400 mb-2">Placement</h4>
          <div className="grid grid-cols-3 gap-2">
            {placement.map((p) => (
              <div key={p.month} className="rounded-lg bg-slate-800/50 border border-slate-700/50 p-3 text-center">
                <div className="text-lg font-bold text-gold">{fmtPct(p.placement_pct)}</div>
                <div className="text-[11px] text-slate-400">
                  {monthLabel(p.month)} · {p.placed}/{p.eligible}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h4 className="text-xs uppercase tracking-wider text-slate-400 mb-2">Persistency</h4>
          <div className="grid grid-cols-4 gap-2">
            {persistency.map((p) => (
              <div key={p.months_ago} className="rounded-lg bg-slate-800/50 border border-slate-700/50 p-3 text-center">
                <div className="text-lg font-bold text-gold">{fmtPct(p.persistency_pct)}</div>
                <div className="text-[11px] text-slate-400">
                  Mo {p.months_ago} · n={p.went_active}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
