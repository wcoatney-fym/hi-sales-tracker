# Agency Manager View — Technical Design & Build Outline

**Branch:** `feat/agency-manager-view`
**Status:** DRAFT — for Charlie's approval. No application code ships until approved.
**Author:** Diamond
**Last updated:** 2026-06-26

---

## 1. What we're building (in one line)

A per-agency **Agency Manager** role and view that acts as a security force for the agency's book of business — managers nudge/flag at-risk policies to the *agents who own them*, agents respond and work the policy, and **only the manager** sets the final disposition. A login popup makes sure agents see new nudges the moment they open their portal.

## 2. Core model

```
Agency
  └── members (roster)
        ├── agent          (writes business, owns policies)
        └── manager        (promoted agent OR added non-agent; oversight only)

Manager  --nudge/note/flag-->  Agent  --reply/work-->  Policy
Manager  --disposition-->      Policy   (manager-only verdict)
```

Communication is **two-way** between manager and agent. Dispositions are **manager-only**. The manager never collects directly — they drive the agent to secure their own at-risk policies.

## 3. What already exists (we extend, not rebuild)

| Capability | Where it lives today | How we use it |
|---|---|---|
| Role + agency scoping | `admin_credentials.role` (`global_admin` / `agency_admin`) + `admin_sessions` (role, agency_id) | `agency_admin` becomes the manager role; evolve from shared creds to per-person identity |
| Agent identity + auth | `agents` table, `useAgentAuth` (name + writing number) | Agent side of the conversation + login popup host |
| Agent portal UI | `AgentBookTab`, `AgentDashboardTab`, `AgentAchievementsTab` | Agent mirror view + popup mount point |
| At-risk tracking | `at_risk_activities` (policy_id, agent_id, admin_user, action_type, note) | Extend into the two-way nudge thread |
| Agent action state | `policy_attention_actions` (agent_id, form_submission_id, state: got_it/working/done) | Agent's "working / done" state — already half the worklist |
| Admin UI scaffolding | `AgencyRosterPanel`, `AgentsTable`, `PromotionsPanel` | Build the promote-to-manager UI onto |

## 4. What's net-new

### 4.1 Per-person manager identity (the foundation)
Today an agency logs in with one shared `agency_admin` username/password. The manager role needs **per-person** identity so we can attribute nudges/dispositions and let a manager belong to multiple agencies.

**DECISION (Charlie, 2026-06-26):**
- Each manager gets their **own login** — per-person, not a shared agency credential.
- **Username** keeps the same format/name as the existing admin login (agency-name based).
- **Password is unique per manager.** It is **viewable by the agency admin** (their own managers) **and** in an **overall password log in the FYM global-admin view** — so passwords can be resent or changed.
- A manager is **exclusive to the single agency** they're assigned/added to (no multi-agency managers).
- Managers are **listed separately from the agent roster** — a promoted agent does **not** become a duplicate row in the agent roster; managers render in their own list.

**Implementation:** reuse the existing `admin_credentials` / `admin_sessions` rail (already `agency_admin`, scoped by `agency_id`), but make it **per-person** — one credential row per manager instead of one shared row per agency. Add `agent_id` (set when promoted from roster, null for added non-agents) and `display_name`. Because each row is one person scoped to one `agency_id`, exclusivity is enforced by the schema. The FYM password log is a global-admin read over `admin_credentials WHERE role = 'agency_admin'`; the agency-admin view reads only its own agency's rows.

```
admin_credentials  (extend existing)
  id                  uuid pk          -- exists
  agency_id           uuid fk          -- exists; single agency = exclusivity
  email_domain        text             -- exists; the username (admin-login format)
  password            text             -- exists; now UNIQUE PER PERSON, surfaced in admin views
  role                text             -- exists; 'agency_admin' = manager
+ agent_id            uuid fk -> agents(id) nullable   -- set if promoted from roster
+ display_name        text
  session_duration_days integer        -- exists
  created_at          timestamptz      -- exists
```

> **UI note:** managers surface in a dedicated "Agency Managers" list, separate from the agent roster (`AgencyRosterPanel`). Promoting an agent links `agent_id` but creates a manager entry, not a second roster row.
>
> **Worth a Chris heads-up** (not a blocker): this lights up the `admin_credentials` rail as a per-person login store, which brushes the contracting/onboarding identity flow.

### 4.2 Two-way nudge thread
Extend `at_risk_activities` (or a sibling `policy_notes` table) so it reads as a conversation:

```
+ author_role   text check (author_role in ('manager','agent'))
+ kind          text check (kind in ('note','nudge','flag'))   default 'note'
```

- `kind = 'flag'` marks the policy as needing attention → feeds the agent worklist + a notification.
- Manager posts nudge/note/flag; agent replies in the same thread.

### 4.3 Manager-only disposition
```
policy_dispositions
  id            uuid pk
  policy_id     uuid fk -> form_submissions(id)
  agency_id     uuid fk -> agencies(id)
  disposition   text check (disposition in ('working','secured','lost','follow_up'))
  note          text
  set_by        uuid          -- manager member id
  set_at        timestamptz
```
Write is gated to `role = manager` **in the edge function** (service-role functions enforce the role check; RLS stays locked to service_role as today). Agents read, never write.

### 4.4 Notifications + login popup
```
notifications
  id            uuid pk
  recipient_id  uuid          -- agent (or manager for replies)
  agency_id     uuid fk -> agencies(id)
  policy_id     uuid fk -> form_submissions(id) nullable
  type          text check (type in ('nudge','flag','reply'))
  read_at       timestamptz nullable
  created_at    timestamptz
```
- On manager nudge/flag → insert a notification for the agent.
- Agent portal queries **unread on load** → renders a modal: "Your manager flagged N policies — review now." Mark read on dismiss / click-through.
- Manager gets a badge (not a modal) when an agent replies.
- Start with **poll-on-load**; upgrade to Supabase realtime later if needed.

## 5. The two views

### Manager view (main screen) — 3 panels
1. **Agency 90-day retention** vs the 90% line + leaderboard rank.
2. **At-risk worklist**, worst-first, with per-policy disposition + note/thread state.
3. **Agent-by-agent production** to surface coaching opportunities.

Click a policy → note thread + disposition control.

### Agent view (mirror)
"My at-risk policies + nudges from my manager." Login popup fires here. Agent can reply and update their working state, **cannot** disposition.

## 6. Security & guardrails (non-negotiable)
- All writes hit **our app tables only** — UNL production/commission data stays **read-only** (Max/Zach's domain).
- Disposition writes gated to manager role at the edge-function layer.
- Agents scoped to their own policies + threads; managers scoped to their agencies only.
- RLS stays locked to `service_role`; all access flows through `admin-api` / `agent-webhook` edge functions, consistent with the current architecture.
- No direct pushes to `main`; no production deploy without sign-off.

## 7. Build sequence (proposed)
1. **Manager identity** — extend `admin_credentials` (per-person, `agent_id` + `display_name`) + auth scoping + password-log reads (agency-admin own rows, FYM global-admin all). *Foundation; decided.*
2. **Nudge thread** — extend `at_risk_activities` with `author_role` + `kind`; thread API in `admin-api` / `agent-webhook`.
3. **Disposition** — `policy_dispositions` table + manager-gated write.
4. **Notifications + popup** — `notifications` table + agent-portal poll-on-load modal.
5. **Manager view UI** — 3-panel screen.
6. **Agent mirror view** — extend existing agent tabs + popup.
7. Tests + staging proof, then PR for review.

## 8. What I need to proceed
- **Approval of this outline.**
- The identity decision (§4.1) is **locked** (Charlie, 2026-06-26). Optional Chris heads-up since it lights up `admin_credentials` as a per-person login store.
- Your explicit go-ahead to write code (per the agreed gate: outline approved first, then implementation).

---
*Draft migration scaffolding lives alongside this doc on `feat/agency-manager-view` and is illustrative only — not finalized until the identity decision lands.*
