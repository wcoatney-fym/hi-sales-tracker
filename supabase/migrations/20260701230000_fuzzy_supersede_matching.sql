/*
  # Fuzzy intake<->data-source matching for supersede logic

  Problem: flag_superseded_by_data_source() matched Intake Form rows to the
  Data Source (UNL / Max's DB, the source of truth) on an EXACT key:
  agent_number + lower(first) + lower(last) + zip. Agent-typed intake names
  drift from the official record, so real matches leaked through and got
  double-counted (e.g. WiseChoice: "Jo Ann Luyhue" vs DS "Joann Layhue",
  "Barbara Stockwell" vs "Barbara Tockwell", trailing-space "Deborah
  Middleton ", middle-initial "Diane M Coughlin").

  Best-practice approach used here (record linkage):
    1. BLOCK on strong, stable anchors to keep false-merges near zero:
         - agent_number exact
         - zip5 exact
         - policy_effective_date within +/-14 days (null dates pass)
    2. NORMALIZE names inside the block: trim, lowercase, strip punctuation,
       drop single-letter middle-initial tokens, collapse whitespace.
    3. FUZZY score the name with pg_trgm similarity + levenshtein, corroborated
       by plan_premium proximity. High-confidence -> auto-supersede.
       Borderline -> queued in fuzzy_supersede_review for a human, never
       silently merged.

  Data Source stays the source of truth: only the Intake/BoB side is ever
  superseded. Never deletes or edits a Data Source row.
*/

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

-- Name normalizer: lowercase, strip non-letters/spaces, drop lone middle
-- initials, collapse + trim whitespace.
CREATE OR REPLACE FUNCTION norm_name(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT btrim(regexp_replace(
           regexp_replace(
             regexp_replace(lower(coalesce(p, '')), '[^a-z ]', '', 'g'),
             '\y[a-z]\y', ' ', 'g'          -- drop single-letter tokens (middle initials)
           ),
           '\s+', ' ', 'g'                   -- collapse whitespace
         ));
$$;

-- Human review queue for borderline fuzzy matches (medium confidence).
CREATE TABLE IF NOT EXISTS fuzzy_supersede_review (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id uuid NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  data_source_id uuid NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  name_score numeric NOT NULL,
  premium_delta_pct numeric,
  eff_date_gap_days integer,
  status text NOT NULL DEFAULT 'pending',   -- pending | confirmed | rejected
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text,
  UNIQUE (intake_id, data_source_id)
);
ALTER TABLE fuzzy_supersede_review ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION flag_superseded_by_data_source(p_source_upload_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  superseded_count integer := 0;
BEGIN
  -- Candidate intake<->data-source pairs sharing the anchor block.
  -- Anchor on app_submit_date (when the agent entered / the app was taken):
  -- it is closest to how the record lands in the Data Source and is far more
  -- stable than policy_effective_date, which drifts as the carrier sets it.
  WITH ds AS (
    SELECT id, agent_number, left(zip, 5) AS zip5, app_submit_date AS eff,
           plan_premium AS prem, norm_name(client_first_name) AS fn,
           norm_name(client_last_name) AS ln
    FROM form_submissions
    WHERE source = 'Data Source'
      AND status NOT IN ('duplicate', 'superseded')
      AND (p_source_upload_id IS NULL OR source_upload_id = p_source_upload_id)
  ),
  intake AS (
    SELECT id, agent_number, left(zip, 5) AS zip5, app_submit_date AS eff,
           plan_premium AS prem, norm_name(client_first_name) AS fn,
           norm_name(client_last_name) AS ln
    FROM form_submissions
    WHERE source IN ('Intake Form', 'Book of Business')
      AND status NOT IN ('duplicate', 'superseded')
  ),
  pairs AS (
    SELECT
      i.id AS intake_id,
      d.id AS ds_id,
      -- name score: blend last+first trigram similarity, gate on last name
      (0.6 * similarity(i.ln, d.ln) + 0.4 * similarity(i.fn, d.fn)) AS name_score,
      similarity(i.ln, d.ln) AS ln_sim,
      similarity(i.fn, d.fn) AS fn_sim,
      levenshtein(i.ln, d.ln) AS ln_lev,
      CASE WHEN i.prem IS NULL OR d.prem IS NULL OR d.prem = 0 THEN NULL
           ELSE abs(i.prem - d.prem) / d.prem END AS prem_delta,
      CASE WHEN i.eff IS NULL OR d.eff IS NULL THEN NULL
           ELSE abs(i.eff - d.eff) END AS eff_gap,
      row_number() OVER (
        PARTITION BY i.id
        ORDER BY (0.6 * similarity(i.ln, d.ln) + 0.4 * similarity(i.fn, d.fn)) DESC
      ) AS rn
    FROM intake i
    JOIN ds d
      ON d.agent_number = i.agent_number
     AND d.zip5 = i.zip5
     -- submit dates line up closely between intake and Data Source; a 14d
     -- block absorbs entry lag while the tier logic keeps auto-merges tight.
     AND (i.eff IS NULL OR d.eff IS NULL OR abs(i.eff - d.eff) <= 14)
  ),
  best AS (
    SELECT * FROM pairs WHERE rn = 1
  ),
  classified AS (
    SELECT *,
      -- a materially different premium (>10%) may be a genuine second policy,
      -- not a duplicate -> never auto-supersede, route to human review.
      (prem_delta IS NOT NULL AND prem_delta > 0.10) AS prem_conflict,
      CASE
        WHEN (prem_delta IS NOT NULL AND prem_delta > 0.10)
             AND name_score >= 0.45 THEN 'review'
        -- high confidence: strong name, OR fuzzy name corroborated by premium
        WHEN name_score >= 0.72 THEN 'auto'
        WHEN ln_lev <= 2 AND (prem_delta IS NOT NULL AND prem_delta <= 0.02)
             AND (fn_sim >= 0.3 OR left(fn,1) = left(ln,1)) THEN 'auto'
        WHEN ln_sim >= 0.45 AND fn_sim >= 0.3 THEN 'review'
        ELSE 'skip'
      END AS tier
    FROM best
  ),
  do_supersede AS (
    UPDATE form_submissions fs
    SET status = 'superseded', duplicate_flag = true
    FROM classified c
    WHERE fs.id = c.intake_id AND c.tier = 'auto'
    RETURNING fs.id
  ),
  queue AS (
    INSERT INTO fuzzy_supersede_review
      (intake_id, data_source_id, name_score, premium_delta_pct, eff_date_gap_days)
    SELECT intake_id, ds_id, round(name_score, 3),
           round(prem_delta * 100, 2), eff_gap
    FROM classified WHERE tier = 'review'
    ON CONFLICT (intake_id, data_source_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO superseded_count FROM do_supersede;

  RETURN superseded_count;
END;
$$;

-- Anon (publishable key) read access for the review queue, consistent with the
-- other quality tables.
DROP POLICY IF EXISTS anon_read_fuzzy_review ON fuzzy_supersede_review;
CREATE POLICY anon_read_fuzzy_review ON fuzzy_supersede_review
  FOR SELECT TO anon USING (true);
