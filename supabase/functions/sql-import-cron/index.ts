import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const AKAMAI_CA_CERT = `-----BEGIN CERTIFICATE-----
MIIERDCCAqygAwIBAgIUXb4vh6x1XAZ4Bm1oN3eqHm27NrAwDQYJKoZIhvcNAQEM
BQAwOjE4MDYGA1UEAwwvNWY1NzgxYmMtMjc4MC00NTA0LWFhMDctNzM1NTEwZGZj
NjQ3IFByb2plY3QgQ0EwHhcNMjYwMzAzMjE0OTI1WhcNMzYwMjI5MjE0OTI1WjA6
MTgwNgYDVQQDDC81ZjU3ODFiYy0yNzgwLTQ1MDQtYWEwNy03MzU1MTBkZmM2MDcg
UHJvamVjdCBDQTCCAaIwDQYJKoZIhvcNAQEBBQADggGPADCCAYoCggGBALAYtJy6
HRMQ/o7zwygRQBu/CgjH8VycBC886/LhF2LCVqGFD2eYbKMV3LF6WEWZCUgTgrCv
9xqAiFVVXn+jNpBG3DRQ49ox9VMzNXQFqfh93ckB+noqMoPmu7ifwTZYGb+bNlhH
Ng/U5uW7tLRaIs7TerrgQwFeJAUnQ93hVaJvP/Jc5UOLJFwW0bw274SMs1GDwCSP
LeQOj9vvWRBBA3m5kdoPir+uk/QdbQBJ+iHQ/T4cdfYeRNtCtZI9aRfaEKV5plz2
vyQd3ILkU6/ztzT7r9Mb3LbklL+ujmMqih4AdBtBK+gLPMsEyAF3EHATLy41TkgE
Rch3YQn8Uy4MkHqChAKERDFF/TwXPzKfaDE1bHKOuSqM0qXNwyE8Wi5jKnIs9rHP
XB7ZbwHd757eVVFEhSy3OMmmT894PYQ85chKsre4ERNlr8gzXRXM9HPIjizMBP3z
MHOmntCDUAVQOi2TDHlEgvni2GgRCZn2QCZwXdLLdC/AYpwT51Ve1YPKRwIDAQAB
o0IwQDAdBgNVHQ4EFgQUG/smxH2AvkCafCwJVnLfH34WzE8wEgYDVR0TAQH/BAgw
BgEB/wIBADALBgNVHQ8EBAMCAQYwDQYJKoZIhvcNAQEMBQADggGBABZ8ty1UFPtX
SSCFkURXa+2ov+gC4uoxPdZ6vKPkOro9zioSUEZyqkXRPGF7b66/8pCpTiw/Diq9
mBXmsMMVbMI/dlpESp2bMDF/PnrDNktPvBrUvnck7cSGYvDVZP93VXTQVHelg5vv
zrWhQJbqldtGeqxeZV1nemfv24eVr9eQGa4QNoMujjsOh+nEkP32u8gfXsvBeGX1
tHzciVwkre0hqpz8rqENn1eN8kbOTaCm8qWgNX0yltlEDA8V/uQrtqnyRSb2do0b
eTZ4DM9RvUCaQ8tZrztSyRgnVoW7/ZWJdq7qzADC6bEejKUyPtROYk6NPxwsv25M
ND5KqqtDUjosJtwVCPLUxXz0klDYzPUdYxVw8aVqagult4nTCUVsMZtInnReG9n0
jCyoYUzCAX/IcjgVlT9qBSijaF2Ej13P5dBP2TYZc75DwyCnR7oKU0A1qyCWRn6K
P0UBeWDb0uy/qk0qlpQov19T0VA/sVT567PUPF5B82v4Xxg+yqvLRg==
-----END CERTIFICATE-----`;

const SECRET_FALLBACKS: Record<string, string> = {
  DB_PASSWORD: "VUqeVnQw*d!UWrdbx!8pvE.maFTnTxzp",
};

function resolveSecret(name: string): string {
  return Deno.env.get(name) || SECRET_FALLBACKS[name] || "";
}

const LOWERCASE_PARTICLES = new Set([
  "de", "del", "della", "di", "da", "das", "do", "dos",
  "van", "von", "der", "den", "het",
  "la", "le", "les", "el", "al",
  "bin", "ibn",
]);

function capitalizeWord(word: string): string {
  if (word.length === 0) return word;
  if (word.length === 1) return word.toUpperCase();
  const lower = word.toLowerCase();
  if (lower.startsWith("mc") && word.length > 2) {
    return "Mc" + word.charAt(2).toUpperCase() + lower.slice(3);
  }
  if (lower.startsWith("mac") && word.length > 3 && /^mac[a-z]/.test(lower) && !["mace", "mach", "mack", "macs", "macy"].includes(lower)) {
    return "Mac" + word.charAt(3).toUpperCase() + lower.slice(4);
  }
  if (lower.startsWith("o'") && word.length > 2) {
    return "O'" + word.charAt(2).toUpperCase() + lower.slice(3);
  }
  return word.charAt(0).toUpperCase() + lower.slice(1);
}

function toProperCase(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) return trimmed;
  const words = trimmed.split(" ");
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && LOWERCASE_PARTICLES.has(lower)) return lower;
      return word.split("-").map((part) => capitalizeWord(part)).join("-");
    })
    .join(" ");
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeKeys(obj: Record<string, string> | null): Record<string, string> {
  if (!obj) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key.trim()] = value;
  }
  return result;
}

interface DataSource {
  id: string;
  name: string;
  type: string;
  default_carrier: string | null;
  auto_cron_enabled: boolean;
  auto_cron_confirmed_at: string | null;
  auto_cron_mapping_snapshot: Array<{ source_column: string; target_field: string }> | null;
  db_host: string | null;
  db_port: number | null;
  db_name: string | null;
  db_schema: string | null;
  db_table: string | null;
  db_user: string | null;
  db_password_secret_name: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!authHeader.includes(serviceRoleKey)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch { /* empty body is fine for initial cron trigger */ }

  const phase = (body.phase as string) || "init";
  const sourceId = body.sourceId as string | undefined;
  const uploadId = body.uploadId as string | undefined;
  const offset = parseInt(String(body.offset || "0"), 10);
  const orderColumnHint = body.orderColumn as string | undefined;
  const lastId = body.lastId as string | undefined;

  try {
    if (phase === "init") {
      return await handleInit(supabase, supabaseUrl, serviceRoleKey);
    } else if (phase === "fetch") {
      return await handleFetch(supabase, supabaseUrl, serviceRoleKey, sourceId!, uploadId!, offset, orderColumnHint);
    } else if (phase === "sync") {
      return await handleSync(supabase, supabaseUrl, serviceRoleKey, sourceId!, uploadId!, lastId);
    }
    return jsonResponse({ error: "Unknown phase" }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return jsonResponse({ error: msg }, 500);
  }
});

async function handleInit(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  const { data: sources } = await supabase
    .from("data_sources")
    .select("*")
    .eq("type", "sql_import")
    .eq("auto_cron_enabled", true);

  if (!sources || sources.length === 0) {
    return jsonResponse({ success: true, message: "No auto-cron sources enabled" });
  }

  const results: Array<{ sourceId: string; status: string; message: string }> = [];

  for (const source of sources as DataSource[]) {
    if (!source.auto_cron_confirmed_at) {
      results.push({ sourceId: source.id, status: "skipped", message: "Not confirmed" });
      continue;
    }
    if (!source.db_host || !source.db_table) {
      results.push({ sourceId: source.id, status: "skipped", message: "DB not configured" });
      continue;
    }

    // Check mapping drift
    const { data: currentMappings } = await supabase
      .from("column_mappings")
      .select("source_column, target_field")
      .eq("data_source_id", source.id)
      .order("source_column");

    const snapshot = source.auto_cron_mapping_snapshot || [];
    const currentSorted = (currentMappings || [])
      .map((m: { source_column: string; target_field: string }) => `${m.source_column}::${m.target_field}`)
      .sort()
      .join("|");
    const snapshotSorted = snapshot
      .map((m: { source_column: string; target_field: string }) => `${m.source_column}::${m.target_field}`)
      .sort()
      .join("|");

    if (currentSorted !== snapshotSorted) {
      await supabase
        .from("data_sources")
        .update({ auto_cron_enabled: false })
        .eq("id", source.id);

      await supabase.from("upload_history_log").insert({
        action: "auto_import_paused",
        details: { reason: "Column mappings changed since confirmation", source_id: source.id },
      });

      results.push({ sourceId: source.id, status: "paused", message: "Mapping drift detected" });
      continue;
    }

    if (!currentMappings || currentMappings.length === 0) {
      results.push({ sourceId: source.id, status: "skipped", message: "No mappings configured" });
      continue;
    }

    // Create upload record
    const carrier = source.default_carrier || "UNL";
    await supabase
      .from("source_uploads")
      .update({ is_active: false })
      .eq("data_source_id", source.id)
      .eq("carrier", carrier)
      .eq("is_active", true);

    const { data: newUpload, error: upErr } = await supabase
      .from("source_uploads")
      .insert({
        data_source_id: source.id,
        carrier,
        filename: `auto-import-${new Date().toISOString().slice(0, 10)}`,
        row_count: 0,
        status: "processing",
        uploaded_by: "system/cron",
        is_active: true,
      })
      .select()
      .single();

    if (upErr || !newUpload) {
      results.push({ sourceId: source.id, status: "error", message: upErr?.message || "Failed to create upload" });
      continue;
    }

    // Purge staging rows from prior uploads for this data source
    await purgeOldStagingRows(supabase, source.id, newUpload.id);

    // Self-invoke to start fetching
    await selfInvoke(supabaseUrl, serviceRoleKey, {
      phase: "fetch",
      sourceId: source.id,
      uploadId: newUpload.id,
      offset: 0,
    });

    results.push({ sourceId: source.id, status: "started", message: `Upload ${newUpload.id} created` });
  }

  return jsonResponse({ success: true, results });
}

async function purgeOldStagingRows(
  supabase: ReturnType<typeof createClient>,
  dataSourceId: string,
  currentUploadId: string,
) {
  const { data: oldUploads } = await supabase
    .from("source_uploads")
    .select("id")
    .eq("data_source_id", dataSourceId)
    .neq("id", currentUploadId);

  if (!oldUploads || oldUploads.length === 0) return;

  const oldIds = oldUploads.map((u: { id: string }) => u.id);
  for (let i = 0; i < oldIds.length; i += 50) {
    const batch = oldIds.slice(i, i + 50);
    await supabase
      .from("source_records")
      .delete()
      .in("source_upload_id", batch);
  }
}

async function handleFetch(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceRoleKey: string,
  sourceId: string,
  uploadId: string,
  offset: number,
  orderColumnHint?: string,
) {
  const { data: source } = await supabase
    .from("data_sources")
    .select("*")
    .eq("id", sourceId)
    .maybeSingle();

  if (!source || !source.db_host || !source.db_table) {
    return jsonResponse({ error: "Source not found or not configured" }, 400);
  }

  const { data: mappings } = await supabase
    .from("column_mappings")
    .select("source_column, target_field")
    .eq("data_source_id", sourceId);

  const mappingObj: Record<string, string> = {};
  for (const m of mappings || []) {
    mappingObj[m.source_column] = m.target_field;
  }

  const password = source.db_password_secret_name
    ? resolveSecret(source.db_password_secret_name)
    : "";

  const { default: postgres } = await import("npm:postgres@3.4.5");
  const sql = postgres({
    host: source.db_host,
    port: source.db_port || 5432,
    database: source.db_name || "postgres",
    username: source.db_user || "postgres",
    password,
    ssl: { ca: AKAMAI_CA_CERT, rejectUnauthorized: false },
    connect_timeout: 30,
    max: 1,
    idle_timeout: 5,
  });

  const schemaName = source.db_schema || "public";
  const tableName = source.db_table;
  const batchLimit = 1000;

  try {
    // Schema drift check on first batch
    if (offset === 0) {
      const colResult = await sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = ${schemaName} AND table_name = ${tableName}
        ORDER BY ordinal_position
      `;
      const dbColumns = new Set(colResult.map((r: { column_name: string }) => r.column_name));
      const missingColumns = Object.keys(mappingObj).filter(c => !dbColumns.has(c));

      if (missingColumns.length > 0) {
        await sql.end();
        await supabase
          .from("source_uploads")
          .update({ status: "error" })
          .eq("id", uploadId);

        await supabase.from("upload_history_log").insert({
          action: "auto_import_error",
          details: { reason: "Schema drift - missing columns", missing: missingColumns, source_id: sourceId, upload_id: uploadId },
        });

        return jsonResponse({ error: "Schema drift detected", missingColumns }, 500);
      }
    }

    // Determine stable sort column for deterministic pagination
    let orderColumn = orderColumnHint || "";
    if (!orderColumn) {
      const colCheck = await sql`
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = ${schemaName} AND table_name = ${tableName} AND column_name = '_dlt_id'
      `;
      if (colCheck.length > 0) {
        orderColumn = "_dlt_id";
      } else {
        const pkResult = await sql`
          SELECT a.attname
          FROM pg_index i
          JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
          JOIN pg_class c ON c.oid = i.indrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = ${schemaName} AND c.relname = ${tableName} AND i.indisprimary
          ORDER BY array_position(i.indkey, a.attnum)
          LIMIT 1
        `;
        orderColumn = pkResult.length > 0 ? pkResult[0].attname : "_dlt_id";
      }
    }

    const result = await sql.unsafe(
      `SELECT * FROM "${schemaName}"."${tableName}" ORDER BY "${orderColumn}" LIMIT $1 OFFSET $2`,
      [batchLimit, offset]
    );

    const rows = result.map((row: Record<string, unknown>) => {
      const strRow: Record<string, string> = {};
      for (const [k, v] of Object.entries(row)) {
        strRow[k] = v == null ? "" : String(v);
      }
      return strRow;
    });

    await sql.end();

    // Apply mappings and insert into source_records
    const recordRows = rows.map((row: Record<string, string>) => {
      const mapped: Record<string, string> = {};
      for (const [col, val] of Object.entries(row)) {
        const target = mappingObj[col];
        if (target) mapped[target] = val;
      }
      for (const codeField of ["UNL Writing Number", "Writing Agent Code", "Policy Number", "Downline Code", "FYM Agency Code"]) {
        if (mapped[codeField]) mapped[codeField] = mapped[codeField].trim();
      }
      if (mapped["Writing Agent"] && !mapped["Writing Agent First Name"]) {
        const parts = mapped["Writing Agent"].trim().split(/\s+/).filter(Boolean);
        mapped["Writing Agent First Name"] = parts.length > 0 ? parts[0] : "";
        mapped["Writing Agent Last Name"] = parts.length > 1 ? parts[parts.length - 1] : parts[0] || "";
      }
      return {
        source_upload_id: uploadId,
        raw_data: row,
        mapped_data: mapped,
        processing_status: "imported",
      };
    });

    // Idempotent staging: skip rows whose _dlt_id already exists for this upload
    const incomingDltIds = rows
      .map((r: Record<string, string>) => r["_dlt_id"] || r["dlt_id"] || "")
      .filter((id: string) => id !== "");
    const existingDltIds = new Set<string>();
    if (incomingDltIds.length > 0) {
      for (let i = 0; i < incomingDltIds.length; i += 200) {
        const chunk = incomingDltIds.slice(i, i + 200);
        const { data: existing } = await supabase
          .from("source_records")
          .select("raw_data")
          .eq("source_upload_id", uploadId)
          .in("raw_data->>_dlt_id", chunk);
        for (const row of existing || []) {
          const rd = row.raw_data as Record<string, string> | null;
          if (rd && (rd["_dlt_id"] || rd["dlt_id"])) {
            existingDltIds.add(rd["_dlt_id"] || rd["dlt_id"]);
          }
        }
      }
    }

    // Filter out already-staged rows
    const newRows = existingDltIds.size > 0
      ? recordRows.filter((_r: unknown, idx: number) => {
          const dltId = rows[idx]["_dlt_id"] || rows[idx]["dlt_id"] || "";
          return !dltId || !existingDltIds.has(dltId);
        })
      : recordRows;

    // Insert in sub-batches of 200
    for (let i = 0; i < newRows.length; i += 200) {
      const batch = newRows.slice(i, i + 200);
      await supabase.from("source_records").insert(batch);
    }

    const hasMore = rows.length === batchLimit;
    const nextOffset = offset + rows.length;

    // Update progress
    await supabase
      .from("source_uploads")
      .update({ resync_progress: { phase: "fetch", offset: nextOffset, hasMore } })
      .eq("id", uploadId);

    if (hasMore) {
      await selfInvoke(supabaseUrl, serviceRoleKey, {
        phase: "fetch",
        sourceId,
        uploadId,
        offset: nextOffset,
        orderColumn,
      });
      return jsonResponse({ success: true, phase: "fetch", offset: nextOffset, fetched: rows.length, continuing: true });
    }

    // All rows fetched - update row_count and start sync phase
    const { count: totalImported } = await supabase
      .from("source_records")
      .select("*", { count: "exact", head: true })
      .eq("source_upload_id", uploadId)
      .eq("processing_status", "imported");

    await supabase
      .from("source_uploads")
      .update({ row_count: totalImported || nextOffset })
      .eq("id", uploadId);

    // Start sync phase with keyset pagination (lastId = undefined means start from beginning)
    await selfInvoke(supabaseUrl, serviceRoleKey, {
      phase: "sync",
      sourceId,
      uploadId,
    });

    return jsonResponse({ success: true, phase: "fetch_complete", totalRows: totalImported || nextOffset });
  } catch (err) {
    try { await sql.end(); } catch { /* ignore */ }
    await supabase
      .from("source_uploads")
      .update({ status: "error" })
      .eq("id", uploadId);
    throw err;
  }
}

async function handleSync(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceRoleKey: string,
  sourceId: string,
  uploadId: string,
  lastId?: string,
) {
  const { data: upload } = await supabase
    .from("source_uploads")
    .select("id, carrier, row_count")
    .eq("id", uploadId)
    .maybeSingle();

  if (!upload) return jsonResponse({ error: "Upload not found" }, 404);

  const carrier = upload.carrier;

  // Use a DB function to get distinct policies with the greatest id per policy_number.
  // We paginate by source_records.id using keyset pagination to guarantee every row is visited.
  const batchSize = 1000;
  let query = supabase
    .from("source_records")
    .select("id, mapped_data")
    .eq("source_upload_id", uploadId)
    .eq("processing_status", "imported")
    .order("id", { ascending: true })
    .limit(batchSize);

  if (lastId) {
    query = query.gt("id", lastId);
  }

  const { data: batchRecs } = await query;

  if (!batchRecs || batchRecs.length === 0) {
    // All rows processed - finalize
    const { count: totalSynced } = await supabase
      .from("form_submissions")
      .select("*", { count: "exact", head: true })
      .eq("source_upload_id", uploadId);

    await supabase
      .from("source_uploads")
      .update({ status: "complete", resync_progress: { phase: "sync", done: true, policies_synced: totalSynced } })
      .eq("id", uploadId);

    await supabase
      .from("data_sources")
      .update({ last_auto_pull_at: new Date().toISOString(), last_polled_at: new Date().toISOString() })
      .eq("id", sourceId);

    await supabase.from("upload_history_log").insert({
      action: "auto_import_complete",
      details: { source_id: sourceId, upload_id: uploadId, policies_synced: totalSynced },
    });

    // Purge staging rows now that migration is complete
    await supabase
      .from("source_records")
      .delete()
      .eq("source_upload_id", uploadId);

    return jsonResponse({ success: true, done: true, policies_synced: totalSynced });
  }

  const newLastId = batchRecs[batchRecs.length - 1].id;

  // --- Agent Sync ---
  let agentsAdded = 0;
  let agentsUpdated = 0;
  try {
    const agentMap = new Map<string, { name: string; agency: string }>();
    const agentDownlineCounts = new Map<string, { total: number; withDownline: number }>();
    for (const rec of batchRecs) {
      const md = normalizeKeys(rec.mapped_data as Record<string, string> | null);
      const code = (md["UNL Writing Number"] || md["Writing Agent Code"] || "").trim().toUpperCase();
      if (!code) continue;
      const downline = (md["Downline Agency"] || "").trim().replace(/\s+/g, " ");
      const counts = agentDownlineCounts.get(code) || { total: 0, withDownline: 0 };
      counts.total++;
      if (downline) counts.withDownline++;
      agentDownlineCounts.set(code, counts);
      if (agentMap.has(code)) continue;
      const name = (md["Writing Agent"] || md["Writing Agent Name"] || "").trim();
      agentMap.set(code, { name, agency: downline ? toProperCase(downline) : "" });
    }
    for (const [code, entry] of agentMap) {
      if (!entry.agency) {
        const counts = agentDownlineCounts.get(code);
        if (counts && counts.withDownline > 0) {
          for (const rec of batchRecs) {
            const md = normalizeKeys(rec.mapped_data as Record<string, string> | null);
            const rc = (md["UNL Writing Number"] || md["Writing Agent Code"] || "").trim().toUpperCase();
            if (rc !== code) continue;
            const dl = (md["Downline Agency"] || "").trim().replace(/\s+/g, " ");
            if (dl) { entry.agency = toProperCase(dl); break; }
          }
        }
        if (!entry.agency) entry.agency = "FYM";
      }
    }

    const allCodes = Array.from(agentMap.keys());
    const existingAgentsMap = new Map<string, { id: string; agency: string; agency_locked: boolean; source: string }>();
    for (let i = 0; i < allCodes.length; i += 200) {
      const batch = allCodes.slice(i, i + 200);
      const { data: existing } = await supabase
        .from("agents")
        .select("id, unl_writing_number, agency, agency_locked, source")
        .in("unl_writing_number", batch);
      for (const a of existing || []) {
        existingAgentsMap.set(a.unl_writing_number.toUpperCase(), a);
      }
    }

    const missingCodes = allCodes.filter(c => !existingAgentsMap.has(c));
    if (missingCodes.length > 0) {
      for (let i = 0; i < missingCodes.length; i += 200) {
        const batch = missingCodes.slice(i, i + 200);
        const { data: aliasHits } = await supabase
          .from("agent_writing_numbers")
          .select("writing_number, agent_id")
          .in("writing_number", batch);
        if (aliasHits && aliasHits.length > 0) {
          const agentIds = [...new Set(aliasHits.map((h: { agent_id: string }) => h.agent_id))];
          const { data: aliasedAgents } = await supabase
            .from("agents")
            .select("id, unl_writing_number, agency, agency_locked, source")
            .in("id", agentIds);
          for (const hit of aliasHits) {
            const agent = (aliasedAgents || []).find((a: { id: string }) => a.id === hit.agent_id);
            if (agent) {
              existingAgentsMap.set(hit.writing_number.toUpperCase(), agent);
            }
          }
        }
      }
    }

    const agentsToInsert: Array<Record<string, unknown>> = [];
    for (const [code, { name, agency }] of agentMap) {
      const nameParts = name.split(/\s+/).filter(Boolean);
      if (nameParts.length === 0) continue;
      const firstName = toProperCase(nameParts[0]);
      const lastName = toProperCase(nameParts[nameParts.length - 1]);
      if (!firstName || !lastName) continue;

      const existing = existingAgentsMap.get(code);
      if (existing) {
        if (existing.source === "Contracting Portal") continue;
        if (existing.agency_locked) continue;
        if (agency && existing.agency !== agency) {
          await supabase
            .from("agents")
            .update({ agency, updated_at: new Date().toISOString() })
            .eq("id", existing.id);
          agentsUpdated++;
        }
      } else {
        agentsToInsert.push({
          first_name: firstName,
          last_name: lastName,
          unl_writing_number: code,
          agency: agency || "FYM",
          source: "Data Source",
        });
      }
    }
    for (let i = 0; i < agentsToInsert.length; i += 200) {
      const batch = agentsToInsert.slice(i, i + 200);
      const { error: batchErr } = await supabase.from("agents").insert(batch);
      if (!batchErr) agentsAdded += batch.length;
    }
  } catch (_) {
    // best-effort agent sync
  }

  // --- Policy Sync ---
  // Deduplicate by policy_number within this batch, keeping the row with the greatest id
  const { data: agentsList } = await supabase
    .from("agents")
    .select("unl_writing_number, agency")
    .range(0, 9999);
  const agencyLookup = new Map<string, string>();
  for (const a of agentsList || []) {
    if (a.unl_writing_number) agencyLookup.set(a.unl_writing_number.toUpperCase(), a.agency || "");
  }

  const { data: rosterEntries } = await supabase
    .from("agency_rosters")
    .select("writing_number, agency_id, agencies:agency_id(name)")
    .eq("match_status", "confirmed")
    .eq("status", "active");
  const rosterAgencyLookup = new Map<string, string>();
  for (const r of rosterEntries || []) {
    if (r.writing_number && r.agencies) {
      rosterAgencyLookup.set(r.writing_number.toUpperCase(), (r.agencies as { name: string }).name);
    }
  }

  const CONTRACT_STATUS: Record<string, string> = { A: "active", T: "terminated", P: "pending", S: "suspended" };
  const parseDate = (d: string): string | null => {
    if (!d || d.length < 8) return null;
    return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  };

  // Build policy rows, deduplicating by policy_number (last/greatest id wins)
  const policyDedup = new Map<string, Record<string, unknown>>();
  for (const rec of batchRecs) {
    const md = normalizeKeys(rec.mapped_data as Record<string, string> | null);
    const policyNumber = (md["Policy Number"] || "").trim();
    if (!policyNumber) continue;

    const agentCode = (md["UNL Writing Number"] || md["Writing Agent Code"] || "").trim().toUpperCase();
    const writingAgent = (md["Writing Agent"] || md["Writing Agent Name"] || "").trim();
    const agentParts = writingAgent.split(/\s+/).filter(Boolean);
    const agentFirst = agentParts.length > 0 ? toProperCase(agentParts[0]) : "";
    const agentLast = agentParts.length > 1 ? toProperCase(agentParts[agentParts.length - 1]) : agentFirst;

    const annualPremium = parseFloat(md["Annual Premium"] || "0");
    const monthlyPremium = isNaN(annualPremium) ? 0 : Math.round((annualPremium / 12) * 100) / 100;
    const planCode = (md["Plan Code"] || "").trim();
    const productType = planCode.toUpperCase().includes("HHC") ? "HHC" : "HI";
    const contractCode = (md["Contract Code"] || "").trim().toUpperCase();
    const status = CONTRACT_STATUS[contractCode] || "pending";
    const downlineAgency = (md["Downline Agency"] || "").trim().replace(/\s+/g, " ");
    const agency = rosterAgencyLookup.get(agentCode)
      || (downlineAgency ? toProperCase(downlineAgency) : (agencyLookup.get(agentCode) || "FYM"));

    // Because batchRecs is ordered by id ASC, later entries for the same policy_number
    // will overwrite earlier ones, giving us the greatest-id row per policy.
    policyDedup.set(policyNumber, {
      policy_number: policyNumber,
      agent_number: agentCode,
      agent_first_name: agentFirst,
      agent_last_name: agentLast,
      client_first_name: toProperCase(md["First Name"] || ""),
      client_last_name: toProperCase(md["Last Name"] || ""),
      phone: (md["Phone"] || "").trim(),
      email: "",
      address: "",
      city: "",
      state: (md["State"] || "").trim(),
      zip: (md["Zip"] || "").trim(),
      plan_name: planCode,
      plan_premium: monthlyPremium,
      policy_effective_date: parseDate(md["Effective Date"] || ""),
      app_submit_date: parseDate(md["Submit Date"] || ""),
      paid_to_date: parseDate(md["Paid To Date"] || ""),
      status,
      carrier,
      product_type: productType,
      agency,
      billing_form: (md["Billing Form"] || "").trim() || null,
      billing_mode: (md["Billing Mode"] || "").trim() || null,
      contract_code: (md["Contract Code"] || "").trim() || null,
      source: "Data Source",
      source_upload_id: uploadId,
    });
  }
  const uniquePolicies = Array.from(policyDedup.values());

  let synced = 0;
  try {
    for (let i = 0; i < uniquePolicies.length; i += 500) {
      const batch = uniquePolicies.slice(i, i + 500);
      const { error: upsertErr, count } = await supabase
        .from("form_submissions")
        .upsert(batch, { onConflict: "policy_number", count: "exact" });
      if (upsertErr) throw upsertErr;
      synced += (count || batch.length);
    }
  } catch (syncErr) {
    await supabase
      .from("source_uploads")
      .update({ status: "error", resync_progress: { phase: "sync", lastId: newLastId, synced, done: false, error: true } })
      .eq("id", uploadId);
    return jsonResponse({ error: `Policy sync failed: ${syncErr instanceof Error ? syncErr.message : "Unknown"}` }, 500);
  }

  // Update progress
  await supabase
    .from("source_uploads")
    .update({ resync_progress: { phase: "sync", lastId: newLastId, synced, continuing: true } })
    .eq("id", uploadId);

  // Self-invoke for next sync batch with keyset cursor
  await selfInvoke(supabaseUrl, serviceRoleKey, {
    phase: "sync",
    sourceId,
    uploadId,
    lastId: newLastId,
  });

  return jsonResponse({ success: true, phase: "sync", lastId: newLastId, synced, agentsAdded, agentsUpdated, continuing: true });
}

async function selfInvoke(
  supabaseUrl: string,
  serviceRoleKey: string,
  body: Record<string, unknown>,
) {
  const url = `${supabaseUrl}/functions/v1/sql-import-cron`;
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify(body),
  });
}
