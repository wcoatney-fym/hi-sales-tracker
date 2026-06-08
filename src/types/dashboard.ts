export type DatePreset = "thisMonth" | "today" | "past7" | "lastMonth" | "pastYear" | "thisQuarter" | "past6Months" | "allTime" | "custom";

export interface DateRange {
  startDate: string;
  endDate: string;
  label: string;
}

export interface KpiData {
  totalRevenue: number;
  policiesSold: number;
  avgPolicyValue: number;
  activeAgents: number;
  newClients: number;
  revenuePerAgent: number;
  prevTotalRevenue: number;
  prevPoliciesSold: number;
  prevAvgPolicyValue: number;
  prevActiveAgents: number;
  prevNewClients: number;
  prevRevenuePerAgent: number;
}

export interface ChartDataPoint {
  date: string;
  revenue: number;
  policies: number;
}

export interface AgentPerformance {
  agentFirstName: string;
  agentLastName: string;
  agentNumber: string;
  carrier: string;
  policiesSold: number;
  totalSales: number;
  avgPolicyValue: number;
}


export interface PolicyRow {
  id: string;
  agent_first_name: string;
  agent_last_name: string;
  agent_number: string;
  carrier: string;
  product_type: string;
  client_first_name: string;
  client_last_name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  plan_name: string;
  plan_premium: number;
  policy_effective_date: string;
  status: string;
  created_at: string;
  app_submit_date: string | null;
  policy_number: string | null;
  agency: string | null;
  source: string;
}
