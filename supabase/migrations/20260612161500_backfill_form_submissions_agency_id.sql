-- The sync never populated agency_id, so the agency-scoped leaderboard
-- (which filters on it) saw none of the imported book.
UPDATE form_submissions fs
SET agency_id = a.id
FROM agencies a
WHERE fs.agency = a.name
  AND fs.agency_id IS NULL;
