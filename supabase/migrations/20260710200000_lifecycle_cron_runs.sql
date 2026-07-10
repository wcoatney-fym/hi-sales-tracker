-- lifecycle_cron_runs: written on every invocation of lifecycle-direct,
-- scheduled or manual. Provides direct cron_auth evidence without relying
-- on pg_net response bodies (which are not retained) or function log APIs.
-- Also serves as a dead-man's switch: an alert fires if no scheduled row
-- lands for >30 minutes.

CREATE TABLE IF NOT EXISTS public.lifecycle_cron_runs (
  id          bigserial PRIMARY KEY,
  ticked_at   timestamptz NOT NULL DEFAULT now(),
  cron_auth   boolean     NOT NULL,   -- true = came from pg_cron with valid X-Cron-Key
  dry         boolean     NOT NULL,   -- true = LIFECYCLE_DRY_RUN was on
  fired       integer     NOT NULL DEFAULT 0,
  skipped     integer     NOT NULL DEFAULT 0,
  deploy_sha  text        NOT NULL DEFAULT 'unknown'
);

-- Keep 90 days of history, auto-purge older rows daily
SELECT cron.schedule(
  'purge-lifecycle-cron-runs',
  '30 4 * * *',
  $$ DELETE FROM public.lifecycle_cron_runs WHERE ticked_at < now() - interval '90 days' $$
);

-- RLS: service role writes, anon can read (for dashboard queries)
ALTER TABLE public.lifecycle_cron_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access" ON public.lifecycle_cron_runs
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "anon read" ON public.lifecycle_cron_runs
  FOR SELECT USING (true);
