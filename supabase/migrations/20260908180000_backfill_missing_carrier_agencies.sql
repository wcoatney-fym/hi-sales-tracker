/*
  Backfill 4 agencies with production that were missing from the tracker.

  Root cause: the agencies table was seeded exclusively from UNL downline data.
  Three GTL-only agencies and one small UNL agency were never added.

  This migration adds them with their carrier writing numbers so the Agency
  Access settings page and dashboard filters work immediately.

  Part of: feature/multi-carrier-agency-sync (Will, 2026-09-08)
*/

-- 1. Insert missing agencies
INSERT INTO agencies (name, slug) VALUES
  ('Americas Trusted Benefits LLC', 'americas-trusted-benefits'),
  ('The Presidents Club', 'the-presidents-club'),
  ('Vantage Point Insurance Group', 'vantage-point-insurance-group'),
  ('DJK Insurance', 'djk-insurance')
ON CONFLICT (slug) DO NOTHING;

-- 2. Seed writing numbers (GTL codes for the first three, UNL for DJK)
INSERT INTO agency_writing_numbers (agency_id, writing_number)
SELECT a.id, v.wn
FROM (VALUES
  ('americas-trusted-benefits',     '01A9RK00'),
  ('the-presidents-club',           '01ABEE00'),
  ('vantage-point-insurance-group', '01AC2B00'),
  ('djk-insurance',                 '202NRY00')
) AS v(slug, wn)
JOIN agencies a ON a.slug = v.slug
ON CONFLICT (agency_id) DO UPDATE SET writing_number = EXCLUDED.writing_number;
