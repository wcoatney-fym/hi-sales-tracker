/*
  # Add Book of Business (BoB) upload tracking

  1. New Tables
    - `bob_uploads`
      - `id` (uuid, primary key) - Unique upload identifier
      - `carrier` (text) - Insurance carrier, constrained to 'UNL' or 'GTL'
      - `filename` (text) - Original uploaded CSV filename
      - `record_count` (integer) - Number of records imported
      - `uploaded_by` (text) - Email of the admin who uploaded
      - `created_at` (timestamptz) - When the upload occurred

    - `bob_records`
      - `id` (uuid, primary key) - Unique record identifier
      - `bob_upload_id` (uuid, FK) - Reference to the parent upload
      - `carrier` (text) - Insurance carrier
      - `policy_number` (text) - Policy number
      - `agent_name` (text) - Agent name
      - `agent_number` (text) - Agent number/ID
      - `client_name` (text) - Client/insured name
      - `plan_name` (text) - Plan or product name
      - `premium` (numeric) - Premium amount
      - `effective_date` (text) - Policy effective date
      - `status` (text) - Policy status
      - `raw_data` (jsonb) - Full original CSV row for reference
      - `created_at` (timestamptz) - When the record was created

  2. Security
    - RLS enabled on both tables with no public access policies
    - All access through Edge Functions using service role key

  3. Indexes
    - Index on bob_uploads for carrier + created_at ordering
    - Index on bob_records for bob_upload_id lookups
    - Index on bob_records for carrier lookups
*/

CREATE TABLE IF NOT EXISTS bob_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier text NOT NULL CHECK (carrier IN ('UNL', 'GTL')),
  filename text NOT NULL DEFAULT '',
  record_count integer NOT NULL DEFAULT 0,
  uploaded_by text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE bob_uploads ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_bob_uploads_carrier_created
  ON bob_uploads (carrier, created_at DESC);

CREATE TABLE IF NOT EXISTS bob_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bob_upload_id uuid NOT NULL REFERENCES bob_uploads(id) ON DELETE CASCADE,
  carrier text NOT NULL CHECK (carrier IN ('UNL', 'GTL')),
  policy_number text NOT NULL DEFAULT '',
  agent_name text NOT NULL DEFAULT '',
  agent_number text NOT NULL DEFAULT '',
  client_name text NOT NULL DEFAULT '',
  plan_name text NOT NULL DEFAULT '',
  premium numeric NOT NULL DEFAULT 0,
  effective_date text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT '',
  raw_data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE bob_records ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_bob_records_upload_id
  ON bob_records (bob_upload_id);

CREATE INDEX IF NOT EXISTS idx_bob_records_carrier
  ON bob_records (carrier);
