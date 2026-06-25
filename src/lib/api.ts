const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const baseHeaders = {
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
};

async function callApi(
  functionName: string,
  body: Record<string, unknown>
) {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/${functionName}`,
    {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify(body),
    }
  );

  let data: Record<string, unknown>;
  try {
    data = await response.json();
  } catch {
    if (response.status === 504 || response.status === 502) {
      throw new Error("Server timed out processing this request. Please try again.");
    }
    throw new Error(`Server error (${response.status}). Please try again.`);
  }

  if (!response.ok) {
    if (
      response.status === 401 &&
      body.action !== "login" &&
      body.action !== "logout" &&
      body.action !== "verify-session"
    ) {
      localStorage.removeItem("admin_token");
      localStorage.removeItem("admin_email");
      localStorage.removeItem("admin_role");
      localStorage.removeItem("admin_agency_slug");
      localStorage.removeItem("admin_agency_id");
      window.location.href = "/admin";
      throw new Error("Session expired. Redirecting to login...");
    }
    throw new Error((data.error as string) || "Request failed");
  }

  return data;
}

export async function verifyAgent(
  firstName: string,
  lastName: string,
  carrier: string
) {
  return callApi("public-api", {
    action: "verify-agent",
    firstName,
    lastName,
    carrier,
  });
}

export async function submitForm(formData: Record<string, unknown>) {
  return callApi("public-api", { action: "submit-form", formData });
}

export async function getLeadFormConfig() {
  return callApi("public-api", { action: "get-lead-form-config" });
}

export async function submitLead(formData: Record<string, unknown>) {
  return callApi("public-api", { action: "submit-lead", formData });
}

export async function adminGetLeadVendors(token: string) {
  return callApi("admin-api", { action: "get-lead-vendors", token });
}

export async function adminCreateLeadVendor(token: string, name: string) {
  return callApi("admin-api", { action: "create-lead-vendor", token, name });
}

export async function adminUpdateLeadVendor(token: string, id: string, updates: { name?: string; is_active?: boolean }) {
  return callApi("admin-api", { action: "update-lead-vendor", token, id, ...updates });
}

export async function adminDeleteLeadVendor(token: string, id: string) {
  return callApi("admin-api", { action: "delete-lead-vendor", token, id });
}

export async function adminToggleLeadForm(token: string, enabled: boolean) {
  return callApi("admin-api", { action: "toggle-lead-form", token, enabled });
}

export async function adminGetLeadFormStatus(token: string) {
  return callApi("admin-api", { action: "get-lead-form-status", token });
}

export async function adminGetLeadSubmissions(token: string, opts: { page?: number; pageSize?: number; search?: string; startDate?: string; endDate?: string } = {}) {
  return callApi("admin-api", { action: "get-lead-submissions", token, ...opts });
}

export async function adminLogin(email: string, password: string) {
  return callApi("admin-api", { action: "login", email, password });
}

export async function adminUploadRoster(
  token: string,
  carrier: string,
  agents: Record<string, string>[],
  filename: string
) {
  return callApi("admin-api", {
    action: "upload-roster",
    token,
    carrier,
    agents,
    filename,
  });
}

export async function adminGetRosterUploads(token: string, carrier?: string) {
  return callApi("admin-api", {
    action: "get-roster-uploads",
    token,
    ...(carrier ? { carrier } : {}),
  });
}

export async function adminActivateRoster(token: string, uploadId: string) {
  return callApi("admin-api", {
    action: "activate-roster",
    token,
    uploadId,
  });
}

export async function adminDeleteRosterUpload(token: string, uploadId: string) {
  return callApi("admin-api", {
    action: "delete-roster-upload",
    token,
    uploadId,
  });
}

export async function adminGetSubmissions(token: string) {
  return callApi("admin-api", { action: "get-submissions", token });
}

export async function adminGetRosterStatus(token: string) {
  return callApi("admin-api", { action: "get-roster-status", token });
}

export async function adminGetDashboardKpis(
  token: string,
  startDate: string,
  endDate: string,
  prevStartDate: string,
  prevEndDate: string,
  agencyFilter?: string,
  agencies?: string[],
  agentNumber?: string
) {
  return callApi("admin-api", {
    action: "get-dashboard-kpis",
    token,
    startDate,
    endDate,
    prevStartDate,
    prevEndDate,
    agencyFilter: agencyFilter || undefined,
    agencies: agencies || undefined,
    agentNumber: agentNumber || undefined,
  });
}

export async function adminGetPolicyStatusKpis(
  token: string,
  referenceDate: string,
  agencyFilter?: string,
  agencies?: string[],
  agentNumber?: string
) {
  return callApi("admin-api", {
    action: "policy-status-kpis",
    token,
    referenceDate,
    agencyFilter: agencyFilter || undefined,
    agencies: agencies || undefined,
    agentNumber: agentNumber || undefined,
  });
}

export async function adminGetSalesChart(
  token: string,
  startDate: string,
  endDate: string,
  agencyFilter?: string,
  agencies?: string[],
  agentNumber?: string
) {
  return callApi("admin-api", {
    action: "get-sales-chart",
    token,
    startDate,
    endDate,
    agencyFilter: agencyFilter || undefined,
    agencies: agencies || undefined,
    agentNumber: agentNumber || undefined,
  });
}

export async function adminGetAgentLeaderboard(
  token: string,
  startDate: string,
  endDate: string,
  agencyFilter?: string
) {
  return callApi("admin-api", {
    action: "get-agent-leaderboard",
    token,
    startDate,
    endDate,
    agencyFilter: agencyFilter || undefined,
  });
}

export async function adminGetAgencies(token: string) {
  return callApi("admin-api", {
    action: "get-agencies",
    token,
  });
}

export async function adminGetPolicies(
  token: string,
  startDate: string,
  endDate: string,
  page: number,
  pageSize: number,
  agentFilter?: string,
  carrierFilter?: string,
  productTypeFilter?: string,
  agencyFilter?: string,
  sourceFilter?: string,
  clientSearch?: string
) {
  return callApi("admin-api", {
    action: "get-policies",
    token,
    startDate,
    endDate,
    page,
    pageSize,
    ...(agentFilter ? { agentFilter } : {}),
    ...(carrierFilter ? { carrierFilter } : {}),
    ...(productTypeFilter ? { productTypeFilter } : {}),
    ...(agencyFilter ? { agencyFilter } : {}),
    ...(sourceFilter ? { sourceFilter } : {}),
    ...(clientSearch ? { clientSearch } : {}),
  });
}

export async function adminExportAllPolicies(
  token: string,
  startDate: string,
  endDate: string,
  agentFilter?: string,
  carrierFilter?: string,
  productTypeFilter?: string,
  agencyFilter?: string
) {
  return callApi("admin-api", {
    action: "export-policies",
    token,
    startDate,
    endDate,
    ...(agentFilter ? { agentFilter } : {}),
    ...(carrierFilter ? { carrierFilter } : {}),
    ...(productTypeFilter ? { productTypeFilter } : {}),
    ...(agencyFilter ? { agencyFilter } : {}),
  });
}

export async function adminDeletePolicies(token: string, ids: string[]) {
  return callApi("admin-api", { action: "delete-policies", token, ids });
}

export async function adminExportLeaderboard(
  token: string,
  startDate: string,
  endDate: string,
  agencyFilter?: string
) {
  return callApi("admin-api", {
    action: "export-leaderboard",
    token,
    startDate,
    endDate,
    ...(agencyFilter ? { agencyFilter } : {}),
  });
}

export async function adminGetIntakeSubmissions(
  token: string,
  startDate: string,
  endDate: string,
  page: number,
  pageSize: number,
  agentFilter?: string,
  npnFilter?: string,
  agencyFilter?: string
) {
  return callApi("admin-api", {
    action: "get-intake-submissions",
    token,
    startDate,
    endDate,
    page,
    pageSize,
    ...(agentFilter ? { agentFilter } : {}),
    ...(npnFilter ? { npnFilter } : {}),
    ...(agencyFilter ? { agencyFilter } : {}),
  });
}

export async function adminExportIntakeSubmissions(
  token: string,
  startDate: string,
  endDate: string,
  agentFilter?: string,
  npnFilter?: string,
  agencyFilter?: string
) {
  return callApi("admin-api", {
    action: "export-intake-submissions",
    token,
    startDate,
    endDate,
    ...(agentFilter ? { agentFilter } : {}),
    ...(npnFilter ? { npnFilter } : {}),
    ...(agencyFilter ? { agencyFilter } : {}),
  });
}

export async function adminUpdateIntakeSubmission(
  token: string,
  submissionId: string,
  updates: Record<string, unknown>,
  editedBy?: string
) {
  return callApi("admin-api", {
    action: "update-intake-submission",
    token,
    submissionId,
    updates,
    ...(editedBy ? { editedBy } : {}),
  });
}

export async function adminGetAgents(token: string) {
  return callApi("admin-api", { action: "get-agents", token });
}

export async function adminResyncAgents(token: string) {
  return callApi("admin-api", { action: "resync-agents", token });
}

export async function adminUpdateAgent(
  token: string,
  agentTableId: string | null,
  rosterEntryIds: string[],
  fields: {
    firstName: string;
    lastName: string;
    npn: string;
    unlWritingNumber: string;
    gtlWritingNumber: string;
    agency: string;
  }
) {
  return callApi("admin-api", {
    action: "update-agent",
    token,
    agentTableId,
    rosterEntryIds,
    ...fields,
  });
}

export async function adminDeleteAgent(
  token: string,
  agentTableId: string | null,
  rosterEntryIds: string[]
) {
  return callApi("admin-api", {
    action: "delete-agent",
    token,
    agentTableId,
    rosterEntryIds,
  });
}


export async function adminCreateAgent(
  token: string,
  fields: {
    firstName: string;
    lastName: string;
    npn: string;
    unlWritingNumber: string;
    gtlWritingNumber: string;
    agency: string;
  }
) {
  return callApi("admin-api", {
    action: "create-agent",
    token,
    ...fields,
  });
}

export async function adminBulkFixNames(
  token: string,
  corrections: {
    agentTableId: string | null;
    rosterEntryIds: string[];
    firstName: string;
    lastName: string;
  }[]
) {
  return callApi("admin-api", {
    action: "bulk-fix-names",
    token,
    corrections,
  });
}

export async function adminLogout(token: string) {
  return callApi("admin-api", { action: "logout", token });
}

export async function adminVerifySession(token: string) {
  return callApi("admin-api", { action: "verify-session", token });
}

export async function adminGetAgencyBreakdown(
  token: string,
  startDate: string,
  endDate: string,
  prevStartDate: string,
  prevEndDate: string
) {
  return callApi("admin-api", {
    action: "get-agency-breakdown",
    token,
    startDate,
    endDate,
    prevStartDate,
    prevEndDate,
  });
}

export async function adminGetAgentBreakdown(
  token: string,
  startDate: string,
  endDate: string,
  prevStartDate: string,
  prevEndDate: string,
  agencyFilter?: string
) {
  return callApi("admin-api", {
    action: "get-agent-breakdown",
    token,
    startDate,
    endDate,
    prevStartDate,
    prevEndDate,
    agencyFilter: agencyFilter || undefined,
  });
}

export async function adminGetPlanBreakdown(
  token: string,
  startDate: string,
  endDate: string,
  agencyFilter?: string,
  agencies?: string[]
) {
  return callApi("admin-api", {
    action: "get-plan-breakdown",
    token,
    startDate,
    endDate,
    agencyFilter: agencyFilter || undefined,
    agencies: agencies || undefined,
  });
}

export async function adminGetBillingModeBreakdown(
  token: string,
  startDate: string,
  endDate: string,
  agencyFilter?: string,
  agencies?: string[],
  agentNumber?: string
) {
  return callApi("admin-api", {
    action: "billing-mode-breakdown",
    token,
    startDate,
    endDate,
    agencyFilter: agencyFilter || undefined,
    agencies: agencies || undefined,
    agentNumber: agentNumber || undefined,
  });
}

export async function adminGetEnhancedLeaderboard(
  token: string,
  startDate: string,
  endDate: string,
  agencyFilter?: string
) {
  return callApi("admin-api", {
    action: "get-enhanced-leaderboard",
    token,
    startDate,
    endDate,
    agencyFilter,
  });
}

export async function adminGetMonteCarloData(token: string, agencyFilter?: string, startDate?: string, endDate?: string, agencies?: string[]) {
  return callApi("admin-api", { action: "get-monte-carlo-data", token, agencyFilter, startDate, endDate, agencies });
}

export async function adminGetMonteCarloAgentData(token: string, agentNumber: string, startDate?: string, endDate?: string) {
  return callApi("admin-api", { action: "get-monte-carlo-agent-data", token, agentNumber, startDate, endDate });
}

export async function adminSetMonteCarloTarget(token: string, target: number | null) {
  return callApi("admin-api", { action: "set-monte-carlo-target", token, target });
}

export async function adminRefreshMonteCarlo(token: string) {
  return callApi("admin-api", { action: "refresh-monte-carlo", token });
}

// Leaderboard API (public, uses GET)
async function callLeaderboardApi(params: Record<string, string>) {
  const query = new URLSearchParams(params).toString();
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/leaderboard-api?${query}`,
    { method: "GET", headers: baseHeaders }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

export async function getLeaderboard(period: string) {
  return callLeaderboardApi({ action: "get-leaderboard", period });
}

export async function getAgencyLeaderboard(agencyId: string, period: string) {
  // Agency data requires an authorized session (admin or agent)
  const token = localStorage.getItem("admin_token") || localStorage.getItem("agent_session_token") || "";
  return callLeaderboardApi({ action: "get-agency-leaderboard", agency_id: agencyId, period, token });
}

export async function getQualityMetrics(
  agencyId?: string | null,
  agencyName?: string | null,
  agencyNames?: string[] | null,
) {
  // Quality data requires an authorized session (admin or agent)
  const token = localStorage.getItem("admin_token") || localStorage.getItem("agent_session_token") || "";
  return callLeaderboardApi({
    action: "get-quality-metrics",
    ...(agencyNames && agencyNames.length ? { agency_names: agencyNames.join(",") } : {}),
    ...(!agencyNames && agencyId ? { agency_id: agencyId } : {}),
    ...(!agencyNames && !agencyId && agencyName ? { agency_name: agencyName } : {}),
    token,
  });
}

export async function getChallenges() {
  return callLeaderboardApi({ action: "get-challenges" });
}

export async function getBadges() {
  return callLeaderboardApi({ action: "get-badges" });
}

export async function getAgentStats(agentId: string) {
  return callLeaderboardApi({ action: "get-agent-stats", agent_id: agentId });
}

// Agent Auth API
export async function agentLogin(firstName: string, lastName: string, writingNumber: string) {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/leaderboard-api?action=agent-login`,
    {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify({ firstName, lastName, writingNumber }),
    }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Login failed");
  return data;
}

export async function agentVerifySession(token: string) {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/leaderboard-api?action=agent-verify-session`,
    {
      method: "GET",
      headers: { ...baseHeaders, "X-Agent-Token": token },
    }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Session invalid");
  return data;
}

export async function agentLogout(token: string) {
  await fetch(
    `${SUPABASE_URL}/functions/v1/leaderboard-api?action=agent-logout`,
    {
      method: "GET",
      headers: { ...baseHeaders, "X-Agent-Token": token },
    }
  );
}

export async function getAgentChallenges(agentId: string) {
  return callLeaderboardApi({ action: "agent-get-challenges", agent_id: agentId });
}

// Promotions & Incentives API
export async function getActivePromotions() {
  return callLeaderboardApi({ action: "get-active-promotion" });
}

export async function getActiveIncentives() {
  return callLeaderboardApi({ action: "get-active-incentives" });
}

export async function adminGetPromotions(token: string) {
  return callApi("admin-api", { action: "get-promotions", token });
}

export async function adminCreatePromotion(
  token: string,
  data: { title: string; goal_tokens: number; incentive: string; start_date: string; end_date: string; message?: string; period_type: string; sort_order?: number }
) {
  return callApi("admin-api", { action: "create-promotion", token, ...data });
}

export async function adminUpdatePromotion(
  token: string,
  data: { id: string; title?: string; goal_tokens?: number; incentive?: string; start_date?: string; end_date?: string; message?: string; period_type?: string; sort_order?: number }
) {
  return callApi("admin-api", { action: "update-promotion", token, ...data });
}

export async function adminDeletePromotion(token: string, id: string) {
  return callApi("admin-api", { action: "delete-promotion", token, id });
}

export async function adminTogglePromotion(token: string, id: string, is_active: boolean) {
  return callApi("admin-api", { action: "toggle-promotion", token, id, is_active });
}

// Token Management API
export async function adminGetAgentTokens(token: string) {
  return callApi("admin-api", { action: "get-agent-tokens", token });
}

export async function adminUpdateAgentTalkTime(token: string, agentId: string, minutes: number, date?: string) {
  return callApi("admin-api", { action: "update-agent-talk-time", token, agentId, minutes, date });
}

// Data Sources API
export async function adminListDataSources(token: string) {
  return callApi("admin-api", { action: "list-data-sources", token });
}

export async function adminCreateDataSource(token: string, name: string, description?: string, type?: string, apiUrl?: string, apiKeySecretName?: string, pollInterval?: string, dbConfig?: { dbHost?: string; dbPort?: number; dbName?: string; dbSchema?: string; dbTable?: string; dbUser?: string; dbPasswordSecretName?: string }) {
  return callApi("admin-api", { action: "create-data-source", token, name, description, type, apiUrl, apiKeySecretName, pollInterval, ...dbConfig });
}

export async function adminUpdateDataSource(token: string, sourceId: string, updates: { name?: string; description?: string; type?: string; apiUrl?: string; apiKeySecretName?: string; pollInterval?: string; dbHost?: string; dbPort?: number; dbName?: string; dbSchema?: string; dbTable?: string; dbUser?: string; dbPasswordSecretName?: string }) {
  return callApi("admin-api", { action: "update-data-source", token, sourceId, ...updates });
}

export async function adminDeleteDataSource(token: string, sourceId: string) {
  return callApi("admin-api", { action: "delete-data-source", token, sourceId });
}

export async function adminTriggerPoll(token: string, sourceId: string) {
  return callApi("admin-api", { action: "trigger-poll", token, sourceId });
}

export async function adminTestSqlConnection(token: string, sourceId: string, dbPassword?: string) {
  return callApi("admin-api", { action: "test-sql-connection", token, sourceId, dbPassword });
}

export async function adminSqlImportCount(token: string, sourceId: string) {
  return callApi("admin-api", { action: "sql-import-count", token, sourceId });
}

export async function adminSqlImportBatch(token: string, sourceId: string, offset: number, batchSize: number) {
  return callApi("admin-api", { action: "sql-import-batch", token, sourceId, offset, batchSize });
}

export async function adminStartSqlImport(token: string, sourceId: string, carrier: string) {
  return callApi("admin-api", { action: "start-sql-import", token, sourceId, carrier });
}

export async function adminGetImportProgress(token: string, uploadId: string) {
  return callApi("admin-api", { action: "get-import-progress", token, uploadId });
}

export async function adminGetColumnMappings(token: string, sourceId: string) {
  return callApi("admin-api", { action: "get-column-mappings", token, sourceId });
}

export async function adminSaveColumnMappings(
  token: string,
  sourceId: string,
  mappings: { source_column: string; target_field: string }[]
) {
  return callApi("admin-api", { action: "save-column-mappings", token, sourceId, mappings });
}

export async function adminConfirmAutoImport(token: string, sourceId: string) {
  return callApi("admin-api", { action: "confirm-auto-import", token, sourceId });
}

export async function adminDisableAutoImport(token: string, sourceId: string) {
  return callApi("admin-api", { action: "disable-auto-import", token, sourceId });
}

export async function adminAnalyzeSourceUpload(
  token: string,
  sourceId: string,
  records: Record<string, string>[],
  carrier: string,
  filename: string
) {
  return callApi("admin-api", { action: "analyze-source-upload", token, sourceId, records, carrier, filename });
}

export async function adminProcessSourceUpload(
  token: string,
  sourceId: string,
  records: Record<string, string>[],
  carrier: string,
  mappings: Record<string, string>,
  filename: string,
  onProgress?: (chunkIndex: number, totalChunks: number) => void
) {
  const CHUNK_SIZE = 500;
  const totalChunks = Math.ceil(records.length / CHUNK_SIZE);

  if (totalChunks <= 1) {
    return callApi("admin-api", { action: "process-source-upload", token, sourceId, records, carrier, mappings, filename, isFinalChunk: true, totalRows: records.length });
  }

  let uploadId: string | null = null;
  let totalImported = 0;
  let totalErrors = 0;

  for (let i = 0; i < totalChunks; i++) {
    const chunk = records.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    const isFinalChunk = i === totalChunks - 1;
    onProgress?.(i + 1, totalChunks);

    const payload: Record<string, unknown> = {
      action: "process-source-upload",
      token,
      records: chunk,
      carrier,
      mappings,
      isFinalChunk,
      totalRows: records.length,
    };

    if (uploadId) {
      payload.uploadId = uploadId;
    } else {
      payload.sourceId = sourceId;
      payload.filename = filename;
    }

    const res = await callApi("admin-api", payload);
    if (!res.success) return res;
    if (!uploadId) uploadId = res.uploadId;
    totalImported += res.imported || 0;
    totalErrors += res.errors || 0;

    if (isFinalChunk) {
      return res;
    }
  }

  return { success: true, uploadId, imported: totalImported, errors: totalErrors, total: records.length };
}

export async function adminFinalizeSourceUpload(token: string, uploadId: string) {
  return callApi("admin-api", { action: "finalize-source-upload", token, uploadId });
}

export async function adminGetSourceUploads(token: string, sourceId: string) {
  return callApi("admin-api", { action: "get-source-uploads", token, sourceId });
}

export async function adminGetSourceRecords(token: string, uploadId: string, page?: number, pageSize?: number) {
  return callApi("admin-api", { action: "get-source-records", token, uploadId, page: page || 1, pageSize: pageSize || 50 });
}

export async function adminRevertSourceUpload(token: string, uploadId: string) {
  return callApi("admin-api", { action: "revert-source-upload", token, uploadId });
}

export async function adminDeleteSourceUpload(token: string, uploadId: string) {
  return callApi("admin-api", { action: "delete-source-upload", token, uploadId });
}

export async function adminResyncPolicies(token: string, uploadId: string, offset = 0, batchSize = 1000) {
  return callApi("admin-api", { action: "resync-policies", token, uploadId, offset, batchSize });
}

export async function adminPruneSourceRecords(token: string, dryRun = true, retentionDays = 7) {
  return callApi("admin-api", { action: "prune-source-records", token, dryRun, retentionDays });
}

export async function adminGetAtRiskAgentsSummary(token: string, agencyFilter?: string, agencies?: string[]) {
  return callApi("admin-api", { action: "at-risk-agents-summary", token, agencyFilter: agencyFilter || undefined, agencies: agencies || undefined });
}

export async function adminGetAtRiskPoliciesForAgent(token: string, agentNumber: string) {
  return callApi("admin-api", { action: "at-risk-policies-for-agent", token, agentNumber });
}

export async function adminGetAtRiskAging(token: string, agencyFilter?: string, agencies?: string[]) {
  return callApi("admin-api", { action: "at-risk-aging", token, agencyFilter: agencyFilter || undefined, agencies: agencies || undefined });
}

export async function adminGetAtRiskTrend(token: string, agencyFilter?: string, agencies?: string[]) {
  return callApi("admin-api", { action: "at-risk-trend", token, agencyFilter: agencyFilter || undefined, agencies: agencies || undefined });
}

export async function adminLogAtRiskActivity(token: string, policyId: string, actionType: string, note: string) {
  return callApi("admin-api", { action: "log-at-risk-activity", token, policyId, actionType, note });
}

export async function agentGetAtRiskPolicies(sessionToken: string) {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/leaderboard-api?action=agent-at-risk-policies`,
    { method: "GET", headers: { ...baseHeaders, "X-Agent-Token": sessionToken } }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Failed to fetch at-risk policies");
  return data;
}

export async function agentLogAtRiskActivity(sessionToken: string, policyId: string, actionType: string, note: string) {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/leaderboard-api?action=agent-log-at-risk-activity`,
    {
      method: "POST",
      headers: { ...baseHeaders, "X-Agent-Token": sessionToken },
      body: JSON.stringify({ policyId, actionType, note }),
    }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Failed to log activity");
  return data;
}

export async function agentGetDashboardStats(sessionToken: string) {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/leaderboard-api?action=agent-dashboard-stats`,
    { method: "GET", headers: { ...baseHeaders, "X-Agent-Token": sessionToken } }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Failed to fetch dashboard stats");
  return data;
}

export async function agentGetProductionHistory(sessionToken: string) {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/leaderboard-api?action=agent-production-history`,
    { method: "GET", headers: { ...baseHeaders, "X-Agent-Token": sessionToken } }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Failed to fetch production history");
  return data;
}

export async function agentGetLeaderboardPosition(sessionToken: string) {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/leaderboard-api?action=agent-leaderboard-position`,
    { method: "GET", headers: { ...baseHeaders, "X-Agent-Token": sessionToken } }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Failed to fetch leaderboard position");
  return data;
}

export async function agentGetBookSummary(sessionToken: string, page = 1, status?: string) {
  const params = new URLSearchParams({ action: "agent-book-summary", page: String(page) });
  if (status) params.set("status", status);
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/leaderboard-api?${params}`,
    { method: "GET", headers: { ...baseHeaders, "X-Agent-Token": sessionToken } }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Failed to fetch book summary");
  return data;
}

export async function agentGetQualitySnapshot(sessionToken: string) {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/leaderboard-api?action=agent-quality-snapshot`,
    { method: "GET", headers: { ...baseHeaders, "X-Agent-Token": sessionToken } }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Failed to fetch quality snapshot");
  return data;
}

export async function agentGetGoal(sessionToken: string) {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/leaderboard-api?action=agent-get-goal`,
    { method: "GET", headers: { ...baseHeaders, "X-Agent-Token": sessionToken } }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Failed to fetch goal");
  return data;
}

export async function agentSaveGoal(sessionToken: string, monthlyApTarget: number) {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/leaderboard-api?action=agent-save-goal`,
    {
      method: "POST",
      headers: { ...baseHeaders, "X-Agent-Token": sessionToken },
      body: JSON.stringify({ monthly_ap_target: monthlyApTarget }),
    }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Failed to save goal");
  return data;
}

export async function agentUpdateAttentionState(sessionToken: string, policyId: string, state: string) {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/leaderboard-api?action=agent-update-attention-state`,
    {
      method: "POST",
      headers: { ...baseHeaders, "X-Agent-Token": sessionToken },
      body: JSON.stringify({ policyId, state }),
    }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Failed to update attention state");
  return data;
}

export async function agentGetAttentionStates(sessionToken: string) {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/leaderboard-api?action=agent-get-attention-states`,
    { method: "GET", headers: { ...baseHeaders, "X-Agent-Token": sessionToken } }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Failed to fetch attention states");
  return data;
}

// --- Agency Roster Management ---

export async function agencyUploadRoster(token: string, rows: Array<Record<string, string>>, filename: string, overrideAgencyId?: string) {
  return callApi("admin-api", { action: "agency-upload-roster", token, rows, filename, overrideAgencyId });
}

export async function agencyGetRoster(token: string, statusFilter?: string, search?: string, overrideAgencyId?: string) {
  return callApi("admin-api", { action: "agency-get-roster", token, statusFilter, search, overrideAgencyId });
}

export async function agencyGetRosterUploads(token: string, overrideAgencyId?: string) {
  return callApi("admin-api", { action: "agency-get-roster-uploads", token, overrideAgencyId });
}

export async function agencyAddRosterEntry(token: string, firstName: string, lastName: string, writingNumber: string, npn: string, carrier?: string, overrideAgencyId?: string) {
  return callApi("admin-api", { action: "agency-add-roster-entry", token, firstName, lastName, writingNumber, npn, carrier, overrideAgencyId });
}

export async function agencyTerminateRosterEntry(token: string, rosterId: string, overrideAgencyId?: string) {
  return callApi("admin-api", { action: "agency-terminate-roster-entry", token, rosterId, overrideAgencyId });
}

export async function agencyReactivateRosterEntry(token: string, rosterId: string, overrideAgencyId?: string) {
  return callApi("admin-api", { action: "agency-reactivate-roster-entry", token, rosterId, overrideAgencyId });
}

export async function agencySetManager(token: string, rosterId: string, isManager: boolean) {
  return callApi("admin-api", { action: "agency-set-manager", token, rosterId, isManager });
}

export async function agencyAddWritingNumber(token: string, agentId: string, carrierName: string, writingNumber: string) {
  return callApi("admin-api", { action: "agency-add-writing-number", token, agentId, carrierName, writingNumber });
}

export async function agencyRemoveWritingNumber(token: string, writingNumberId: string) {
  return callApi("admin-api", { action: "agency-remove-writing-number", token, writingNumberId });
}

export async function adminGetFuzzyMatches(token: string) {
  return callApi("admin-api", { action: "admin-get-fuzzy-matches", token });
}

export async function adminApproveFuzzyMatch(token: string, rosterId: string, approve: boolean, linkToAgentId?: string) {
  return callApi("admin-api", { action: "admin-approve-fuzzy-match", token, rosterId, approve, linkToAgentId });
}

export async function adminGetUnassignedAgents(token: string) {
  return callApi("admin-api", { action: "admin-get-unassigned-agents", token });
}

export async function adminGetAuditIssues(token: string, status = "open") {
  return callApi("admin-api", { action: "get-audit-issues", token, status });
}

export async function adminGetAuditSummary(token: string) {
  return callApi("admin-api", { action: "get-audit-summary", token });
}

export async function adminResolveAuditIssue(token: string, issueId: string, resolution: "merge" | "dismiss") {
  return callApi("admin-api", { action: "resolve-audit-issue", token, issueId, resolution });
}

export async function adminScanAuditDuplicates(token: string) {
  return callApi("admin-api", { action: "scan-audit-duplicates", token });
}

export async function adminGetUploadHistory(token: string) {
  return callApi("admin-api", { action: "get-upload-history", token });
}

export async function adminGetUploadHistoryDetail(token: string, logId: string) {
  return callApi("admin-api", { action: "get-upload-history-detail", token, logId });
}

export async function adminGetDuplicatePolicies(token: string, statusFilter = "flagged") {
  return callApi("admin-api", { action: "get-duplicate-policies", token, statusFilter });
}

export async function adminResolveDuplicatePolicy(token: string, policyId: string, resolution: "keep_flagged" | "unflag") {
  return callApi("admin-api", { action: "resolve-duplicate-policy", token, policyId, resolution });
}

export async function adminRunDuplicateScan(token: string) {
  return callApi("admin-api", { action: "run-duplicate-scan", token });
}

export async function adminGetAgencyCredentials(token: string) {
  return callApi("admin-api", { action: "get-agency-credentials", token });
}

export async function adminUpdateAgencyCredential(token: string, credentialId: string, newPassword?: string, newUsername?: string) {
  return callApi("admin-api", { action: "update-agency-credential", token, credentialId, newPassword, newUsername });
}

export async function adminResetAgencyCredential(token: string, credentialId: string) {
  return callApi("admin-api", { action: "reset-agency-credential", token, credentialId });
}

export async function adminSetAgencyZapsEnabled(token: string, agencyId: string, enabled: boolean) {
  return callApi("admin-api", { action: "set-agency-zaps-enabled", token, agencyId, enabled });
}

export async function adminResolveAgencySlug(token: string, slug: string): Promise<{ id: string; name: string; slug: string }> {
  const result = await callApi("admin-api", { action: "resolve-agency-slug", token, slug });
  return result as unknown as { id: string; name: string; slug: string };
}

export async function agentGetOnboardingStatus(sessionToken: string) {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/leaderboard-api?action=agent-onboarding-status`,
    { method: "GET", headers: { ...baseHeaders, "X-Agent-Token": sessionToken } }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Failed to fetch onboarding status");
  return data;
}

export async function agentCompleteOnboarding(sessionToken: string) {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/leaderboard-api?action=agent-complete-onboarding`,
    {
      method: "POST",
      headers: { ...baseHeaders, "X-Agent-Token": sessionToken },
      body: JSON.stringify({}),
    }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Failed to complete onboarding");
  return data;
}

export async function adminGetOnboardingStatus(token: string) {
  return callApi("admin-api", { action: "admin-onboarding-status", token });
}

export async function adminCompleteOnboarding(token: string) {
  return callApi("admin-api", { action: "admin-complete-onboarding", token });
}

