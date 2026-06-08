export interface IntakeFormData {
  agentFirstName: string;
  agentLastName: string;
  carrier: string;
  agentNumber: string;
  npn: string;
  productType: string;
  clientFirstName: string;
  clientLastName: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  planName: string;
  policyEffectiveDate: string;
  planPremium: string;
  appSubmitDate: string;
}

export interface FormSubmission {
  id: string;
  agent_first_name: string;
  agent_last_name: string;
  carrier: string;
  agent_number: string;
  product_type: string;
  client_first_name: string;
  client_last_name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  plan_name: string;
  policy_effective_date: string;
  plan_premium: number;
  status: string;
  created_at: string;
}

export interface RosterUpload {
  id: string;
  carrier: "UNL" | "GTL";
  filename: string;
  agent_count: number;
  is_active: boolean;
  uploaded_by: string;
  created_at: string;
}

export interface AgentRow {
  firstName: string;
  lastName: string;
  npn: string;
  unlWritingNumber: string;
  gtlWritingNumber: string;
  source: string;
  agency: string;
  agentTableId: string | null;
  rosterEntryIds: string[];
}

export interface RosterStatus {
  unl: { count: number };
  gtl: { count: number };
}

