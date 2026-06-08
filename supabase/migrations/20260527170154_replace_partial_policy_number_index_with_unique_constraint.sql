/*
  # Replace partial unique index on policy_number with a proper UNIQUE constraint

  1. Changes
    - Drop the existing partial unique index `idx_form_submissions_policy_number_unique`
      (which used `WHERE policy_number IS NOT NULL`)
    - Add a real UNIQUE constraint on `policy_number` column
    - This fixes `ON CONFLICT (policy_number)` upserts which require a proper constraint,
      not a partial index

  2. Why
    - PostgreSQL's ON CONFLICT clause cannot use partial unique indexes
    - The Supabase client's `.upsert(batch, { onConflict: "policy_number" })` was failing
      with "there is no unique or exclusion constraint matching the ON CONFLICT specification"
    - A proper UNIQUE constraint allows multiple NULLs by default in PostgreSQL, so
      existing rows with NULL policy_number are unaffected

  3. Important Notes
    - This is a non-destructive change -- no data is modified
    - The new constraint provides the same uniqueness guarantee as the old partial index
*/

-- Drop the partial unique index
DROP INDEX IF EXISTS idx_form_submissions_policy_number_unique;

-- Add a proper unique constraint (allows multiple NULLs by default)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'form_submissions_policy_number_unique'
    AND conrelid = 'form_submissions'::regclass
  ) THEN
    ALTER TABLE form_submissions ADD CONSTRAINT form_submissions_policy_number_unique UNIQUE (policy_number);
  END IF;
END $$;
