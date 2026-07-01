-- Track agency-admin portal usage: when each credential last logged in and
-- how many times total. Additive + nullable — no backfill, no data rewrite.
-- Existing rows read last_login_at = NULL ("Never") until their next login.

alter table public.admin_credentials
  add column if not exists last_login_at timestamptz,
  add column if not exists login_count integer not null default 0;

comment on column public.admin_credentials.last_login_at is
  'Timestamp of the most recent successful portal login for this credential. NULL = never logged in.';
comment on column public.admin_credentials.login_count is
  'Cumulative count of successful portal logins for this credential.';
