-- Carrier Column Mappings
-- Per-carrier mapping of carrier-native column names → UNL standard column names.
-- Non-UNL carriers (AHL, GTL, Heartland, Manhattan, etc.) have different column
-- names in their source files. This table defines how each carrier's columns map
-- to UNL's canonical column names, which then flow through the existing
-- column_mappings → TARGET_FIELDS → human-readable labels pipeline.
--
-- Flow: Carrier source column → UNL column name → human-readable label → views

CREATE TABLE IF NOT EXISTS carrier_column_mappings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier         text NOT NULL,                          -- 'AHL', 'GTL', 'Heartland', 'Manhattan', etc.
  carrier_column  text NOT NULL,                          -- column name as it appears in the carrier's source data
  unl_column      text NOT NULL,                          -- equivalent UNL column name (the standard)
  description     text DEFAULT '',                        -- optional notes about this mapping
  is_active       boolean NOT NULL DEFAULT true,          -- soft-delete / disable without removing
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(carrier, carrier_column)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ccm_carrier ON carrier_column_mappings(carrier);
CREATE INDEX IF NOT EXISTS idx_ccm_carrier_active ON carrier_column_mappings(carrier, is_active);

-- RLS
ALTER TABLE carrier_column_mappings ENABLE ROW LEVEL SECURITY;

-- Service role (edge functions) gets full access
CREATE POLICY "service_role_all_ccm" ON carrier_column_mappings
  FOR ALL USING (auth.role() = 'service_role');

-- Anon/authenticated can read (for the admin UI)
CREATE POLICY "anon_read_ccm" ON carrier_column_mappings
  FOR SELECT USING (true);

-- Updated_at trigger (reuse existing function if available, create if not)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'update_carrier_column_mapping_timestamp'
  ) THEN
    CREATE FUNCTION update_carrier_column_mapping_timestamp()
    RETURNS TRIGGER AS $fn$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;
  END IF;
END $$;

CREATE TRIGGER trg_ccm_updated_at
  BEFORE UPDATE ON carrier_column_mappings
  FOR EACH ROW EXECUTE FUNCTION update_carrier_column_mapping_timestamp();
