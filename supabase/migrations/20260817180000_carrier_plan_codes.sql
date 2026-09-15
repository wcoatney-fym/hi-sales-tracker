-- Carrier Plan Code lookup table
-- Maps carrier-specific plan codes to product types (HIP, HHC, Cancer, Life, DV)
-- so derivePlanType can classify non-UNL plan codes that don't match UNL's regex patterns.
--
-- AHL uses numeric 4-digit codes (8501-8896) — all HIP.
-- GTL uses alpha codes (MAP20, GNHHC, etc.) — mixed product types.
-- UNL uses text codes (UTHHC, UHIP2, etc.) — handled by existing regex in derivePlanType.

CREATE TABLE IF NOT EXISTS carrier_plan_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier         text NOT NULL,
  plan_code       text NOT NULL,
  plan_abbrev     text DEFAULT '',
  plan_description text DEFAULT '',
  plan_type       text NOT NULL DEFAULT 'HIP',   -- HIP, HHC, Cancer, Life, DV, Unknown
  record_type     text DEFAULT 'P',               -- P = base plan, R = rider
  contract_type   int DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(carrier, plan_code)
);

CREATE INDEX IF NOT EXISTS idx_cpc_carrier ON carrier_plan_codes(carrier);
CREATE INDEX IF NOT EXISTS idx_cpc_carrier_code ON carrier_plan_codes(carrier, plan_code);

ALTER TABLE carrier_plan_codes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'carrier_plan_codes' AND policyname = 'service_role_all_cpc') THEN
    CREATE POLICY service_role_all_cpc ON carrier_plan_codes FOR ALL USING (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'carrier_plan_codes' AND policyname = 'anon_read_cpc') THEN
    CREATE POLICY anon_read_cpc ON carrier_plan_codes FOR SELECT USING (true);
  END IF;
END $$;
