/*
  # Fix incorrect FYM agency assignments from data source imports

  1. Data Corrections
    - Updates form_submissions that have agency = 'FYM' and source = 'Data Source'
      where the corresponding source_record has a non-empty "Downline Agency" field
    - Sets the agency to the proper-cased Downline Agency value from the source record

  2. Important Notes
    - This fixes ~3500+ records that were incorrectly mapped to FYM due to a bug
      in the import logic (indirect lookup through agents table instead of reading
      the Downline Agency directly from source data)
    - Only affects Data Source records; Contracting Portal submissions are untouched
    - Also updates agents table records (non-locked) where a Downline Agency is available
*/

-- Fix form_submissions: join to source_records via policy_number to get the correct Downline Agency
UPDATE form_submissions fs
SET agency = initcap(sr.mapped_data->>'Downline Agency')
FROM source_records sr
WHERE fs.source = 'Data Source'
  AND fs.agency = 'FYM'
  AND fs.policy_number IS NOT NULL
  AND fs.policy_number != ''
  AND sr.processing_status = 'imported'
  AND sr.mapped_data->>'Policy Number' = fs.policy_number
  AND sr.mapped_data->>'Downline Agency' IS NOT NULL
  AND trim(sr.mapped_data->>'Downline Agency') != '';

-- Also fix agents table: for non-locked agents currently set to FYM,
-- update from source_records where we can find their writing number with a Downline Agency
UPDATE agents a
SET agency = sub.proper_agency,
    updated_at = now()
FROM (
  SELECT DISTINCT ON (upper(trim(
    COALESCE(sr.mapped_data->>'UNL Writing Number', sr.mapped_data->>'Writing Agent Code')
  )))
    upper(trim(
      COALESCE(sr.mapped_data->>'UNL Writing Number', sr.mapped_data->>'Writing Agent Code')
    )) AS agent_code,
    initcap(trim(sr.mapped_data->>'Downline Agency')) AS proper_agency
  FROM source_records sr
  WHERE sr.processing_status = 'imported'
    AND sr.mapped_data->>'Downline Agency' IS NOT NULL
    AND trim(sr.mapped_data->>'Downline Agency') != ''
    AND trim(COALESCE(sr.mapped_data->>'UNL Writing Number', sr.mapped_data->>'Writing Agent Code', '')) != ''
) sub
WHERE upper(a.unl_writing_number) = sub.agent_code
  AND a.agency = 'FYM'
  AND (a.agency_locked IS NULL OR a.agency_locked = false)
  AND a.source != 'Contracting Portal';
