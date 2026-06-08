export interface LeaderboardEntry {
  rank: number;
  agentId: string | null;
  firstName: string;
  lastName: string;
  agentNumber: string;
  carrier: string;
  agencyName?: string;
  policies: number;
  commission: number;
  annualPremium: number;
  tokens: number;
  weeklyPolicies: number;
  policyClub: "10" | "15" | null;
  xp: number;
  level: number;
  tier: string;
  currentStreak: number;
  totalPoliciesAllTime: number;
  badges: string[];
  rankChange: number;
}

export interface LeaderboardData {
  leaderboard: LeaderboardEntry[];
  battles: [number, number][];
  resetTime: string;
  period: string;
  periodKey: string;
}

export interface Challenge {
  id: string;
  type: "daily" | "weekly" | "monthly" | "team";
  title: string;
  description: string;
  target_value: number;
  reward_xp: number;
  reward_badge_slug: string | null;
  start_date: string;
  end_date: string;
  is_active: boolean;
  teamProgress?: number;
}

export interface BadgeDefinition {
  id: string;
  slug: string;
  label: string;
  description: string;
  icon_key: string;
  category: string;
  requirement_description: string;
}

export interface AgentChallenge extends Challenge {
  agentProgress: number;
  agentCompleted: boolean;
  agentCompletedAt: string | null;
}

export type TimePeriod = "daily" | "weekly" | "monthly";

export interface Incentive {
  id: string;
  period_type: "daily" | "weekly" | "monthly" | "yearly";
  title: string;
  goal_tokens: number;
  incentive: string;
  start_date: string;
  end_date: string;
  sort_order: number;
}

export interface IncentiveStanding {
  rank: number;
  agentName: string;
  tokens: number;
}

export const TIER_ICONS: Record<string, string> = {
  Rookie: "Shield",
  Bronze: "Medal",
  Silver: "Star",
  Gold: "Crown",
  Platinum: "Gem",
  Diamond: "Diamond",
};

export const TIER_CONFIG: Record<string, { color: string; ringClass: string; textClass: string }> = {
  Rookie: { color: "#6b7280", ringClass: "ring-gray-500", textClass: "text-gray-400" },
  Bronze: { color: "#CD7F32", ringClass: "ring-amber-700", textClass: "text-amber-700" },
  Silver: { color: "#C0C0C0", ringClass: "ring-slate-300", textClass: "text-slate-300" },
  Gold: { color: "#d4a84b", ringClass: "ring-gold", textClass: "text-gold" },
  Platinum: { color: "#e5e7eb", ringClass: "ring-white", textClass: "text-white" },
  Diamond: { color: "#60a5fa", ringClass: "ring-blue-400", textClass: "text-blue-400" },
};

export interface QualitySnapshot {
  first_effective_date: string | null;
  policies_taken: number;
  policies_taken_ytd: number;
  retention_30d: number | null;
  retention_30d_eligible: boolean;
  retention_30d_eligible_date: string | null;
  retention_90d: number | null;
  retention_90d_eligible: boolean;
  retention_90d_eligible_date: string | null;
  persistency_9mo: number | null;
  persistency_9mo_eligible: boolean;
  persistency_9mo_eligible_date: string | null;
  persistency_13mo: number | null;
  persistency_13mo_eligible: boolean;
  persistency_13mo_eligible_date: string | null;
  attention_rate: number | null;
}

export interface AgentGoal {
  monthly_ap_target: number;
  updated_at: string;
}

export type AttentionState = "got_it" | "working" | "done";

export const BADGE_ICONS: Record<string, string> = {
  "first-blood": "Rocket",
  "on-fire": "Flame",
  "lightning-round": "Zap",
  "weekly-champion": "Crown",
  "monthly-dominator": "Trophy",
  "high-roller": "Gem",
  "sharpshooter": "Target",
  "apex-predator": "Shield",
  "rising-star": "TrendingUp",
  "comeback-kid": "RefreshCw",
  "team-player": "Users",
  "centurion": "Award",
};
