# Agency Manager View — API Contract (backend is built)

Backend endpoints are implemented on branch `feat/agency-manager-view`. Frontend wires to these.

## Edge functions
- **admin-api** (POST JSON, action in body). Auth: `token` in body (from `manager-login` or `login`).
- **leaderboard-api** (action in `?action=` query). Agent auth: `X-Agent-Token` header.

## admin-api actions

### Public
- `manager-login` → body `{ username, password }` → `{ token, manager_id, username, display_name, role:'manager', agency_id, agency_slug, agency_name }`

### Manager management (role: global_admin or agency_admin; token in body)
- `list-agency-managers` → optional `{ agency_id }` (global only; agency_admin auto-scoped) → `{ managers: [{ id, agency_id, username, password, agent_id, display_name, is_active, created_at }] }`  ← password included = the password log
- `create-agency-manager` → `{ agency_id?, agent_id?, display_name? }` (agent_id promotes a roster agent; else display_name for a non-agent) → `{ manager: {...} }` (includes generated username+password)
- `reset-agency-manager-password` → `{ manager_id }` → `{ manager_id, password }`
- `toggle-agency-manager` → `{ manager_id, is_active }` → `{ manager_id, is_active }`

### Manager data (role: manager; token in body)
- `mgr-at-risk-worklist` → `{ worklist: [{ id, policy_number, client_first_name, client_last_name, agent_first_name, agent_last_name, agent_number, product_type, carrier, plan_premium, status, paid_to_date, policy_effective_date, disposition }], agency_id }`
- `mgr-policy-thread` → `{ policy_id }` → `{ thread: [{ id, policy_id, agent_id, author_role, kind, note, manager_id, created_at }], disposition }`
- `mgr-post-note` → `{ policy_id, agent_id?, note, kind:'note'|'nudge'|'flag' }` → `{ activity_id }` (nudge/flag with agent_id → notifies agent)
- `mgr-set-disposition` → `{ policy_id, disposition:'working'|'secured'|'lost'|'follow_up', note?, follow_up_at? }` → `{ policy_id, disposition }`

For the manager retention panel + agent-by-agent production, reuse existing admin endpoints scoped by the manager's agency (e.g. `get-quality-metrics` RPC / `get-agent-breakdown`) — the manager session carries `agency_id`.

## leaderboard-api actions (agent side; `X-Agent-Token` header)
- `agent-get-notifications` (`?unread=1` for popup) → `{ notifications: [{ id, policy_id, activity_id, type, body, read_at, created_at }] }`
- `agent-mark-notifications-read` (POST `{ ids? }`; omit ids = mark all) → `{ success }`
- `agent-get-policy-thread` (`?policy_id=`) → `{ thread: [...] }`
- `agent-reply-note` (POST `{ policyId, note }`) → `{ activity_id }` (notifies agency managers)

## Frontend tasks
1. `src/lib/api.ts` — add typed wrappers for all the above.
2. **Manager login + view** — new route (e.g. `/manager`), 3 panels: agency 90-day retention vs 90% + leaderboard rank; at-risk worklist (worst-first, disposition control + note thread, manager-only); agent-by-agent production.
3. **Agency Managers admin list** — in `AgencyRosterPanel`/admin: a dedicated "Agency Managers" section (separate from agent roster), create (promote agent or add non-agent), show username+password, reset password, toggle. Global-admin password log across agencies.
4. **Agent login popup** — on agent portal load, call `agent-get-notifications?unread=1`; if any, show modal listing flagged/nudged policies; mark read on dismiss/click-through.
5. **Agent mirror** — in `AgentBookTab`: "Nudges from my manager" — show flagged policies + thread, allow reply (`agent-reply-note`), but NO disposition control.
