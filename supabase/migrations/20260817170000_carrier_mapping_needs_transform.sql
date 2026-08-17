-- Add needs_transform flag and transform_note to carrier_column_mappings
-- Flags columns where the carrier's VALUES differ from UNL (e.g. "Active" vs "A",
-- numeric plan codes vs text codes). Column name mapping alone isn't enough for these.

ALTER TABLE carrier_column_mappings
  ADD COLUMN IF NOT EXISTS needs_transform boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS transform_note text DEFAULT '';
