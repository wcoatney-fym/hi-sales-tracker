import { createClient } from "npm:@supabase/supabase-js@2";

/*
  GHL -> tracker webhook (inbound half of the bidirectional sync).

  The at-risk pipeline is mirrored 1:1 in GHL. GHL posts here when something
  happens on its side that this system can't otherwise know:
    - a client replies with a keyword (SAVE -> responded, STOP -> manager_outreach)
    - a human MANUALLY moves/adds a contact in the GHL pipeline

  We update the policy's stage here. The tracker remains source of truth; these
  guardrails keep two-way sync sane:
    - LOOP KILL: the write is tagged sync_origin='ghl', so the outbound pusher
      (admin-api/ghl.ts) never echoes it straight back to GHL.
    - IDEMPOTENT: no-op when the stage already matches.
    - SAVED GATE: a manual GHL move to 'saved' lands as 'agent_saved_pending'
      so a manager still confirms it (SAVED_FROM_GHL_REQUIRES_APPROVAL). Flip to
      false to trust GHL's 'saved' directly. (Pending Charlie's a/b.)

  Canonical shared stages (match the GHL pipeline stage names/ids):
    new | responded | manager_outreach | agent_outreach |
    code_red | agent_saved_pending | saved | lost

  Policy lookup path (2026-07-20):
    Primary: policy_number → Max's DB (typed.unl_fym_policy_latest_load)
             Returns policy_nbr + agency resolved via agency_writing_numbers.
    Fallback: policy_number → form_submissions (for policies not yet in Max's DB,
              e.g. non-UNL carriers, pending UNL backlog).
    Phone/email lookup: form_submissions only (Max's DB has phone_nbr as bigint,
              not indexed for reverse lookup; form_submissions is correct here).

  Auth: x-api-key header must match GHL_WEBHOOK_KEY (Supabase function secret).
*/

// ── Akamai CA cert (same as lifecycle-direct / ghl-reconcile) ────────────
const AKAMAI_CA_CERT = `-----BEGIN CERTIFICATE-----
MIIERDCCAqygAwIBAgIUXb4vh6x1XAZ4Bm1oN3eqHm27NrAwDQYJKoZIhvcNAQEM
BQAwOjE4MDYGA1UEAwwvNWY1NzgxYmMtMjc4MC00NTA0LWFhMDctNzM1NTEwZGZj
NjQ3IFByb2plY3QgQ0EwHhcNMjYwMzAzMjE0OTI1WhcNMzYwMjI5MjE0OTI1WjA6
MTgwNgYDVQQDDC81ZjU3ODFiYy0yNzgwLTQ1MDQtYWEwNy03MzU1MTBkZmM2NDcg
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

function cleanHost(raw: string): string {
  return raw.replace(/^https?:\/\//, "").replace(/\/$/, "").split(":")[0];
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey, x-api-key",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// a/b toggle (default b): manual GHL "saved" still needs manager approval here.
const SAVED_FROM_GHL_REQUIRES_APPROVAL = true;

const KEYWORD_STAGE: Record<string, string> = {
  SAVE: "responded",
  YES: "responded",
  HELP: "responded",
  STOP: "manager_outreach",
  CANCEL: "manager_outreach",
};

const CANONICAL_STAGES = new Set([
  "new",
  "responded",
  "manager_outreach",
  "agent_outreach",
  "code_red",
  "agent_saved_pending",
  "saved",
  "lost",
]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  try {
    const apiKey = req.headers.get("x-api-key");
    const expectedKey = Deno.env.get("GHL_WEBHOOK_KEY");
    if (!expectedKey || apiKey !== expectedKey) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const body = await req.json();
    const policyNumber    = (body.policy_number  || "").toString().trim();
    const phone           = (body.phone          || "").toString().trim();
    const email           = (body.email          || "").toString().trim().toLowerCase();
    const ghlContactId    = (body.ghl_contact_id || body.contact_id || "").toString().trim();
    const keyword         = (body.keyword        || "").toString().trim().toUpperCase();
    const rawStage        = (body.stage          || "").toString().trim().toLowerCase();
    const note            = (body.note           || "").toString().slice(0, 280);

    let stage = rawStage || (keyword ? KEYWORD_STAGE[keyword] : "");
    if (!stage) {
      return jsonResponse({ error: "Provide a known keyword or stage" }, 400);
    }
    if (!CANONICAL_STAGES.has(stage)) {
      return jsonResponse({ error: `Unknown stage '${stage}'` }, 422);
    }
    if (stage === "saved" && SAVED_FROM_GHL_REQUIRES_APPROVAL) {
      stage = "agent_saved_pending";
    }

    const supabase = createClient(
      Deno.env.get("ACTIVITY_TRACKER_SUPABASE_URL")!,
      Deno.env.get("ACTIVITY_TRACKER_SERVICE_ROLE_KEY")!,
    );

    // ── Policy lookup ────────────────────────────────────────────────────
    // Result shape used for the disposition upsert.
    // policy_id: Supabase UUID (from form_submissions) — kept for FK integrity
    // policy_nbr: natural policy number — new parallel key (from Max's DB or form_submissions)
    // agency_id: Supabase UUID from agencies table
    let policyId: string | null = null;
    let resolvedPolicyNbr: string | null = null;
    let agencyId: string | null = null;

    if (policyNumber) {
      // ── Primary: query Max's DB (READ-ONLY) ────────────────────────────
      // Returns the policy number + writing number for agency resolution.
      // Zero writes to Max's DB.
      let foundInMaxDb = false;
      try {
        const { default: postgres } = await import("npm:postgres@3.4.5");
        const sql = postgres({
          host:            cleanHost(Deno.env.get("PROD_DB_HOST")!),
          port:            Number((Deno.env.get("PROD_DB_PORT") ?? "5432").replace(/\D/g, "")),
          database:        Deno.env.get("PROD_DB_NAME")!,
          username:        Deno.env.get("PROD_DB_USER")!,
          password:        Deno.env.get("PROD_DB_PASSWORD")!,
          ssl:             { ca: AKAMAI_CA_CERT },
          connect_timeout: 15,
          max:             1,
          idle_timeout:    10,
        });
        try {
          const rows = await sql.unsafe(
            `SELECT TRIM(policy_nbr) AS policy_nbr, TRIM(wa) AS wa
             FROM typed.unl_fym_policy_latest_load
             WHERE TRIM(policy_nbr) = $1
             LIMIT 1`,
            [policyNumber],
          ) as Array<{ policy_nbr: string; wa: string }>;

          if (rows.length > 0) {
            resolvedPolicyNbr = rows[0].policy_nbr;
            const wa = (rows[0].wa ?? "").trim().toUpperCase();

            // Resolve agency_id via writing number → agency_writing_numbers → agencies
            if (wa) {
              const { data: awnRow } = await supabase
                .from("agency_writing_numbers")
                .select("agency_id")
                .eq("writing_number", wa)
                .maybeSingle();
              agencyId = (awnRow?.agency_id as string) ?? null;
            }

            // Still need the Supabase UUID for the policy_id FK (form_submissions)
            // Do a lightweight lookup — just the id field, no other columns
            const { data: fsRow } = await supabase
              .from("form_submissions")
              .select("id, agency_id")
              .eq("policy_number", policyNumber)
              .maybeSingle();
            policyId = fsRow?.id ?? null;
            if (!agencyId) agencyId = fsRow?.agency_id ?? null;

            foundInMaxDb = true;
            console.log(`[ghl-webhook] policy ${policyNumber} found in Max's DB`);
          }
        } finally {
          try { await sql.end(); } catch { /* ignore */ }
        }
      } catch (dbErr) {
        console.warn(`[ghl-webhook] Max DB lookup failed, falling back to form_submissions: ${dbErr}`);
      }

      // ── Fallback: form_submissions (non-UNL carriers, Max DB unreachable) ─
      if (!foundInMaxDb) {
        const { data: fsRow } = await supabase
          .from("form_submissions")
          .select("id, agency_id, policy_number")
          .eq("policy_number", policyNumber)
          .maybeSingle();
        if (fsRow) {
          policyId          = fsRow.id as string;
          agencyId          = fsRow.agency_id as string | null;
          resolvedPolicyNbr = fsRow.policy_number as string;
          console.log(`[ghl-webhook] policy ${policyNumber} found in form_submissions (fallback)`);
        }
      }

    } else if (phone || email) {
      // Phone/email reverse lookup — form_submissions only
      // (Max's DB phone_nbr is a bigint, not indexed for reverse lookup)
      const today = new Date().toISOString().slice(0, 10);
      let q = supabase
        .from("form_submissions")
        .select("id, agency_id, policy_number")
        .eq("status", "active")
        .eq("billing_form", "DIR")
        .lt("paid_to_date", today)
        .order("paid_to_date", { ascending: true })
        .limit(1);
      q = phone ? q.eq("phone", phone) : q.eq("email", email);
      const { data } = await q;
      const fsRow = data?.[0] ?? null;
      if (fsRow) {
        policyId          = fsRow.id as string;
        agencyId          = fsRow.agency_id as string | null;
        resolvedPolicyNbr = fsRow.policy_number as string;
      }
    } else {
      return jsonResponse({ error: "Provide policy_number, phone, or email" }, 400);
    }

    if (!resolvedPolicyNbr && !policyId) {
      return jsonResponse({ error: "No matching policy found" }, 404);
    }
    if (!agencyId) {
      return jsonResponse({ error: "Policy has no agency_id" }, 409);
    }

    // ── Idempotency: skip if stage already matches ────────────────────────
    const lookupKey = policyId
      ? { policy_id: policyId }
      : { policy_nbr: resolvedPolicyNbr };
    const { data: existing } = await supabase
      .from("policy_dispositions")
      .select("disposition, ghl_contact_id")
      .match(lookupKey)
      .maybeSingle();
    if (
      existing?.disposition === stage &&
      (!ghlContactId || existing?.ghl_contact_id === ghlContactId)
    ) {
      return jsonResponse({ ok: true, policy_id: policyId, policy_nbr: resolvedPolicyNbr, stage, unchanged: true });
    }

    // ── Upsert disposition ────────────────────────────────────────────────
    const upsertRow: Record<string, unknown> = {
      agency_id:   agencyId,
      disposition: stage,
      note:        note || `GHL: ${keyword || rawStage}`,
      sync_origin: "ghl",
      set_at:      new Date().toISOString(),
    };
    if (policyId)          upsertRow.policy_id   = policyId;
    if (resolvedPolicyNbr) upsertRow.policy_nbr  = resolvedPolicyNbr;
    if (ghlContactId)      upsertRow.ghl_contact_id = ghlContactId;

    // Prefer policy_id for conflict resolution (FK); fall back to policy_nbr
    const conflictCol = policyId ? "policy_id" : "policy_nbr";
    const { error: upErr } = await supabase
      .from("policy_dispositions")
      .upsert(upsertRow, { onConflict: conflictCol });
    if (upErr) throw upErr;

    return jsonResponse({ ok: true, policy_id: policyId, policy_nbr: resolvedPolicyNbr, stage });
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Internal server error" },
      500,
    );
  }
});
