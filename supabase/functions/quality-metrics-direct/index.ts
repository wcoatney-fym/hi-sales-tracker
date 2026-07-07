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
import { authorizeAgencyAccess } from "../_shared/agencyAuth.ts";

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
    const agencyName: string | null = body.p_agency_name ?? null;
    const agencyNames: string[] | null = Array.isArray(body.p_agency_names) && body.p_agency_names.length
      ? body.p_agency_names
      : null;

    // Auth: require a session token (admin | agent), same as the RPC path.
    const token: string = body.token || req.headers.get("X-Agent-Token") || "";
    if (!token) return jsonResponse({ error: "Authentication required" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve the requested scope -> agency rows (id + writing number) via the
    // agency_writing_numbers map (stable key; immune to display-name drift).
    // No scope => whole book. Membership is keyed on writing_number in SQL below.
    let targetWns: string[] | null = null;
    let targetIds: string[] = [];
    if (agencyId || agencyName || agencyNames) {
      let q = supabase
        .from("agency_writing_numbers")
        .select("writing_number, agency_id, agencies!inner(id, name)");
      if (agencyId) {
        q = q.eq("agency_id", agencyId);
      } else if (agencyNames) {
        q = q.in("agencies.name", agencyNames);
      } else if (agencyName) {
        q = q.eq("agencies.name", agencyName);
      }
      const { data, error } = await q;
      if (error) throw error;
      targetWns = (data || []).map((r: { writing_number: string }) => r.writing_number);
      targetIds = (data || []).map((r: { agency_id: string }) => r.agency_id);
      if (targetWns.length === 0) {
        return jsonResponse({ error: "No matching agency / writing number for scope" }, 404);
      }
    }

    // Authorize the caller for the requested scope (mirrors leaderboard-api):
    // whole-book requires a global admin; scoped requires access to EVERY agency
    // in the request.
    if (targetIds.length === 0) {
      if (!(await authorizeAgencyAccess(supabase, token, null))) {
        return jsonResponse({ error: "Not authorized" }, 403);
      }
    } else {
      for (const id of targetIds) {
        if (!(await authorizeAgencyAccess(supabase, token, id))) {
          return jsonResponse({ error: "Not authorized" }, 403);
        }
      }
    }

    // Max's managed DB presents a private "Project CA" (Aiven/Linode-style) that
    // Deno's default trust store doesn't know. Pin it via PROD_DB_CA_CERT so we
    // verify against the real CA (vs. disabling verification). Falls back to plain
    // "require" only if no CA is configured.
    const caCert = Deno.env.get("PROD_DB_CA_CERT");
    sql = postgres({
      host: cleanHost(Deno.env.get("PROD_DB_HOST")!),
      port: Number((Deno.env.get("PROD_DB_PORT") || "").replace(/\D/g, "")),
      database: Deno.env.get("PROD_DB_NAME")!,
      username: Deno.env.get("PROD_DB_USER")!,
      password: Deno.env.get("PROD_DB_PASSWORD")!,
      ssl: caCert ? { ca: caCert } : "require",
      max: 1,
      idle_timeout: 5,
      connect_timeout: 15,
    });

    // Single round-trip: placement (last 3 complete months) + persistency
    // (3/6/9/13-month cohorts) + 90-day retention, computed on Max's typed table
    // with the column remap inline. targetWns null => whole book.
    //
    // Membership key: a policy's owning agency = the shallowest sub-agency (depth-02)
    // org node's writing_number; if none, the depth-01 (FYM) writing_number
    // (= direct-to-FYM). This rolls downlines up into their depth-02 parent, matching
    // how the tracker buckets. Compare that against the requested writing numbers.
    const targetWnsArr = targetWns; // string[] | null
    const rows = await sql`
      WITH scoped AS (
        SELECT
          issue_date,
          app_recvd_date,
          paid_to_date,
          term_date,
          billing_mode
        FROM typed.unl_fym_policy_latest_load
        WHERE (
          ${targetWnsArr}::text[] IS NULL
          OR COALESCE(
               (SELECT e->>'writing_number'
                  FROM jsonb_array_elements(roster_hierarchy_json) e
                  WHERE e->>'depth' = '02'
                    AND COALESCE((e->>'is_person')::boolean, false) = false
                  LIMIT 1),
               (SELECT e->>'writing_number'
                  FROM jsonb_array_elements(roster_hierarchy_json) e
                  WHERE e->>'depth' = '01'
                  LIMIT 1)
             ) = ANY(${targetWnsArr}::text[])
        )
      )
      SELECT json_build_object(
        -- HEADLINE: 90-day retention (north-star). Of policies that drafted a 1st
        -- premium, the share that also retained through the 3rd draft. Billing-mode
        -- rule: monthly (1) requires paid_to_date >= effective + 3 months; any
        -- non-monthly single successful draft (3/6/12) already covers 90+ days.
        -- Only policies old enough to have run the gauntlet (issued >= 3 months ago).
        'retention_90d', (
          SELECT json_build_object(
            'drafted_first', count(*) FILTER (WHERE paid_to_date >= issue_date + interval '1 month'),
            'retained', count(*) FILTER (WHERE (billing_mode = 1 AND paid_to_date >= issue_date + interval '3 months')
                                            OR (billing_mode <> 1 AND paid_to_date >= issue_date + interval '1 month')),
            'retention_pct', round(100.0 * count(*) FILTER (WHERE (billing_mode = 1 AND paid_to_date >= issue_date + interval '3 months')
                                                              OR (billing_mode <> 1 AND paid_to_date >= issue_date + interval '1 month'))
              / nullif(count(*) FILTER (WHERE paid_to_date >= issue_date + interval '1 month'), 0), 1)
          )
          FROM scoped
          WHERE issue_date <= CURRENT_DATE - interval '3 months'
        ),
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
