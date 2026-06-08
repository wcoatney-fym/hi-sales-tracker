import { useState, useEffect, useCallback } from "react";
import { Coins, Save, Loader2, Clock, Flame, Calendar } from "lucide-react";
import { adminGetAgentTokens, adminUpdateAgentTalkTime } from "../../lib/api";

interface TokenRow {
  id: string;
  agent_id: string;
  tokens_total: number;
  tokens_talk_time: number;
  tokens_policies: number;
  talk_time_minutes: number;
  agents: { id: string; first_name: string; last_name: string };
}

interface DailyLog {
  agent_id: string;
  date: string;
  minutes: number;
}

interface TokensPanelProps {
  token: string;
}

function computeTalkTimeStreak(dailyLogs: DailyLog[], agentId: string): number {
  const THRESHOLD = 240;
  const entries = dailyLogs
    .filter((d) => d.agent_id === agentId)
    .reduce<Record<string, number>>((acc, d) => {
      acc[d.date] = d.minutes;
      return acc;
    }, {});

  function isWorkDay(d: Date): boolean {
    const day = d.getDay();
    return day !== 0 && day !== 6;
  }

  function prevDay(d: Date): Date {
    const p = new Date(d);
    p.setDate(p.getDate() - 1);
    return p;
  }

  function toDateStr(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  let cursor = new Date();
  if (isWorkDay(cursor) && (entries[toDateStr(cursor)] || 0) < THRESHOLD) {
    cursor = prevDay(cursor);
  }
  while (!isWorkDay(cursor)) {
    cursor = prevDay(cursor);
  }

  let streak = 0;
  while (true) {
    while (!isWorkDay(cursor)) {
      cursor = prevDay(cursor);
    }
    if ((entries[toDateStr(cursor)] || 0) >= THRESHOLD) {
      streak++;
      cursor = prevDay(cursor);
    } else {
      break;
    }
  }
  return streak;
}

export default function TokensPanel({ token }: TokensPanelProps) {
  const [rows, setRows] = useState<TokenRow[]>([]);
  const [dailyLogs, setDailyLogs] = useState<DailyLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [editedMinutes, setEditedMinutes] = useState<Record<string, string>>({});
  const [editedDates, setEditedDates] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  const today = new Date().toISOString().slice(0, 10);

  const fetchTokens = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminGetAgentTokens(token);
      setRows(res.tokens || []);
      setDailyLogs(res.dailyTalkTime || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  const handleSave = async (agentId: string) => {
    const minutes = parseInt(editedMinutes[agentId] || "0") || 0;
    const date = editedDates[agentId] || today;
    setSaving((prev) => ({ ...prev, [agentId]: true }));
    try {
      await adminUpdateAgentTalkTime(token, agentId, minutes, date);
      await fetchTokens();
      setEditedMinutes((prev) => {
        const next = { ...prev };
        delete next[agentId];
        return next;
      });
      setEditedDates((prev) => {
        const next = { ...prev };
        delete next[agentId];
        return next;
      });
    } catch { /* ignore */ }
    setSaving((prev) => ({ ...prev, [agentId]: false }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-slate-500" size={24} />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Coins size={18} className="text-amber-400" />
        <h3 className="text-lg font-bold text-white">Agent Token Management</h3>
      </div>
      <p className="text-sm text-slate-400 mb-2">
        Tokens are earned from policies (10/policy) and talk time (1/minute).
        Streak multipliers boost earnings up to 10x.
      </p>
      <div className="flex gap-4 mb-4 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <Flame size={12} className="text-orange-400" />
          Sales Streak: consecutive workdays with 1+ policy sold (multiplies policy tokens)
        </span>
        <span className="flex items-center gap-1">
          <Clock size={12} className="text-sky-400" />
          Talk Time Streak: consecutive workdays with 4+ hours logged (multiplies talk time tokens)
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-700/50">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-800/50 border-b border-slate-700/50">
              <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-400 uppercase">Agent</th>
              <th className="text-right py-2.5 px-3 text-xs font-semibold text-slate-400 uppercase">Policy Tkns</th>
              <th className="text-right py-2.5 px-3 text-xs font-semibold text-slate-400 uppercase">Talk Tkns</th>
              <th className="text-right py-2.5 px-3 text-xs font-semibold text-slate-400 uppercase">Total</th>
              <th className="text-center py-2.5 px-3 text-xs font-semibold text-slate-400 uppercase">Sales Streak</th>
              <th className="text-center py-2.5 px-3 text-xs font-semibold text-slate-400 uppercase">Talk Streak</th>
              <th className="text-center py-2.5 px-3 text-xs font-semibold text-slate-400 uppercase">Date</th>
              <th className="text-center py-2.5 px-3 text-xs font-semibold text-slate-400 uppercase">Minutes</th>
              <th className="text-center py-2.5 px-3 text-xs font-semibold text-slate-400 uppercase w-20"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-slate-500">
                  No token data yet. Tokens will be computed when the leaderboard loads.
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const agentName = `${row.agents.first_name} ${row.agents.last_name}`;
              const isEdited = editedMinutes[row.agent_id] !== undefined;
              const talkStreak = computeTalkTimeStreak(dailyLogs, row.agent_id);
              const todayLog = dailyLogs.find((d) => d.agent_id === row.agent_id && d.date === today);
              return (
                <tr key={row.id} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                  <td className="py-2.5 px-3 font-medium text-white">{agentName}</td>
                  <td className="py-2.5 px-3 text-right text-slate-300">{row.tokens_policies}</td>
                  <td className="py-2.5 px-3 text-right text-slate-300">{row.tokens_talk_time}</td>
                  <td className="py-2.5 px-3 text-right font-bold text-amber-300">{row.tokens_total}</td>
                  <td className="py-2.5 px-3 text-center">
                    <span className="text-orange-400 font-semibold">--</span>
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    {talkStreak >= 2 ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 text-xs font-bold">
                        <Flame size={10} /> {talkStreak}x
                      </span>
                    ) : (
                      <span className="text-slate-500 text-xs">{talkStreak === 1 ? "1 day" : "none"}</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center justify-center gap-1">
                      <Calendar size={12} className="text-slate-500" />
                      <input
                        type="date"
                        className="w-32 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-white text-center"
                        value={editedDates[row.agent_id] || today}
                        onChange={(e) =>
                          setEditedDates((prev) => ({ ...prev, [row.agent_id]: e.target.value }))
                        }
                      />
                    </div>
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center justify-center gap-1">
                      <Clock size={12} className="text-slate-500" />
                      <input
                        type="number"
                        min={0}
                        placeholder={todayLog ? todayLog.minutes.toString() : "0"}
                        className="w-20 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-white text-center"
                        value={isEdited ? editedMinutes[row.agent_id] : ""}
                        onChange={(e) =>
                          setEditedMinutes((prev) => ({ ...prev, [row.agent_id]: e.target.value }))
                        }
                      />
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    {isEdited && (
                      <button
                        onClick={() => handleSave(row.agent_id)}
                        disabled={saving[row.agent_id]}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium disabled:opacity-50"
                      >
                        {saving[row.agent_id] ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Save size={12} />
                        )}
                        Save
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
