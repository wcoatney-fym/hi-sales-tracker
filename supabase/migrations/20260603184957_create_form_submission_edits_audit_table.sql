/*
  # Create form_submission_edits audit table

  This migration creates an audit log table that records every per-row edit made
  to the form_submissions table from the admin Intake Submissions panel. Each
  edit captures which fields changed, the previous and new values, the admin
  email that performed the change, and a timestamp. This protects against silent
  data corruption now that admins can edit individual rows and columns.

  1. New Tables
    - `form_submission_edits`
      - `id` (uuid, primary key)
      - `submission_id` (uuid, references form_submissions, on delete cascade)
      - `edited_by_email` (text, the admin email from the active admin session)
      - `edited_at` (timestamptz, default now())
      - `changed_fields` (jsonb, shape: { field_name: { old, new } })

  2. Indexes
    - Index on submission_id for quick history lookup per submission
    - Index on edited_at desc for recent-first audit browsing

  3. Security
    - Enable RLS on `form_submission_edits`
    - No policies are added: only the service role (used by the admin-api edge
      function) can read or write this table. This is intentional: end users
      and authenticated clients should never see or modify the audit trail.
*/

CREATE TABLE IF NOT EXISTS form_submission_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  edited_by_email text NOT NULL DEFAULT '',
  edited_at timestamptz NOT NULL DEFAULT now(),
  changed_fields jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE form_submission_edits ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_form_submission_edits_submission_id
  ON form_submission_edits (submission_id);

CREATE INDEX IF NOT EXISTS idx_form_submission_edits_edited_at_desc
  ON form_submission_edits (edited_at DESC);
