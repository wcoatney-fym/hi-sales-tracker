-- Add held column to lifecycle_cron_runs
-- Tracks how many trigger rows were held at the NPN gate per run.
ALTER TABLE public.lifecycle_cron_runs ADD COLUMN IF NOT EXISTS held INTEGER NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.lifecycle_cron_runs.held IS 'Rows written to npn_holds (NPN missing) on this cron run.';
