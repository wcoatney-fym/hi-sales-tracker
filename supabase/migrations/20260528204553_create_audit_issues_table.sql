/*
  # Create audit_issues table

  1. New Tables
    - `audit_issues`
      - `id` (uuid, primary key)
      - `issue_type` (text) - e.g., 'duplicate_agent', 'missing_writing_number'
      - `severity` (text) - 'warning' or 'error'
      - `title` (text) - short human-readable summary
      - `description` (text) - detailed explanation
      - `entity_ids` (jsonb) - array of affected record IDs
      - `metadata` (jsonb) - additional structured data about the issue
      - `status` (text) - 'open', 'resolved', 'dismissed'
      - `resolved_at` (timestamptz)
      - `resolved_by` (text)
      - `created_at` (timestamptz)
  2. Security
    - Enable RLS on `audit_issues` table
    - Add policy for service role access only (admin-api uses service role)
*/

CREATE TABLE IF NOT EXISTS audit_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_type text NOT NULL DEFAULT '',
  severity text NOT NULL DEFAULT 'warning',
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  entity_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open',
  resolved_at timestamptz,
  resolved_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE audit_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to audit_issues"
  ON audit_issues
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
