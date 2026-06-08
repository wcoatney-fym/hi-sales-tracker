import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ENROLLHERE_API_URL = "https://api.enrollhere.com/v1/dialer/agents/performance";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("ENROLLHERE_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "ENROLLHERE_API_KEY secret not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Accept optional overrides from the request body
    let dateRange = "today";
    let dateStart = "";
    let dateEnd = "";
    let agencyIds: string[] = [];
    let agentIds: string[] = [];

    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body.date_range) dateRange = body.date_range;
        if (body.date_start) dateStart = body.date_start;
        if (body.date_end) dateEnd = body.date_end;
        if (body.agency_ids) agencyIds = body.agency_ids;
        if (body.agent_ids) agentIds = body.agent_ids;
      } catch {
        // Empty body is fine, use defaults
      }
    }

    const requestBody = {
      aggregations: {
        summary: true,
      },
      filter: {
        date: {
          range: dateRange,
          start: dateStart,
          end: dateEnd,
          timeframe: 1,
          timeZone: "",
        },
        agency: {
          id: "",
          ids: agencyIds,
        },
        agent: {
          id: "",
          ids: agentIds,
        },
      },
    };

    const apiResponse = await fetch(ENROLLHERE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": apiKey,
      },
      body: JSON.stringify(requestBody),
    });

    if (!apiResponse.ok) {
      const errText = await apiResponse.text();
      return new Response(
        JSON.stringify({ error: `EnrollHere API returned ${apiResponse.status}: ${errText}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiData = await apiResponse.json();

    // Extract records array from response
    const records = Array.isArray(apiData)
      ? apiData
      : (apiData.data || apiData.results || apiData.agents || [apiData]);

    // Find or identify the EnrollHere data source
    const { data: source } = await supabase
      .from("data_sources")
      .select("id")
      .eq("name", "EnrollHere Dialer")
      .maybeSingle();

    const dataSourceId = source?.id;

    if (!dataSourceId) {
      return new Response(
        JSON.stringify({ error: "EnrollHere Dialer data source not found in data_sources table" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create a source upload record
    const { data: upload, error: uploadErr } = await supabase
      .from("source_uploads")
      .insert({
        data_source_id: dataSourceId,
        carrier: "EnrollHere",
        filename: `enrollhere_poll_${dateRange}_${new Date().toISOString()}`,
        row_count: records.length,
        status: "complete",
        uploaded_by: "system_cron",
      })
      .select()
      .single();

    if (uploadErr) throw uploadErr;

    // Store each agent's performance data as a source record
    if (records.length > 0) {
      const sourceRecords = records.map((r: unknown) => ({
        source_upload_id: upload.id,
        raw_data: r,
        mapped_data: {},
        processing_status: "pending",
      }));

      const { error: recErr } = await supabase
        .from("source_records")
        .insert(sourceRecords);
      if (recErr) throw recErr;
    }

    // Update last_polled_at
    await supabase
      .from("data_sources")
      .update({ last_polled_at: new Date().toISOString() })
      .eq("id", dataSourceId);

    return new Response(
      JSON.stringify({
        success: true,
        records_fetched: records.length,
        upload_id: upload.id,
        date_range: dateRange,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
