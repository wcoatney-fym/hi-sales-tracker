-- Carrier Agency & Agent Mappings
-- Maps agencies and agents across carriers (AHL, GTL, Manhattan, Heartland)
-- to canonical Portal agency identities. Eliminates per-carrier if/else in code.

-- ---------------------------------------------------------------------------
-- carrier_agency_mappings — one row per carrier-agency pair
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS carrier_agency_mappings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier       text NOT NULL,                          -- 'UNL', 'AHL', 'GTL', 'Manhattan', 'Heartland'
  carrier_agency_name   text NOT NULL,                  -- name as it appears in carrier data (e.g. "GUARDIAN BENEFITS INC")
  carrier_agency_code   text,                           -- carrier-specific agency code (AHL ga_number, GTL ga, etc.)
  portal_agency_id      uuid REFERENCES hierarchy_agencies(id) ON DELETE SET NULL,  -- matched Portal agency
  portal_agency_name    text,                           -- denormalized for display
  unl_writing_number    text,                           -- UNL WN from the matched portal agency (bridge to hierarchy)
  match_method          text NOT NULL DEFAULT 'manual', -- 'exact', 'normalized', 'fuzzy', 'manual'
  match_confidence      numeric(4,2),                   -- 0.00-1.00 confidence score
  is_confirmed          boolean NOT NULL DEFAULT false,  -- locked after human review
  confirmed_by          text,                           -- who confirmed
  confirmed_at          timestamptz,
  policy_count          integer DEFAULT 0,              -- cached count from carrier data
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE(carrier, carrier_agency_code),
  UNIQUE(carrier, carrier_agency_name)
);

-- Index for fast lookups by carrier
CREATE INDEX IF NOT EXISTS idx_cam_carrier ON carrier_agency_mappings(carrier);
CREATE INDEX IF NOT EXISTS idx_cam_portal_agency ON carrier_agency_mappings(portal_agency_id);

-- ---------------------------------------------------------------------------
-- carrier_agent_mappings — one row per carrier-agent pair
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS carrier_agent_mappings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier       text NOT NULL,                          -- 'UNL', 'AHL', 'GTL', 'Manhattan', 'Heartland'
  carrier_agent_name    text NOT NULL,                  -- agent name as it appears in carrier data
  carrier_agent_code    text,                           -- carrier-specific agent code/writing number
  carrier_agency_mapping_id uuid REFERENCES carrier_agency_mappings(id) ON DELETE CASCADE,  -- which agency this agent belongs to
  -- Cross-carrier identity (optional — links same agent across carriers)
  canonical_agent_name  text,                           -- normalized name for cross-carrier matching
  tracker_agent_id      uuid REFERENCES agents(id) ON DELETE SET NULL,  -- link to tracker agents table
  match_method          text NOT NULL DEFAULT 'manual', -- 'exact', 'normalized', 'fuzzy', 'manual'
  match_confidence      numeric(4,2),
  is_confirmed          boolean NOT NULL DEFAULT false,
  confirmed_by          text,
  confirmed_at          timestamptz,
  policy_count          integer DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE(carrier, carrier_agent_code)
);

CREATE INDEX IF NOT EXISTS idx_cagm_carrier ON carrier_agent_mappings(carrier);
CREATE INDEX IF NOT EXISTS idx_cagm_agency ON carrier_agent_mappings(carrier_agency_mapping_id);
CREATE INDEX IF NOT EXISTS idx_cagm_tracker_agent ON carrier_agent_mappings(tracker_agent_id);

-- ---------------------------------------------------------------------------
-- RLS — admin-only access
-- ---------------------------------------------------------------------------
ALTER TABLE carrier_agency_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE carrier_agent_mappings ENABLE ROW LEVEL SECURITY;

-- Service role (edge functions) gets full access
CREATE POLICY "service_role_all_cam" ON carrier_agency_mappings
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all_cagm" ON carrier_agent_mappings
  FOR ALL USING (auth.role() = 'service_role');

-- Anon/authenticated can read (for the admin UI)
CREATE POLICY "anon_read_cam" ON carrier_agency_mappings
  FOR SELECT USING (true);

CREATE POLICY "anon_read_cagm" ON carrier_agent_mappings
  FOR SELECT USING (true);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_carrier_mapping_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cam_updated_at
  BEFORE UPDATE ON carrier_agency_mappings
  FOR EACH ROW EXECUTE FUNCTION update_carrier_mapping_timestamp();

CREATE TRIGGER trg_cagm_updated_at
  BEFORE UPDATE ON carrier_agent_mappings
  FOR EACH ROW EXECUTE FUNCTION update_carrier_mapping_timestamp();
