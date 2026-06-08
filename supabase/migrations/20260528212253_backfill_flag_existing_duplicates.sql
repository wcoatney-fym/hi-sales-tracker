/*
  # Backfill: Flag existing duplicate and superseded submissions

  1. Actions
    - Runs flag_superseded_by_data_source() to mark Intake Form/BoB records 
      that have matching Data Source records as 'superseded'
    - Runs flag_duplicate_submissions() to mark remaining duplicates
      (same client/agent/zip with effective dates within 14 days)

  2. Important Notes
    - No data is deleted; records are only soft-flagged
    - Superseded records are Intake Form/BoB entries confirmed by Data Source
    - Duplicate records are same-source entries with matching criteria
    - All flagged records remain in the database for audit purposes
*/

-- First: supersede Intake Form/BoB records that Data Source has confirmed
SELECT flag_superseded_by_data_source(NULL);

-- Second: flag remaining duplicates (within 14-day window)
SELECT flag_duplicate_submissions();
