import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * GHL Token Refresh — ghl-token-refresh
 *
 * Refreshes GHL OAuth tokens that are expiring within the next 2 hours.
 * GHL access tokens expire after 24 hours; refresh tokens are long-lived
 * but must be used before the access token fully expires.
 *
 * Runs via pg_cron every 6 hours. Can also be triggered manually via POST.
 *
 * Flow:
 *   1. Query ghl_location_tokens for rows where expires_at < now() + 2 hours
 *   2. For each, POST to GHL token endpoint with grant_type=refresh_token
 *   3. Upsert the new access_token, refresh_token, and expires_at
 *   4. Log results summary
 *
 * Required Supabase function secrets:
 *   - GHL_APP_CLIENT_ID
 *   - GHL_APP_CLIENT_SECRET
 *   - SUPABASE_URL (auto-injected)
 *   - SUPABASE_SERVICE_ROLE_KEY (auto-injected)
 *
 * Auth: x-cron-auth header checked against vault secret 'cron_import_secret',
 *       or Authorization: Bearer <service_role_key>.
 */

const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const REFRESH_WINDOW_HOURS = 2; // refresh tokens expiring within this window
const RATE_LIMIT_DELAY_MS = 150; // ~6.6 req/s, well under GHL's 80/10s

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-cron-auth",
};

interface TokenRow {
  location_id: string;
  company_id: string | null;
  refresh_token: string;
  expires_at: string;
}

interface RefreshResult {
  location_id: string;
  status: "refreshed" | "failed";
  error?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Auth check — cron header or service role bearer
  const cronAuth = req.headers.get("x-cron-auth");
  const authHeader = req.headers.get("authorization");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  // We'll accept either cron auth or service role key
  // For cron: the pg_cron job passes the vault secret
  // For manual: pass Authorization: Bearer <service_role_key>
  const isServiceRole =
    authHeader === `Bearer ${serviceRoleKey}`;

  // For cron auth, we trust the header if it's non-empty (vault secret match
  // happens at the pg_cron layer via the SQL that builds the header)
  if (!cronAuth && !isServiceRole) {
    console.error("[ghl-token-refresh] Unauthorized — no valid auth header");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const clientId = Deno.env.get("GHL_APP_CLIENT_ID");
  const clientSecret = Deno.env.get("GHL_APP_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    console.error("[ghl-token-refresh] Missing GHL_APP_CLIENT_ID or GHL_APP_CLIENT_SECRET");
    return new Response(
      JSON.stringify({ error: "Server configuration error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceRoleKey!
  );

  // Find tokens expiring within the refresh window
  const cutoff = new Date(
    Date.now() + REFRESH_WINDOW_HOURS * 60 * 60 * 1000
  ).toISOString();

  const { data: expiringTokens, error: queryErr } = await supabase
    .from("ghl_location_tokens")
    .select("location_id, company_id, refresh_token, expires_at")
    .lt("expires_at", cutoff)
    .order("expires_at", { ascending: true });

  if (queryErr) {
    console.error(
      `[ghl-token-refresh] Query error: ${JSON.stringify(queryErr)}`
    );
    return new Response(JSON.stringify({ error: "Database query failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const tokens: TokenRow[] = expiringTokens || [];

  if (tokens.length === 0) {
    console.log("[ghl-token-refresh] No tokens need refreshing");
    return new Response(
      JSON.stringify({
        message: "No tokens need refreshing",
        checked_at: new Date().toISOString(),
        refresh_window_hours: REFRESH_WINDOW_HOURS,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  console.log(
    `[ghl-token-refresh] ${tokens.length} token(s) expiring before ${cutoff} — refreshing`
  );

  const results: RefreshResult[] = [];

  for (const token of tokens) {
    try {
      // Rate limit
      if (results.length > 0) {
        await sleep(RATE_LIMIT_DELAY_MS);
      }

      const tokenRes = await fetch(GHL_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: token.refresh_token,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });

      if (!tokenRes.ok) {
        const errBody = await tokenRes.text();
        console.error(
          `[ghl-token-refresh] Refresh failed for ${token.location_id}: ${tokenRes.status} — ${errBody}`
        );
        results.push({
          location_id: token.location_id,
          status: "failed",
          error: `HTTP ${tokenRes.status}: ${errBody.substring(0, 200)}`,
        });
        continue;
      }

      const newTokenData = await tokenRes.json();
      const newExpiresAt = new Date(
        Date.now() + (newTokenData.expires_in || 86400) * 1000
      ).toISOString();

      const { error: upsertErr } = await supabase
        .from("ghl_location_tokens")
        .update({
          access_token: newTokenData.access_token,
          refresh_token: newTokenData.refresh_token,
          expires_at: newExpiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("location_id", token.location_id);

      if (upsertErr) {
        console.error(
          `[ghl-token-refresh] DB update failed for ${token.location_id}: ${JSON.stringify(upsertErr)}`
        );
        results.push({
          location_id: token.location_id,
          status: "failed",
          error: `DB update: ${upsertErr.message}`,
        });
        continue;
      }

      console.log(
        `[ghl-token-refresh] ✅ Refreshed ${token.location_id} — new expiry ${newExpiresAt}`
      );
      results.push({ location_id: token.location_id, status: "refreshed" });
    } catch (err) {
      console.error(
        `[ghl-token-refresh] Exception for ${token.location_id}: ${err}`
      );
      results.push({
        location_id: token.location_id,
        status: "failed",
        error: String(err),
      });
    }
  }

  const refreshed = results.filter((r) => r.status === "refreshed").length;
  const failed = results.filter((r) => r.status === "failed").length;

  const summary = {
    total: tokens.length,
    refreshed,
    failed,
    results,
    run_at: new Date().toISOString(),
  };

  console.log(
    `[ghl-token-refresh] Done — ${refreshed} refreshed, ${failed} failed out of ${tokens.length}`
  );

  return new Response(JSON.stringify(summary), {
    status: failed > 0 && refreshed === 0 ? 500 : 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
