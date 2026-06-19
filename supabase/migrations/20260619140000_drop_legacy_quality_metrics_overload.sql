/*
  # Drop the legacy single-arg get_quality_metrics overload

  20260619000000 added get_quality_metrics(uuid, uuid[]) for multi-agency
  scope, but the older get_quality_metrics(uuid) from 20260612170000 /
  20260612200000 was never removed. Both have all-default args, so a call
  passing only p_agency_id (the single-agency tabs: FYM Direct, Wisechoice)
  is AMBIGUOUS to PostgREST -> the RPC errors -> the frontend's
  getQualityMetrics() catch hides the Book Quality card.

  The multi-agency "All Internal" call passes BOTH args, so it uniquely
  resolves to the new function and renders fine. That's why the card only
  showed on All Internal.

  Fix: drop the legacy 1-arg overload. The new 2-arg function defaults
  p_agency_ids to NULL, so single-agency calls (p_agency_id only) keep
  working against it.
*/

DROP FUNCTION IF EXISTS get_quality_metrics(uuid);

-- Re-assert least privilege on the surviving overload (idempotent).
REVOKE EXECUTE ON FUNCTION get_quality_metrics(uuid, uuid[]) FROM anon, authenticated;
