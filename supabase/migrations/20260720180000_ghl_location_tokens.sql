-- ghl_location_tokens
-- Stores OAuth access + refresh tokens for each GHL sub-account that installs the FYM Marketplace app.
-- One row per location_id. Upserted on each install/re-auth.

create table if not exists public.ghl_location_tokens (
  location_id       text        primary key,
  company_id        text,
  access_token      text        not null,
  refresh_token     text        not null,
  scope             text,
  user_id           text,
  expires_at        timestamptz not null,
  installed_at      timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- RLS: service role only — tokens are sensitive
alter table public.ghl_location_tokens enable row level security;

-- No public access
create policy "No public access" on public.ghl_location_tokens
  for all using (false);

-- Index for company-level lookups (bulk ops across all locations in an agency)
create index if not exists idx_ghl_location_tokens_company_id
  on public.ghl_location_tokens (company_id);

comment on table public.ghl_location_tokens is
  'OAuth tokens for GHL sub-accounts that have installed the FYM Marketplace Private App. Access via service role only.';
