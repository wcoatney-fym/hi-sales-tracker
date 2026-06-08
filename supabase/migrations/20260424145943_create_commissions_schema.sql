/*
  # Create commissions schema

  1. New Tables
    - `commission_schedules`
      - `id` (uuid, primary key)
      - `carrier` (text, NOT NULL) - 'UNL' or 'GTL'
      - `product_type` (text, NOT NULL, default 'HI') - 'HI' or 'HHC'
      - `level` (text, NOT NULL) - e.g. 'writing_agent', 'override', 'agency'
      - `label` (text, NOT NULL) - display name for this commission tier
      - `rate_percent` (numeric, NOT NULL, default 0) - commission rate as percentage
      - `advance_months` (integer, NOT NULL, default 0) - number of months advanced
      - `effective_from` (date, NOT NULL, default CURRENT_DATE) - when this schedule takes effect
      - `effective_to` (date, nullable) - when this schedule expires
      - `is_active` (boolean, NOT NULL, default true)
      - `created_at` (timestamptz, default now())
      - `updated_at` (timestamptz, default now())

    - `commission_entries`
      - `id` (uuid, primary key)
      - `form_submission_id` (uuid, NOT NULL, FK -> form_submissions.id)
      - `commission_schedule_id` (uuid, nullable, FK -> commission_schedules.id)
      - `agent_first_name` (text, NOT NULL)
      - `agent_last_name` (text, NOT NULL)
      - `agent_number` (text, NOT NULL)
      - `carrier` (text, NOT NULL)
      - `product_type` (text, NOT NULL, default 'HI')
      - `monthly_premium` (numeric, NOT NULL, default 0)
      - `annual_premium` (numeric, NOT NULL, default 0)
      - `commission_rate` (numeric, NOT NULL, default 0) - snapshot of rate at time of calc
      - `commission_amount` (numeric, NOT NULL, default 0) - computed commission
      - `advance_amount` (numeric, NOT NULL, default 0) - advanced commission if applicable
      - `level` (text, NOT NULL, default 'writing_agent')
      - `status` (text, NOT NULL, default 'pending') - pending, paid, clawed_back, on_hold
      - `period_start` (date, NOT NULL) - commission period start
      - `period_end` (date, NOT NULL) - commission period end
      - `paid_date` (date, nullable)
      - `notes` (text, NOT NULL, default '')
      - `created_at` (timestamptz, default now())
      - `updated_at` (timestamptz, default now())

  2. Security
    - Enable RLS on both tables
    - Service-role only access (admin API uses service role key)

  3. Indexes
    - commission_schedules: carrier + product_type + is_active
    - commission_entries: agent_number, carrier, status, period_start, form_submission_id
*/

-- Commission Schedules
CREATE TABLE IF NOT EXISTS commission_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier text NOT NULL CHECK (carrier IN ('UNL', 'GTL')),
  product_type text NOT NULL DEFAULT 'HI' CHECK (product_type IN ('HI', 'HHC')),
  level text NOT NULL DEFAULT 'writing_agent',
  label text NOT NULL DEFAULT '',
  rate_percent numeric NOT NULL DEFAULT 0,
  advance_months integer NOT NULL DEFAULT 0,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE commission_schedules ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_commission_schedules_lookup
  ON commission_schedules (carrier, product_type, is_active);

-- Commission Entries
CREATE TABLE IF NOT EXISTS commission_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_submission_id uuid NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  commission_schedule_id uuid REFERENCES commission_schedules(id) ON DELETE SET NULL,
  agent_first_name text NOT NULL,
  agent_last_name text NOT NULL,
  agent_number text NOT NULL,
  carrier text NOT NULL,
  product_type text NOT NULL DEFAULT 'HI',
  monthly_premium numeric NOT NULL DEFAULT 0,
  annual_premium numeric NOT NULL DEFAULT 0,
  commission_rate numeric NOT NULL DEFAULT 0,
  commission_amount numeric NOT NULL DEFAULT 0,
  advance_amount numeric NOT NULL DEFAULT 0,
  level text NOT NULL DEFAULT 'writing_agent',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'clawed_back', 'on_hold')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  paid_date date,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE commission_entries ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_commission_entries_agent ON commission_entries (agent_number);
CREATE INDEX IF NOT EXISTS idx_commission_entries_carrier ON commission_entries (carrier);
CREATE INDEX IF NOT EXISTS idx_commission_entries_status ON commission_entries (status);
CREATE INDEX IF NOT EXISTS idx_commission_entries_period ON commission_entries (period_start);
CREATE INDEX IF NOT EXISTS idx_commission_entries_submission ON commission_entries (form_submission_id);
