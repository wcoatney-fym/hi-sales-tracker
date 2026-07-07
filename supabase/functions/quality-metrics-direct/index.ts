// Option A prototype: query Max's production analytics DB *directly* for book
// quality (placement + persistency), returning the same JSON shape as the
// get_quality_metrics RPC — but computed on Max's indexed `typed` tables, where
// the aggregate runs in ~200ms, instead of federating through Supabase (FDW).
//
// This is the "query the database directly" architecture Max advocates:
//   frontend -> this edge function -> direct Postgres connection to Max's DB.
// No FDW, no daily copy. Tracker-only enrichment (agency uuid->name) is resolved
// against Supabase and passed down, demonstrating the cross-DB join in app code.
//
// Secrets (set as Supabase function secrets, NEVER in git):
//   PROD_DB_HOST, PROD_DB_PORT, PROD_DB_NAME, PROD_DB_USER, PROD_DB_PASSWORD
//   supabase secrets set PROD_DB_HOST=... PROD_DB_PORT=... etc.

import postgres from "npm:postgres@3.4.4";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Strip any accidental scheme/slash/port that got baked into the host env value.
function cleanHost(raw: string): string {
  return raw.replace(/^https?:\/\//, "").replace(/\/+$/, "").split(":")[0].trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const started = performance.now();
  let sql: ReturnType<typeof postgres> | null = null;
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const agencyId: string | null = body.p_agency_id ?? null;

    // Resolve agency uuid -> the depth-02 hierarchy name Max's data uses.
    // (Cross-DB join done in app code: agencies live in Supabase, policies in Max's DB.)
    let agencyName: string | null = null;
    if (agencyId) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data, error } = await supabase
        .from("agencies")
        .select("name")
        .eq("id", agencyId)
        .maybeSingle();
      if (error) throw error;
      // Max stores hierarchy names upper-cased; match that for jsonb containment.
      agencyName = data?.name ? String(data.name).trim().toUpperCase() : null;
      if (!agencyName) return jsonResponse({ error: "Unknown agency_id" }, 404);
    }

    sql = postgres({
      host: cleanHost(Deno.env.get("PROD_DB_HOST")!),
      port: Number((Deno.env.get("PROD_DB_PORT") || "").replace(/\D/g, "")),
      database: Deno.env.get("PROD_DB_NAME")!,
      username: Deno.env.get("PROD_DB_USER")!,
      password: Deno.env.get("PROD_DB_PASSWORD")!,
      ssl: "require",
      max: 1,
      idle_timeout: 5,
      connect_timeout: 15,
    });

    // Single round-trip: placement (last 3 complete months) + persistency
    // (3/6/9/13-month cohorts), computed on Max's typed table with the column
    // remap inline. agencyName null => whole book.
    const rows = await sql`
      WITH scoped AS (
        SELECT
          issue_date,
          app_recvd_date,
          paid_to_date,
          term_date
        FROM typed.unl_fym_policy_latest_load
        WHERE (
          ${agencyName}::text IS NULL
          OR roster_hierarchy_json @> jsonb_build_array(
               jsonb_build_object('name', ${agencyName}::text, 'depth', '02'))
        )
      )
      SELECT json_build_object(
        'placement', (
          SELECT COALESCE(json_agg(row_to_json(p) ORDER BY p.month), '[]'::json)
          FROM (
            SELECT to_char(date_trunc('month', app_recvd_date), 'YYYY-MM') AS month,
                   count(*) AS submitted,
                   count(*) FILTER (WHERE issue_date IS NOT NULL AND issue_date <= CURRENT_DATE) AS eligible,
                   count(*) FILTER (WHERE issue_date IS NOT NULL AND issue_date <= CURRENT_DATE
                                      AND paid_to_date IS NOT NULL AND paid_to_date > issue_date) AS placed,
                   round(100.0 * count(*) FILTER (WHERE issue_date IS NOT NULL AND issue_date <= CURRENT_DATE
                                                    AND paid_to_date IS NOT NULL AND paid_to_date > issue_date)
                     / nullif(count(*) FILTER (WHERE issue_date IS NOT NULL AND issue_date <= CURRENT_DATE), 0), 1) AS placement_pct
            FROM scoped
            WHERE app_recvd_date >= date_trunc('month', CURRENT_DATE) - interval '3 months'
              AND app_recvd_date <  date_trunc('month', CURRENT_DATE)
            GROUP BY 1
          ) p
        ),
        'persistency', (
          SELECT COALESCE(json_agg(row_to_json(q) ORDER BY q.months_ago), '[]'::json)
          FROM (
            SELECT m.months_ago,
                   to_char(date_trunc('month', CURRENT_DATE) - make_interval(months => m.months_ago), 'YYYY-MM') AS cohort_month,
                   count(*) FILTER (WHERE s.paid_to_date > s.issue_date) AS went_active,
                   count(*) FILTER (WHERE s.paid_to_date > s.issue_date AND s.term_date IS NULL) AS still_active,
                   round(100.0 * count(*) FILTER (WHERE s.paid_to_date > s.issue_date AND s.term_date IS NULL)
                     / nullif(count(*) FILTER (WHERE s.paid_to_date > s.issue_date), 0), 1) AS persistency_pct
            FROM (VALUES (3),(6),(9),(13)) AS m(months_ago)
            LEFT JOIN scoped s
              ON s.issue_date >= date_trunc('month', CURRENT_DATE) - make_interval(months => m.months_ago)
             AND s.issue_date <  date_trunc('month', CURRENT_DATE) - make_interval(months => m.months_ago - 1)
            GROUP BY m.months_ago
          ) q
        )
      ) AS result;
    `;

    const elapsedMs = Math.round(performance.now() - started);
    return jsonResponse({ ...rows[0].result, _elapsed_ms: elapsedMs, _source: "prod_direct" });
  } catch (err) {
    return jsonResponse({ error: String(err), _elapsed_ms: Math.round(performance.now() - started) }, 500);
  } finally {
    if (sql) await sql.end({ timeout: 5 });
  }
});
