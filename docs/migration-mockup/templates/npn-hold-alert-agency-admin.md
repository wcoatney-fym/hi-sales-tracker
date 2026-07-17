# NPN Hold Alert — Agency Admin Template

> ⚠️ **CLIENT-FACING — HUMAN-GATED UNTIL GO-LIVE APPROVED**
>
> This template is drafted for reference only. The send path in `npn-gate.ts`
> is DRY-RUN only — it logs the content and sends nothing.
> Agency-admin sends go to external clients (agency owners/managers).
> Do NOT enable the send path without explicit go-live approval from Will.

---

## When This Alert Fires

An agency admin receives this alert when one or more of their agents is missing
an NPN in the FYM roster, causing GHL notifications to be held.

Trigger: `npn_holds` row written with `status = 'held'` for an agent in their agency.

---

## Template Variables

| Variable | Source |
|---|---|
| `{{agency_name}}` | `npn_holds.agency_name` (denormalized from ga_name) |
| `{{agent_name}}` | `npn_holds.agent_name` (wa_name from Max's DB) |
| `{{writing_number}}` | `npn_holds.writing_number` (normalized UPPER) |
| `{{held_count}}` | COUNT of held rows for this agent |
| `{{trigger_types}}` | comma-joined trigger_type values for held rows |

---

## Subject

```
Action needed — agent NPN missing for {{agent_name}}
```

---

## Body

```
Hi {{agency_name}} team,

We're holding {{held_count}} policy notification(s) for agent {{agent_name}}
(writing number: {{writing_number}}) because their National Producer Number (NPN)
is not on file.

To release these notifications, please add the NPN for {{agent_name}} to your
agency roster.

Affected trigger types: {{trigger_types}}

Once added, the held notifications will be reviewed and released by the FYM team.
```

---

## FYM Admin Alert (internal only — not client-facing)

Sent to FYM admin Slack/email. No approval gate for internal sends,
but still DRY-RUN only in mockup phase.

```
NPN Hold Alert — FYM Admin
Total held rows: {{total_held}}
Affected agents: {{agent_count}}

Agency: {{agency_name}} | Agent: {{agent_name}} ({{writing_number}}) | Held: {{held_count}} | Triggers: {{trigger_types}}
[...one line per agent...]
```

---

## Resolution Flow

1. Agency admin adds NPN to their roster CSV → re-uploads via portal
2. `agency_rosters` row updated with NPN
3. Resolution scan detects NPN now present for `writing_number`
4. `npn_holds` rows flipped to `status = 'resolved'`, `released_at = NOW()`
5. Rows promoted to `proposed_fires` with NPN attached
6. **FYM team approves via the admin portal** — "NPN Holds" tab surfaces
   `proposed_fires` rows grouped by agency/agent with Approve/Skip per row.
   Clicking Approve sets `approved_at + approved_by`. (Confirmed location: admin portal, 2026-07-17.)
7. After approval + successful push: `proposed_fires.fired_at` set,
   `fired_triggers` row inserted to close the idempotency loop

> **End state (post go-live):** Step 6 is removed — NPN resolution auto-fires.
> The `proposed_fires` approval gate + admin portal "NPN Holds" tab are mockup-phase only.
