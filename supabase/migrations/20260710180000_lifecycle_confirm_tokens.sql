-- Single-use confirmation tokens for lifecycle-direct live fires.
-- A live single-policy fire first returns a token; the caller must
-- re-invoke with ?confirm=<token> within 5 minutes to actually fire.
-- This prevents accidental invocations and enforces the one-greenlight-per-fire rule.

CREATE TABLE IF NOT EXISTS public.lifecycle_confirm_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token        text NOT NULL UNIQUE,
  policy_number text NOT NULL,
  expires_at   timestamptz NOT NULL,
  used         boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Index for fast token lookup
CREATE INDEX IF NOT EXISTS lifecycle_confirm_tokens_token_idx
  ON public.lifecycle_confirm_tokens (token)
  WHERE used = false;

-- Auto-purge expired tokens daily (pg_cron)
SELECT cron.schedule(
  'purge-lifecycle-confirm-tokens',
  '0 4 * * *',
  $$ DELETE FROM public.lifecycle_confirm_tokens WHERE expires_at < now() - interval '1 hour' $$
);

-- RLS: service role only (edge function uses service key)
ALTER TABLE public.lifecycle_confirm_tokens ENABLE ROW LEVEL SECURITY;
