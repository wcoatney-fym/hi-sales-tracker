import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey, x-api-key",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function notEmpty(val: string | undefined | null): boolean {
  return typeof val === "string" && val.trim().length > 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const apiKey = req.headers.get("x-api-key");
    const expectedKey = Deno.env.get("AGENT_WEBHOOK_KEY");

    if (!expectedKey || apiKey !== expectedKey) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const body = await req.json();
    const firstName = (body.first_name || "").trim();
    const lastName = (body.last_name || "").trim();
    const npn = (body.agent_npn || "").trim();
    const unlWritingNumber = (body.unl_writing_number || "").trim();
    const gtlWritingNumber = (body.gtl_writing_number || "").trim();

    if (!firstName || !lastName) {
      return jsonResponse({ error: "first_name and last_name are required" }, 400);
    }

    if (!notEmpty(npn) && !notEmpty(unlWritingNumber) && !notEmpty(gtlWritingNumber)) {
      return jsonResponse(
        { error: "At least one identifier is required (agent_npn, unl_writing_number, or gtl_writing_number)" },
        400
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let existing: { id: string; first_name: string; last_name: string; npn: string; unl_writing_number: string; gtl_writing_number: string } | null = null;

    if (notEmpty(npn)) {
      const { data } = await supabase
        .from("agents")
        .select("id, first_name, last_name, npn, unl_writing_number, gtl_writing_number")
        .eq("npn", npn)
        .maybeSingle();
      existing = data;
    }

    if (!existing && notEmpty(unlWritingNumber)) {
      const { data } = await supabase
        .from("agents")
        .select("id, first_name, last_name, npn, unl_writing_number, gtl_writing_number")
        .eq("unl_writing_number", unlWritingNumber)
        .maybeSingle();
      existing = data;
    }

    if (!existing && notEmpty(gtlWritingNumber)) {
      const { data } = await supabase
        .from("agents")
        .select("id, first_name, last_name, npn, unl_writing_number, gtl_writing_number")
        .eq("gtl_writing_number", gtlWritingNumber)
        .maybeSingle();
      existing = data;
    }

    if (existing) {
      const updates: Record<string, string> = { updated_at: new Date().toISOString() };

      if (notEmpty(npn) && !notEmpty(existing.npn)) updates.npn = npn;
      if (notEmpty(unlWritingNumber) && !notEmpty(existing.unl_writing_number)) updates.unl_writing_number = unlWritingNumber;
      if (notEmpty(gtlWritingNumber) && !notEmpty(existing.gtl_writing_number)) updates.gtl_writing_number = gtlWritingNumber;
      if (notEmpty(firstName) && !notEmpty(existing.first_name)) updates.first_name = firstName;
      if (notEmpty(lastName) && !notEmpty(existing.last_name)) updates.last_name = lastName;

      const { error } = await supabase
        .from("agents")
        .update(updates)
        .eq("id", existing.id);

      if (error) throw error;

      return jsonResponse({ success: true, action: "updated", agent_id: existing.id });
    }

    const { data: inserted, error: insertError } = await supabase
      .from("agents")
      .insert({
        first_name: firstName,
        last_name: lastName,
        npn,
        unl_writing_number: unlWritingNumber,
        gtl_writing_number: gtlWritingNumber,
        source: "Contracting Portal",
      })
      .select("id")
      .single();

    if (insertError) throw insertError;

    return jsonResponse({ success: true, action: "created", agent_id: inserted.id });
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Internal server error" },
      500
    );
  }
});
