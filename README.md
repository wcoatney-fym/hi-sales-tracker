# HI Sales Tracker

An internal sales operations platform for managing health insurance agent production, policy tracking, leaderboards, and agency oversight. Built for FYM and its downline agencies to centralize data from multiple carriers and provide real-time visibility into agent performance.

## Features

- **Admin Dashboard** -- KPIs, Monte Carlo forecasting, sales charts, agency breakdowns, and agent leaderboards with date-range filtering
- **Data Source Integration** -- Import policy data via CSV upload or direct SQL connection to external databases, with saved column mappings and automated agent/policy sync
- **Agent Portal** -- Individual agent login with personal production stats, book of business, goal tracking, and achievement badges
- **Leaderboard** -- Gamified ranking system with challenges, incentives, trophies, and agency goal trackers
- **At-Risk Policy Management** -- Identify policies at risk of lapse with aging reports and activity logging
- **Agency Roster System** -- Manage agent-to-agency assignments with roster uploads and credential management
- **Intake Form** -- Public-facing form for agents to submit new policy applications
- **Duplicate Detection** -- Automated flagging of duplicate submissions with supersede logic when carrier data arrives
- **Upload History & Audit** -- Full audit trail of data imports with revert capability

## Tech Stack

- **Frontend** -- React 18, TypeScript, Vite, Tailwind CSS, Recharts
- **Backend** -- Supabase (PostgreSQL, Edge Functions, Row Level Security)
- **Routing** -- React Router v7
- **Icons** -- Lucide React
- **Edge Functions** -- Deno runtime (admin-api, leaderboard-api, agent-webhook, poll-data-sources, public-api)

## Local Setup

### Prerequisites

- Node.js 18+
- npm

### Installation

```bash
npm install
```

### Environment Variables

Create a `.env` file in the project root with:

```
VITE_SUPABASE_URL=<your-supabase-project-url>
VITE_SUPABASE_ANON_KEY=<your-supabase-anon-key>
```

### Development

```bash
npm run dev
```

The app runs at `http://localhost:5173`.

### Build

```bash
npm run build
```

### Type Checking

```bash
npm run typecheck
```
