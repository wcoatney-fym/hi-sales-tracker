-- Consume the UNL "Contract Reason" descriptor (already present in the mapped
-- source data, 41/41 columns) into the policy table. Drives the terminated
-- outreach split (PR #29 gap) and the `terminated` Zap payload's reason field.
-- Additive + nullable; the daily full-state UNL refresh backfills every row on
-- the next import — no manual backfill needed.

alter table public.form_submissions
  add column if not exists contract_reason text;

comment on column public.form_submissions.contract_reason is
  'UNL-reported contract/lifecycle reason (e.g. Submitted, Lapsed) from mapped source column "Contract Reason". Populated by sql-import-cron; NULL if the source row has no reason.';
