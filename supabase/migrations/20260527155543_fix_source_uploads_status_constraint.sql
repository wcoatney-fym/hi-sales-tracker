/*
  # Fix source_uploads status constraint

  1. Changes
    - Drop and recreate the status check constraint to allow 'reverted' status
    - This fixes the revert-source-upload action which was setting status to 'reverted'

  2. Allowed statuses
    - processing: Upload in progress (chunks being received)
    - complete: Upload finalized and synced to form_submissions
    - error: Upload failed
    - reverted: Upload was reverted by admin
*/

ALTER TABLE source_uploads DROP CONSTRAINT IF EXISTS source_uploads_status_check;

ALTER TABLE source_uploads ADD CONSTRAINT source_uploads_status_check
  CHECK (status = ANY (ARRAY['processing', 'complete', 'error', 'reverted']));
