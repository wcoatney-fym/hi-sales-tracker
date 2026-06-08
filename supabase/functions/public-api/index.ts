import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "verify-agent": {
        const { firstName, lastName, carrier } = body;

        if (!firstName || !lastName || !carrier) {
          return jsonResponse({ error: "Missing required fields" }, 400);
        }

        // Check agency_rosters first (agency-uploaded rosters)
        const { data: agencyRosterMatch } = await supabase
          .from("agency_rosters")
          .select("writing_number, npn")
          .ilike("agent_first_name", firstName.trim())
          .ilike("agent_last_name", lastName.trim())
          .eq("carrier", carrier)
          .eq("status", "active")
          .eq("match_status", "confirmed")
          .limit(1)
          .maybeSingle();

        if (agencyRosterMatch) {
          return jsonResponse({ found: true, agentNumber: agencyRosterMatch.writing_number, npn: agencyRosterMatch.npn || "" });
        }

        // Check global carrier roster
        const { data: activeUpload } = await supabase
          .from("roster_uploads")
          .select("id")
          .eq("carrier", carrier)
          .eq("is_active", true)
          .maybeSingle();

        if (activeUpload) {
          const { data, error } = await supabase
            .from("agent_rosters")
            .select("agent_number, npn")
            .ilike("first_name", firstName.trim())
            .ilike("last_name", lastName.trim())
            .eq("carrier", carrier)
            .eq("roster_upload_id", activeUpload.id)
            .maybeSingle();

          if (error) throw error;
          if (data) {
            return jsonResponse({ found: true, agentNumber: data.agent_number, npn: data.npn || "" });
          }
        }

        // Fall back to agents table
        const writingCol = carrier === "UNL" ? "unl_writing_number" : "gtl_writing_number";
        const { data: portalAgent, error: portalError } = await supabase
          .from("agents")
          .select(`${writingCol}, npn`)
          .ilike("first_name", firstName.trim())
          .ilike("last_name", lastName.trim())
          .not(writingCol, "eq", "")
          .maybeSingle();

        if (portalError) throw portalError;

        if (portalAgent && portalAgent[writingCol]) {
          return jsonResponse({ found: true, agentNumber: portalAgent[writingCol], npn: portalAgent.npn || "" });
        }

        return jsonResponse({ found: false });
      }

      case "submit-form": {
        const { formData } = body;

        if (!formData) {
          return jsonResponse({ error: "Missing form data" }, 400);
        }

        const today = new Date().toISOString().slice(0, 10);
        const submittedDate = (formData.appSubmitDate || "").trim();
        const appSubmitDate = submittedDate && submittedDate <= today ? submittedDate : today;
        const toTitleCase = (s: string) => s.trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
        const cleanFirstName = toTitleCase(formData.agentFirstName || "");
        const cleanLastName = toTitleCase((formData.agentLastName || "").trim().replace(/^[A-Za-z]\.?\s+/, ""));
        const agentNum = (formData.agentNumber || "").toUpperCase();

        // Look up agent's agency -- reject if agent not found
        // Roster takes priority over agent record for agency assignment
        let agency = "FYM";
        let agencyId: string | null = null;
        if (agentNum) {
          // Check roster first
          const { data: rosterMatch } = await supabase
            .from("agency_rosters")
            .select("agency_id, agencies:agency_id(name)")
            .eq("writing_number", agentNum)
            .eq("match_status", "confirmed")
            .eq("status", "active")
            .maybeSingle();

          if (rosterMatch && rosterMatch.agencies) {
            agency = (rosterMatch.agencies as { name: string }).name;
            agencyId = rosterMatch.agency_id;
          } else {
            // Fall back to agent record (check both UNL and GTL writing numbers)
            const { data: agentRow } = await supabase
              .from("agents")
              .select("agency, agency_id")
              .or(`unl_writing_number.eq.${agentNum},gtl_writing_number.eq.${agentNum}`)
              .maybeSingle();
            if (agentRow) {
              if (agentRow.agency) agency = agentRow.agency;
              agencyId = agentRow.agency_id || null;
            } else {
              return jsonResponse({ error: "Agent not recognized. Please verify your writing number or contact your agency admin." }, 400);
            }
          }
        }

        // If no agency_id resolved, look it up by name
        if (!agencyId && agency) {
          const { data: agencyRow } = await supabase
            .from("agencies")
            .select("id")
            .eq("name", agency)
            .maybeSingle();
          agencyId = agencyRow?.id || null;
        }

        // Check if a matching Data Source record already exists (same agent/client/zip)
        // Use first word of first name only to handle middle initials (e.g. "Dale" matches "Dale M")
        let intakeStatus: string | undefined = undefined;
        let intakeDuplicateFlag = false;
        const clientFirst = (formData.clientFirstName || "").trim().split(/\s+/)[0];
        const clientLast = (formData.clientLastName || "").trim();
        const clientZip = (formData.zip || "").trim();
        if (agentNum && clientFirst && clientLast && clientZip) {
          const { data: existingMatch } = await supabase
            .from("form_submissions")
            .select("id, source, policy_effective_date, client_first_name")
            .eq("agent_number", agentNum)
            .ilike("client_first_name", clientFirst + "%")
            .ilike("client_last_name", clientLast)
            .eq("zip", clientZip)
            .not("status", "in", "(duplicate,superseded)")
            .limit(1)
            .maybeSingle();

          if (existingMatch) {
            if (existingMatch.source === "Data Source") {
              intakeStatus = "superseded";
              intakeDuplicateFlag = true;
            } else {
              const effectiveDate = formData.policyEffectiveDate;
              const existingDate = existingMatch.policy_effective_date;
              if (effectiveDate && existingDate) {
                const daysDiff = Math.abs(
                  (new Date(effectiveDate).getTime() - new Date(existingDate).getTime()) / (1000 * 60 * 60 * 24)
                );
                if (daysDiff <= 14) {
                  intakeStatus = "duplicate";
                  intakeDuplicateFlag = true;
                }
              }
            }
          }
        }

        const { error } = await supabase.from("form_submissions").insert({
          agent_first_name: cleanFirstName,
          agent_last_name: cleanLastName,
          carrier: formData.carrier,
          agent_number: agentNum,
          product_type: formData.productType || "HI",
          client_first_name: formData.clientFirstName,
          client_last_name: formData.clientLastName,
          phone: formData.phone,
          email: formData.email,
          address: formData.address,
          city: formData.city,
          state: formData.state,
          zip: formData.zip,
          plan_name: formData.planName,
          policy_effective_date: formData.policyEffectiveDate,
          plan_premium: parseFloat(formData.planPremium) || 0,
          app_submit_date: appSubmitDate,
          agency,
          agency_id: agencyId,
          ...(intakeStatus ? { status: intakeStatus, duplicate_flag: intakeDuplicateFlag } : {}),
        });

        if (error) throw error;

        try {
          await fetch(
            "https://hooks.zapier.com/hooks/catch/25274165/up1e31i/",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                agent_first_name: formData.agentFirstName,
                agent_last_name: formData.agentLastName,
                carrier: formData.carrier,
                agent_number: formData.agentNumber,
                npn: formData.npn || "",
                product_type: formData.productType || "HI",
                client_first_name: formData.clientFirstName,
                client_last_name: formData.clientLastName,
                phone: formData.phone,
                email: formData.email,
                address: formData.address,
                city: formData.city,
                state: formData.state,
                zip: formData.zip,
                plan_name: formData.planName,
                policy_effective_date: (() => {
                  const [y, m, d] = (formData.policyEffectiveDate || "").split("-");
                  return y ? `${m}/${d}/${y}` : "";
                })(),
                plan_premium: parseFloat(formData.planPremium) || 0,
              }),
            }
          );
        } catch (_) {
          // Zapier webhook is fire-and-forget; don't block submission on failure
        }

        return jsonResponse({ success: true });
      }

      case "get-lead-form-config": {
        const { data: setting } = await supabase
          .from("admin_settings")
          .select("value")
          .eq("key", "fym_lead_form_enabled")
          .maybeSingle();

        const enabled = setting?.value?.enabled === true;

        const { data: vendors } = await supabase
          .from("lead_vendors")
          .select("id, name")
          .eq("is_active", true)
          .order("name");

        return jsonResponse({ enabled, vendors: vendors || [] });
      }

      case "submit-lead": {
        const { formData } = body;
        if (!formData) return jsonResponse({ error: "Missing form data" }, 400);

        const { agentFirstName, agentLastName, carrier, clientFirstName, clientLastName, phone, leadVendor } = formData;

        if (!agentFirstName || !agentLastName || !carrier || !clientFirstName || !clientLastName || !phone || !leadVendor) {
          return jsonResponse({ error: "All fields are required" }, 400);
        }

        // Check if lead form is enabled
        const { data: toggleSetting } = await supabase
          .from("admin_settings")
          .select("value")
          .eq("key", "fym_lead_form_enabled")
          .maybeSingle();

        if (!toggleSetting?.value?.enabled) {
          return jsonResponse({ error: "Lead form is currently disabled" }, 403);
        }

        // Verify agent and get writing number (same logic as verify-agent)
        const fn = agentFirstName.trim();
        const ln = agentLastName.trim();
        let agentNumber = "";

        const { data: arMatch } = await supabase
          .from("agency_rosters")
          .select("writing_number")
          .ilike("agent_first_name", fn)
          .ilike("agent_last_name", ln)
          .eq("carrier", carrier)
          .eq("status", "active")
          .eq("match_status", "confirmed")
          .limit(1)
          .maybeSingle();

        if (arMatch) {
          agentNumber = arMatch.writing_number;
        } else {
          const { data: activeUpload } = await supabase
            .from("roster_uploads")
            .select("id")
            .eq("carrier", carrier)
            .eq("is_active", true)
            .maybeSingle();

          if (activeUpload) {
            const { data: rosterAgent } = await supabase
              .from("agent_rosters")
              .select("agent_number")
              .ilike("first_name", fn)
              .ilike("last_name", ln)
              .eq("carrier", carrier)
              .eq("roster_upload_id", activeUpload.id)
              .maybeSingle();
            if (rosterAgent) agentNumber = rosterAgent.agent_number;
          }

          if (!agentNumber) {
            const writingCol = carrier === "UNL" ? "unl_writing_number" : "gtl_writing_number";
            const { data: portalAgent } = await supabase
              .from("agents")
              .select(`${writingCol}`)
              .ilike("first_name", fn)
              .ilike("last_name", ln)
              .not(writingCol, "eq", "")
              .maybeSingle();
            if (portalAgent && portalAgent[writingCol]) {
              agentNumber = portalAgent[writingCol];
            }
          }
        }

        if (!agentNumber) {
          return jsonResponse({ error: "Agent not found. Please verify name and carrier." }, 400);
        }

        // Resolve agency
        let agency = "FYM";
        let agencyId: string | null = null;
        const upperNum = agentNumber.toUpperCase();

        const { data: rosterMatch } = await supabase
          .from("agency_rosters")
          .select("agency_id, agencies:agency_id(name)")
          .eq("writing_number", upperNum)
          .eq("match_status", "confirmed")
          .eq("status", "active")
          .maybeSingle();

        if (rosterMatch?.agencies) {
          agency = (rosterMatch.agencies as { name: string }).name;
          agencyId = rosterMatch.agency_id;
        } else {
          const { data: agentRow } = await supabase
            .from("agents")
            .select("agency, agency_id")
            .or(`unl_writing_number.eq.${upperNum},gtl_writing_number.eq.${upperNum}`)
            .maybeSingle();
          if (agentRow) {
            if (agentRow.agency) agency = agentRow.agency;
            agencyId = agentRow.agency_id || null;
          }
        }

        if (!agencyId && agency) {
          const { data: agencyRow } = await supabase
            .from("agencies")
            .select("id")
            .eq("name", agency)
            .maybeSingle();
          agencyId = agencyRow?.id || null;
        }

        const toTitleCase = (s: string) => s.trim().toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase());

        const { error: insertErr } = await supabase.from("lead_submissions").insert({
          agent_first_name: toTitleCase(agentFirstName),
          agent_last_name: toTitleCase(agentLastName),
          agent_number: upperNum,
          carrier,
          client_first_name: toTitleCase(clientFirstName),
          client_last_name: toTitleCase(clientLastName),
          phone,
          lead_vendor: leadVendor,
          agency,
          agency_id: agencyId,
        });

        if (insertErr) throw insertErr;
        return jsonResponse({ success: true });
      }

      default:
        return jsonResponse({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Internal server error" },
      500
    );
  }
});
