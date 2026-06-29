// Deno tests for resolveAgentIdFromPolicy.
// Run: deno test supabase/functions/admin-api/resolve.test.ts
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveAgentIdFromPolicy, type SupabaseLike } from "./resolve.ts";

// Builds a stub Supabase client. `policyRow` is returned for the
// form_submissions lookup; `agentResolver` receives the `.or()` filter string
// and returns the matching agents rows.
function makeStub(opts: {
  policyRow: { agent_number: string } | null;
  agentResolver: (orFilter: string) => Array<{ id: string }>;
}): { supabase: SupabaseLike; capturedOr: () => string | null } {
  let capturedOr: string | null = null;
  const supabase: SupabaseLike = {
    from(table: string) {
      if (table === "form_submissions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: opts.policyRow }),
            }),
          }),
        };
      }
      // agents
      return {
        select: () => ({
          or: (filter: string) => {
            capturedOr = filter;
            return { limit: () => Promise.resolve({ data: opts.agentResolver(filter) }) };
          },
        }),
      };
    },
  };
  return { supabase, capturedOr: () => capturedOr };
}

Deno.test("resolves a single matching agent by current writing number", async () => {
  const { supabase, capturedOr } = makeStub({
    policyRow: { agent_number: "202ABC11" },
    agentResolver: () => [{ id: "agent-1" }],
  });
  const id = await resolveAgentIdFromPolicy(supabase, "policy-1");
  assertEquals(id, "agent-1");
  // Writing number is normalized (trim/upper) and used across UNL/GTL/prior.
  assertStringIncludes(capturedOr()!, "unl_writing_number.eq.202ABC11");
  assertStringIncludes(capturedOr()!, "gtl_writing_number.eq.202ABC11");
  assertStringIncludes(capturedOr()!, "prior_writing_numbers.cs.{202ABC11}");
});

Deno.test("normalizes lowercase/whitespace agent_number before matching", async () => {
  const { supabase, capturedOr } = makeStub({
    policyRow: { agent_number: "  202jvvbb " },
    agentResolver: () => [{ id: "agent-price" }],
  });
  const id = await resolveAgentIdFromPolicy(supabase, "policy-x");
  assertEquals(id, "agent-price");
  assertStringIncludes(capturedOr()!, "202JVVBB");
});

Deno.test("resolves via a prior/alias writing number after reassignment", async () => {
  // Policy still stamped with the OLD number; agent matched via prior_writing_numbers.
  const { supabase } = makeStub({
    policyRow: { agent_number: "202JVVBB" },
    agentResolver: (filter) =>
      filter.includes("prior_writing_numbers.cs.{202JVVBB}") ? [{ id: "agent-price" }] : [],
  });
  const id = await resolveAgentIdFromPolicy(supabase, "policy-old-num");
  assertEquals(id, "agent-price");
});

Deno.test("returns null when the writing number is ambiguous (two agents)", async () => {
  const { supabase } = makeStub({
    policyRow: { agent_number: "202DUPE0" },
    agentResolver: () => [{ id: "agent-a" }, { id: "agent-b" }],
  });
  const id = await resolveAgentIdFromPolicy(supabase, "policy-dupe");
  assertEquals(id, null);
});

Deno.test("returns null when no agent owns the writing number", async () => {
  const { supabase } = makeStub({
    policyRow: { agent_number: "202NONE0" },
    agentResolver: () => [],
  });
  const id = await resolveAgentIdFromPolicy(supabase, "policy-orphan");
  assertEquals(id, null);
});

Deno.test("returns null when the policy has a blank agent_number", async () => {
  let agentsQueried = false;
  const { supabase } = makeStub({
    policyRow: { agent_number: "   " },
    agentResolver: () => {
      agentsQueried = true;
      return [{ id: "should-not-happen" }];
    },
  });
  const id = await resolveAgentIdFromPolicy(supabase, "policy-blank");
  assertEquals(id, null);
  assertEquals(agentsQueried, false); // short-circuits before querying agents
});

Deno.test("returns null when the policy does not exist", async () => {
  const { supabase } = makeStub({
    policyRow: null,
    agentResolver: () => [],
  });
  const id = await resolveAgentIdFromPolicy(supabase, "missing");
  assertEquals(id, null);
});
