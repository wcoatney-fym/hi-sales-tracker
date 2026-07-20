/*
  GHL OAuth Callback — ghl-oauth-callback
  
  Handles the OAuth 2.0 authorization code exchange for GHL Marketplace Private App.
  
  Flow:
    1. GHL redirects to this URL after a sub-account owner installs/authorizes the app:
       GET /functions/v1/ghl-oauth-callback?code=<auth_code>&location_id=<locationId>
    2. We exchange the code for access_token + refresh_token
    3. We store the tokens in ghl_location_tokens table
    4. We return a success page

  Env vars required (Supabase function secrets):
    - GHL_APP_CLIENT_ID      — from GHL Marketplace app
    - GHL_APP_CLIENT_SECRET  — from GHL Marketplace app
    - SUPABASE_URL           — auto-injected by Supabase
    - SUPABASE_SERVICE_ROLE_KEY — auto-injected by Supabase
*/

import { createClient } from "npm:@supabase/supabase-js@2";

const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const locationId = url.searchParams.get("location_id");
  const companyId = url.searchParams.get("companyId"); // GHL also sends this

  console.log(`[ghl-oauth-callback] code=${code ? "present" : "missing"} locationId=${locationId} companyId=${companyId}`);

  if (!code) {
    const error = url.searchParams.get("error");
    const errorDesc = url.searchParams.get("error_description");
    console.error(`[ghl-oauth-callback] No code — error: ${error} — ${errorDesc}`);
    return htmlResponse(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px">
        <h2 style="color:#e53e3e">⚠️ Authorization Failed</h2>
        <p>${errorDesc || error || "No authorization code received."}</p>
        <p style="color:#666;font-size:14px">Please try installing the app again.</p>
      </body></html>
    `, 400);
  }

  // Load secrets
  const clientId = Deno.env.get("GHL_APP_CLIENT_ID");
  const clientSecret = Deno.env.get("GHL_APP_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    console.error("[ghl-oauth-callback] Missing GHL_APP_CLIENT_ID or GHL_APP_CLIENT_SECRET");
    return jsonResponse({ error: "Server configuration error" }, 500);
  }

  // Exchange code for tokens
  let tokenData: {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
    scope: string;
    locationId?: string;
    companyId?: string;
    userId?: string;
  };

  try {
    const tokenRes = await fetch(GHL_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${Deno.env.get("SUPABASE_URL")}/functions/v1/ghl-oauth-callback`,
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error(`[ghl-oauth-callback] Token exchange failed ${tokenRes.status}: ${errBody}`);
      return htmlResponse(`
        <html><body style="font-family:sans-serif;text-align:center;padding:60px">
          <h2 style="color:#e53e3e">⚠️ Token Exchange Failed</h2>
          <p>GHL returned status ${tokenRes.status}. Please try again.</p>
        </body></html>
      `, 500);
    }

    tokenData = await tokenRes.json();
    console.log(`[ghl-oauth-callback] Token exchange success — locationId=${tokenData.locationId} scope=${tokenData.scope?.substring(0, 60)}...`);
  } catch (err) {
    console.error(`[ghl-oauth-callback] Token exchange exception: ${err}`);
    return jsonResponse({ error: "Token exchange failed" }, 500);
  }

  // Upsert tokens into ghl_location_tokens
  const resolvedLocationId = tokenData.locationId || locationId;
  const resolvedCompanyId = tokenData.companyId || companyId;

  if (!resolvedLocationId) {
    console.error("[ghl-oauth-callback] No locationId in token response or query params");
    return jsonResponse({ error: "Could not determine locationId" }, 500);
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    const { error: upsertErr } = await supabase
      .from("ghl_location_tokens")
      .upsert({
        location_id: resolvedLocationId,
        company_id: resolvedCompanyId,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        scope: tokenData.scope,
        user_id: tokenData.userId,
        expires_at: expiresAt,
        installed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "location_id" });

    if (upsertErr) {
      console.error(`[ghl-oauth-callback] DB upsert error: ${JSON.stringify(upsertErr)}`);
      return jsonResponse({ error: "Failed to store tokens" }, 500);
    }

    console.log(`[ghl-oauth-callback] ✅ Tokens stored for locationId=${resolvedLocationId}`);
  } catch (err) {
    console.error(`[ghl-oauth-callback] DB exception: ${err}`);
    return jsonResponse({ error: "Database error" }, 500);
  }

  // Success page
  return htmlResponse(`
    <html>
    <head><title>FYM — App Connected</title></head>
    <body style="font-family:sans-serif;text-align:center;padding:80px;background:#f7f8fa">
      <div style="max-width:480px;margin:auto;background:#fff;border-radius:12px;padding:48px;box-shadow:0 2px 16px rgba(0,0,0,0.08)">
        <div style="font-size:48px;margin-bottom:16px">✅</div>
        <h2 style="color:#1a1a2e;margin:0 0 12px">FYM App Connected</h2>
        <p style="color:#555;margin:0 0 8px">Your GHL account has been successfully linked to FYM's automation platform.</p>
        <p style="color:#999;font-size:13px">Location ID: ${resolvedLocationId}</p>
        <p style="color:#999;font-size:13px;margin-top:24px">You can close this tab.</p>
      </div>
    </body>
    </html>
  `);
});
