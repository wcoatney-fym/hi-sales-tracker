-- Remove duplicate staged rows (same upload + same _dlt_id), keeping the first copy.
-- These were created by the unordered OFFSET fetch re-reading rows.
DELETE FROM source_records a
USING source_records b
WHERE a.source_upload_id = b.source_upload_id
  AND a.raw_data->>'_dlt_id' IS NOT NULL
  AND a.raw_data->>'_dlt_id' = b.raw_data->>'_dlt_id'
  AND a.id > b.id;

-- Stored generated column so the dedup key is indexable and usable as an
-- ON CONFLICT target by PostgREST upserts.
ALTER TABLE source_records
  ADD COLUMN IF NOT EXISTS dlt_id text GENERATED ALWAYS AS (raw_data->>'_dlt_id') STORED;

-- Hard idempotency guard: one staged row per (upload, _dlt_id). NULL dlt_id rows
-- (CSV uploads) are unaffected because NULLs are distinct.
CREATE UNIQUE INDEX IF NOT EXISTS source_records_upload_dlt_uniq
  ON source_records (source_upload_id, dlt_id);

-- upload_history_log writes in the edge functions pass a details payload, but the
-- column never existed, so every log insert silently failed. Add it.
ALTER TABLE upload_history_log ADD COLUMN IF NOT EXISTS details jsonb;
