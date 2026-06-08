/*
  # Form Submission Edits Audit Log

  1. New Tables
    - `form_submission_edits`
      - `id` (uuid, primary key) - Unique audit record identifier
      - `submission_id` (uuid) - The form_submissions row that was edited
      - `edited_by` (text) - Identifier of the admin who performed the edit (email or 'system')
      - `edited_at` (timestamptz) - Timestamp of the edit
      - `changes` (jsonb) - Object with field-level old/new values: { field_name: { old, new } }

  2. Security
    - RLS enabled
    - No public policies; only the service role (used by edge functions) can read/write
    - This matches the existing pattern for form_submissions and other admin-only tables

  3. Indexes
    - Index on `submission_id` for fast per-submission history lookup
    - Index on `edited_at DESC` for recent-edit queries
*/

CREATE TABLE IF NOT EXISTS form_submission_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL,
  edited_by text NOT NULL DEFAULT 'admin',
  edited_at timestamptz NOT NULL DEFAULT now(),
  changes jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE form_submission_edits ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_form_submission_edits_submission
  ON form_submission_edits (submission_id);

CREATE INDEX IF NOT EXISTS idx_form_submission_edits_edited_at
  ON form_submission_edits (edited_at DESC);
