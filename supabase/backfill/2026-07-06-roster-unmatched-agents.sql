-- Backfill: create login-capable agents for "unmatched" roster entries
-- Context: agent-login (leaderboard-api) authenticates against the `agents`
-- table by name + writing number. Roster entries with match_status='unmatched'
-- and matched_agent_id IS NULL have no `agents` row, so those agents get
-- "Invalid credentials" and cannot log in or submit business.
-- Surfaced by WiseChoice (Wisechoice Senior Advisors Llc): 11 locked-out agents.
--
-- This script is idempotent and SAFE to re-run:
--   * only touches agency_rosters rows that are unmatched + unlinked
--   * skips any writing number that already resolves to an agent
--   * links the roster row back and flips it to 'confirmed'
--
-- REVIEW BEFORE RUNNING. Run against production only with sign-off (loop in Max).
-- Scope defaults to WiseChoice; change/remove the agency filter to widen.

BEGIN;

-- Tuneable scope. Set to NULL to backfill ALL agencies' unmatched entries.
-- Default: WiseChoice only.
WITH scope AS (
  SELECT '982f4e5d-cdff-4b25-bde2-e80c27c4274b'::uuid AS agency_id
),

-- Unmatched roster rows that still have no linked/derivable agent.
targets AS (
  SELECT r.id AS roster_id,
         r.agency_id,
         r.agent_first_name,
         r.agent_last_name,
         r.writing_number,
         upper(coalesce(r.carrier, 'UNL')) AS carrier,
         coalesce(r.npn, '') AS npn,
         ag.name AS agency_name
  FROM agency_rosters r
  JOIN agencies ag ON ag.id = r.agency_id
  LEFT JOIN scope s ON TRUE
  WHERE r.match_status = 'unmatched'
    AND r.matched_agent_id IS NULL
    AND (s.agency_id IS NULL OR r.agency_id = s.agency_id)
    -- guard: skip if an agent already exists for this writing number
    AND NOT EXISTS (
      SELECT 1 FROM agents a
      WHERE upper(a.unl_writing_number) = upper(r.writing_number)
         OR upper(a.gtl_writing_number) = upper(r.writing_number)
    )
),

-- Create the missing agent rows.
inserted AS (
  INSERT INTO agents (
    first_name, last_name, npn,
    unl_writing_number, gtl_writing_number,
    source, agency, agency_id, agency_locked, status
  )
  SELECT
    t.agent_first_name,
    t.agent_last_name,
    t.npn,
    CASE WHEN t.carrier = 'GTL' THEN NULL ELSE upper(t.writing_number) END,
    CASE WHEN t.carrier = 'GTL' THEN upper(t.writing_number) ELSE NULL END,
    'Roster',
    t.agency_name,
    t.agency_id,
    TRUE,
    'active'
  FROM targets t
  RETURNING id, unl_writing_number, gtl_writing_number, agency_id
)

-- Link the roster rows to their new agents and confirm them.
UPDATE agency_rosters r
SET match_status = 'confirmed',
    matched_agent_id = i.id,
    updated_at = now()
FROM inserted i
WHERE r.agency_id = i.agency_id
  AND r.match_status = 'unmatched'
  AND r.matched_agent_id IS NULL
  AND (
    upper(r.writing_number) = upper(i.unl_writing_number)
    OR upper(r.writing_number) = upper(i.gtl_writing_number)
  );

-- Verify before COMMIT: expect WiseChoice unmatched -> 0
-- SELECT match_status, count(*) FROM agency_rosters
--   WHERE agency_id = '982f4e5d-cdff-4b25-bde2-e80c27c4274b'
--   GROUP BY match_status;

COMMIT;
