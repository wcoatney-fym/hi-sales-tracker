# At-Risk Retention Campaign — Blueprint (HHC first)

Status: DRAFT for review. Nothing sends until human approval (draft → approve rail).
Owner: Growth/Dev (Diamond + Charlie). Product scope: **Home Health Care (HHC)** first, then HI/Life/DV/Cancer.

---

## 1. Purpose

An at-risk flag opens a **45-day save window** in which a policy can still be recovered before it
lapses/terminates (chargeback). This campaign's **single job is to manufacture a client response**
(a keyword reply), then hand the live conversation to a human to close the save. Automation gets the
hand raised; managers and agents close.

At-risk definition (locked): `active` + Direct-bill/monthly (DIR) + `paid_to_date < today`.
Flag fires on flip-true from the lifecycle evaluator; clears on recovery.

---

## 2. Pipeline (unchanged — no new stages)

Canonical shared stages, mirrored 1:1 between the tracker (source of truth) and GHL:

```
new | responded | manager_outreach | agent_outreach | agent_saved_pending(Pending) | saved | lost
```

Stages are **ownership/state**, not time. The 45-day timeline is expressed as **backend time
triggers**, not stages.

- **Automation ON** only in `new`, day-count driven.
- **Automation OFF (paused)** the instant a human is involved or it is terminal:
  `responded | manager_outreach | agent_outreach | agent_saved_pending | saved | lost`.
- **Global kill switch** (code-red manual hold) is the first guard on every workflow.

---

## 3. Timeline (three automated phases, all within `new`)

| Phase | Days | Intent | Cadence |
|---|---|---|---|
| Sprint | 0–7 | Manufacture a reply fast — most saves start here | Heavy, front-loaded |
| Drip | 7–35 | Stay present, keep asking, add specifics | Steady, spaced |
| Code Red | 35–45 | Re-intensify to the deadline | Ramped, urgency |

`days_remaining = 45 − days_since_flag`, carried on the record; drives messaging and worst-first
prioritization (fewest days left worked first).

---

## 4. Workflows

### WF1 — At-Risk Cadence (the engine)
- **Trigger:** enters `new` (lifecycle evaluator, at_risk flip-true).
- **Entry guards:** not opted out; not past `saved`/`lost`; global kill switch off; quiet hours
  (8a–9p client-local, else queue to next window).
- **Behavior:** runs the Sprint → Drip → Code Red cadence off day-count. Every timed step
  **re-checks guards at fire time** (still `new`, still at-risk, not opted out, no inbound since
  last touch). If any guard fails → skip/exit.
- **Exit:** any inbound → WF2; disposition into manager/agent/saved/lost → automation off; day 45
  unsaved → `lost`.

### WF2 — Inbound Keyword Router (the success event)
- **Trigger:** inbound SMS on an at-risk contact.
- **Logic (mirrors tracker `KEYWORD_STAGE`):**
  - `SAVE | YES | HELP` → `responded` (owner = manager), **halt cadence**, alert owner.
  - `STOP | CANCEL` → `manager_outreach` + opt-out flag (routes a human, suppresses future outbound).
  - Any other free-text → treat as engagement → `responded` + notify (never let a real reply rot).
- Posts back to tracker webhook with `sync_origin=ghl` (loop-kill). **An inbound reply pauses all
  outbound** — these are the easiest saves on the board.

### WF3 — Manager Escalation
- **Trigger:** enters `manager_outreach` (keyword STOP/CANCEL, or a human/manager routes it).
- **Actions:** manager task w/ SLA (first touch ≤ 4 business hrs), full context (carrier, plan,
  premium, days-remaining, reason). Manager works the save.
- **Branch:** working → keep/hand to `agent_outreach`; can't reach after N attempts → `agent_outreach`.

### WF4 — Agent Handoff
- **Trigger:** enters `agent_outreach` (owner = agent).
- **Rationale:** writing agent has the relationship + chargeback exposure.
- **Actions:** notify agent (SMS + task), provide script + the exact fix (update payment / re-draft).

### WF5 — Save Gate (Pending)
- **Trigger:** a "Saved" move lands as `agent_saved_pending` (Pending) because
  `SAVED_FROM_GHL_REQUIRES_APPROVAL = true`.
- **Actions:** manager-confirm task. Confirmed → `saved`. Not actually fixed → back to `agent_outreach`.
- Guards against premature save credit. Recommend keeping ON until the data round-trip is trusted.

### WF6 — Exit & Resurrection
- `saved`: on next UNL pull, if `paid_to_date` advances → save held; if it slips → re-enter `new`.
- `lost`: terminal after deadline/outreach exhausted. Suppress cadence. If evaluator later sees it
  go active again → resurrection to `new`.

### WF0 — Code Red / Global Hold (kill switch)
- Book-wide or per-agency suppression flag checked first by every workflow. On → all automated
  outbound pauses in place (no records lost); off → timers resume from record state. For carrier
  issues, data-feed problems, or compliance freezes.

---

## 5. Message templates (HHC)

Naming convention: **`stage | description | send day X`**.
All automated sends live in the `new` stage. Merge fields:
- Agent (All Templates set): `{{contact.all_templates__agent_first_name}}`,
  `{{contact.all_templates__agent_full_name}}`, `{{contact.all_templates__agent_mobile_}}`,
  `{{contact.all_templates__agent_email}}`, `{{contact.all_templates__agent_title}}`,
  `{{contact.all_templates__agent_digital_business_card_link}}`,
  `{{contact.all_templates__agency_client_support_}}`.
- Policy (HHC set): `{{contact.hhc__carrier_name}}`, `{{contact.hhc__plan_name}}`,
  `{{contact.hhc__plan_premium}}`, `{{contact.hhc__paid_to_date}}`, `{{contact.hhc__policy_number}}`.

Every SMS carries a single CTA (reply **SAVE**) and TCPA opt-out (reply **STOP**).

### 5a. SMS — Sprint (Day 0–7)

**`new | sprint - soft fix first touch | send day 0`**
```
Hi {{contact.first_name}}, it's {{contact.all_templates__agent_first_name}} with your
{{contact.hhc__carrier_name}} home health plan. Your last payment didn't go through, so the
policy's at risk of canceling. Good news - it's a quick fix and I can take care of it. Reply
SAVE and I'll call you right back. Reply STOP to opt out.
```

**`new | sprint - benefit reminder | send day 1`**
```
Hi {{contact.first_name}}, {{contact.all_templates__agent_first_name}} again. I don't want you
to lose the home health coverage you signed up for over a missed payment - it only takes a
couple minutes to fix. Reply SAVE and I'll handle it today.
```

**`new | sprint - checking in | send day 3`**
```
Hi {{contact.first_name}}, {{contact.all_templates__agent_first_name}} here checking in on your
{{contact.hhc__carrier_name}} plan. It's still active but needs the payment updated to stay that
way. Reply SAVE and we'll knock it out.
```

**`new | sprint - what changed | send day 5`**
```
Hey {{contact.first_name}}, did something change with the plan, or was the missed payment just a
hiccup? Either way I can help - reply SAVE and let's sort it out.
```

**`new | sprint - week one close | send day 7`**
```
Hi {{contact.first_name}}, last check-in from me this week. Your home health policy is still
savable. Reply SAVE and I'll take care of the rest.
```

### 5b. SMS — Drip (Day 7–35)

**`new | drip - value + premium | send day 12`**
```
Hi {{contact.first_name}}, {{contact.all_templates__agent_first_name}} here. Your
{{contact.hhc__plan_name}} is just {{contact.hhc__plan_premium}}/mo - a lot of coverage to walk
away from. I can get the payment back on track in minutes. Reply SAVE.
```

**`new | drip - no pressure reassurance | send day 18`**
```
Hi {{contact.first_name}}, no pressure - I just don't want you to lose your coverage by accident.
If you still want the plan, reply SAVE and I'll fix the billing for you.
```

**`new | drip - agent direct line | send day 24`**
```
Hi {{contact.first_name}}, it's {{contact.all_templates__agent_first_name}}, your agent on the
{{contact.hhc__carrier_name}} plan. Reach me at {{contact.all_templates__agent_mobile_}} or just
reply SAVE and I'll call you.
```

**`new | drip - still on the list | send day 30`**
```
Hi {{contact.first_name}}, your home health policy is still on the at-risk list. It's not too
late to keep it - reply SAVE and I'll walk you through the quick fix.
```

### 5c. SMS — Code Red (Day 35–45)

**`new | code red - deadline open | send day 35`**
```
Hi {{contact.first_name}}, important: your {{contact.hhc__carrier_name}} home health plan will
cancel soon if the payment isn't updated. There's still time to save it. Reply SAVE now and I'll
call you today.
```

**`new | code red - close to canceling | send day 38`**
```
{{contact.first_name}}, your policy is close to permanently canceling and I really don't want you
to lose this coverage. Reply SAVE and I'll personally make sure it's fixed.
```

**`new | code red - almost out of time | send day 41`**
```
Hi {{contact.first_name}}, we're almost out of time to keep your home health plan active. This is
one of the last chances to save it - reply SAVE and I'll handle everything.
```

**`new | code red - last call | send day 43`**
```
{{contact.first_name}}, final notice from me - your {{contact.hhc__carrier_name}} policy cancels
in a couple days. Reply SAVE right now and I'll stop the cancellation.
```

**`new | code red - deadline day | send day 45`**
```
{{contact.first_name}}, today is the last day to save your home health coverage. Reply SAVE
immediately and I'll get it done before it's too late.
```

### 5d. Email (Resend — draft → approve rail)

Emails supplement SMS at key beats; CTA = reply SAVE or call the agent. From identity:
`FYM Activation <activation@send.teamfym.com>`, Reply-To `will@teamfym.com` (or agent per config).

**`new | sprint - email quick fix | send day 0`**
- Subject: `Quick fix to keep your {{contact.hhc__carrier_name}} plan active`
- Body:
```
Hi {{contact.first_name}},

This is {{contact.all_templates__agent_full_name}}, your agent on the
{{contact.hhc__carrier_name}} home health plan. Your most recent payment didn't go through, which
puts the policy at risk of canceling.

The good news: it's a quick fix and I can handle it for you. Just reply SAVE to my text, or call
me directly at {{contact.all_templates__agent_mobile_}}.

I don't want you to lose coverage over a billing hiccup.

{{contact.all_templates__agent_full_name}}
{{contact.all_templates__agent_title}}
{{contact.all_templates__agent_mobile_}}
```

**`new | drip - email dont lose coverage | send day 12`**
- Subject: `Don't lose your home health coverage over a missed payment`
- Body:
```
Hi {{contact.first_name}},

Your {{contact.hhc__plan_name}} is still active, but the missed payment needs to be updated to
keep it that way. At {{contact.hhc__plan_premium}}/mo, it's a lot of protection to walk away from.

Reply SAVE or call me at {{contact.all_templates__agent_mobile_}} and I'll get the billing back on
track in a few minutes.

{{contact.all_templates__agent_full_name}}
{{contact.all_templates__agent_mobile_}}
```

**`new | code red - email about to cancel | send day 35`**
- Subject: `Action needed: your {{contact.hhc__carrier_name}} plan is about to cancel`
- Body:
```
Hi {{contact.first_name}},

Your {{contact.hhc__carrier_name}} home health policy is close to canceling. There is still time
to save it, but the window is closing.

Reply SAVE or call me at {{contact.all_templates__agent_mobile_}} today and I'll take care of
everything.

{{contact.all_templates__agent_full_name}}
{{contact.all_templates__agent_mobile_}}
```

**`new | code red - email final notice | send day 43`**
- Subject: `Final notice - save your home health plan`
- Body:
```
Hi {{contact.first_name}},

This is my final notice: your {{contact.hhc__carrier_name}} home health policy is about to cancel
for good. It's not too late yet.

Reply SAVE or call me right now at {{contact.all_templates__agent_mobile_}} and I'll stop the
cancellation.

{{contact.all_templates__agent_full_name}}
{{contact.all_templates__agent_mobile_}}
```

---

## 6. Compliance & guardrails

- TCPA quiet hours: 8a–9p client-local; queue outside-window sends.
- Single STOP honored book-wide → permanent outbound suppression, record still tracked.
- Every timed step re-checks guards at fire time (no blind sends).
- Global kill switch (WF0) halts all automated outbound instantly, resume-safe.
- External email: draft → human approval → send (Resend). No unsupervised sends.
- Read-only on production/commission data; flag & route to Max (data) / Zach (compliance).

---

## 7. Open decisions (before GHL build)

1. **Sender identity** — per-agent A2P numbers (agent-branded, best response rate) vs one campaign
   number with an agent sign-off to start.
2. **Save-gate toggle** — keep Pending manager-confirm ON (recommended) vs trust GHL Saved directly.
3. **Cadence tuning** — confirm exact send days per phase (current draft above is the starting set).
4. **45-day clock anchor** — starts on at_risk flip-true date vs carrier due/lapse date (peg the
   countdown to whatever the carrier enforces the save against).
