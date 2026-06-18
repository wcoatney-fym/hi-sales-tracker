/*
  # Add per-agency Zap automation toggle

  1. Schema
    - `agencies.zaps_enabled` (boolean, NOT NULL, default false)
      Gates whether retention / at-risk / cancellation webhooks fire for an
      agency's policies. Separate from `is_active` (portal access) so we can
      enable automation independently of visibility.

  2. Rollout
    - Defaults to FALSE for every agency. No webhook fires until a FYM global
      admin explicitly toggles an agency on. FYM-internal is the only agency
      intended to be enabled at launch.

  3. Notes
    - The trigger/outbox layer (added separately) checks this column before
      enqueuing any webhook. This migration only adds the flag + seeds FYM on.
*/

ALTER TABLE agencies
  ADD COLUMN IF NOT EXISTS zaps_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN agencies.zaps_enabled IS
  'When true, retention/at-risk/cancellation Zap webhooks fire for this agency''s policies. Default false; FYM-admin controlled.';

-- Seed: enable for the FYM internal house agency only.
UPDATE agencies SET zaps_enabled = true WHERE name = 'FYM';
