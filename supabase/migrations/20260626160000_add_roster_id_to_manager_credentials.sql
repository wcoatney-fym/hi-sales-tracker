/*
  # Link manager credentials to the roster entry

  The roster Shield toggle can flag a manager on an *unmatched* roster entry
  (no linked agent). Keying the bridge off agent_id alone missed those. Add a
  roster_id reference so promoting any roster entry (matched or not) mints/links
  exactly one manager login, idempotently.

  - `roster_id` nullable FK to agency_rosters
  - unique where not null (one credential per roster entry)
*/

ALTER TABLE agency_manager_credentials
  ADD COLUMN IF NOT EXISTS roster_id uuid REFERENCES agency_rosters(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_agency_mgr_creds_roster
  ON agency_manager_credentials(roster_id)
  WHERE roster_id IS NOT NULL;
