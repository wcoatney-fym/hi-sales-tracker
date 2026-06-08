import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: sources, error: srcErr } = await supabase
      .from("data_sources")
      .select("*")
      .eq("type", "api_pull")
      .not("poll_interval", "is", null)
      .not("api_url", "is", null);

    if (srcErr) throw srcErr;

    const results: { sourceId: string; name: string; records: number; error?: string }[] = [];

    for (const source of sources || []) {
      // Check if source is due for polling
      if (source.last_polled_at) {
        const lastPolled = new Date(source.last_polled_at).getTime();
        const now = Date.now();
        const intervalMs = parseIntervalToMs(source.poll_interval);
        if (now - lastPolled < intervalMs) {
          continue; // Not due yet
        }
      }

      try {
        const rawSecret = source.api_key_secret_name || "";
        const isEnvVarName = /^[A-Z_][A-Z0-9_]*$/.test(rawSecret);
        const apiKey = rawSecret
          ? (isEnvVarName ? (Deno.env.get(rawSecret) || "") : rawSecret)
          : "";

        const apiResponse = await fetch(source.api_url, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        });

        if (!apiResponse.ok) {
          results.push({ sourceId: source.id, name: source.name, records: 0, error: `HTTP ${apiResponse.status}` });
          continue;
        }

        const apiData = await apiResponse.json();
        const records = Array.isArray(apiData) ? apiData : (apiData.data || apiData.results || apiData.calls || [apiData]);

        const { data: upload, error: uploadErr } = await supabase
          .from("source_uploads")
          .insert({
            data_source_id: source.id,
            carrier: source.name,
            filename: `api_poll_${new Date().toISOString()}`,
            row_count: records.length,
            status: "complete",
            uploaded_by: "system_cron",
          })
          .select()
          .single();

        if (uploadErr) {
          results.push({ sourceId: source.id, name: source.name, records: 0, error: uploadErr.message });
          continue;
        }

        if (records.length > 0) {
          const sourceRecords = records.map((r: unknown) => ({
            source_upload_id: upload.id,
            raw_data: r,
            mapped_data: {},
            processing_status: "pending",
          }));
          await supabase.from("source_records").insert(sourceRecords);
        }

        await supabase
          .from("data_sources")
          .update({ last_polled_at: new Date().toISOString() })
          .eq("id", source.id);

        results.push({ sourceId: source.id, name: source.name, records: records.length });
      } catch (e: unknown) {
        results.push({ sourceId: source.id, name: source.name, records: 0, error: e instanceof Error ? e.message : "Unknown error" });
      }
    }

    return new Response(JSON.stringify({ success: true, polled: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function parseIntervalToMs(interval: string): number {
  if (!interval) return 0;
  const parts = interval.toLowerCase().trim();
  const match = parts.match(/^(\d+)\s*(minute|minutes|hour|hours|day|days)$/);
  if (match) {
    const val = parseInt(match[1], 10);
    const unit = match[2];
    if (unit.startsWith("minute")) return val * 60 * 1000;
    if (unit.startsWith("hour")) return val * 60 * 60 * 1000;
    if (unit.startsWith("day")) return val * 24 * 60 * 60 * 1000;
  }
  // PostgreSQL interval format: "01:00:00"
  const hmsMatch = parts.match(/^(\d{2}):(\d{2}):(\d{2})$/);
  if (hmsMatch) {
    const h = parseInt(hmsMatch[1], 10);
    const m = parseInt(hmsMatch[2], 10);
    const s = parseInt(hmsMatch[3], 10);
    return (h * 3600 + m * 60 + s) * 1000;
  }
  return 60 * 60 * 1000; // Default 1 hour
}
