/*
  # Admin Settings Table

  1. New Tables
    - `admin_settings`
      - `id` (uuid, primary key)
      - `key` (text, unique) - Setting identifier
      - `value` (jsonb) - Setting value (flexible JSON storage)
      - `updated_at` (timestamptz) - Last update timestamp
      - `created_at` (timestamptz) - Creation timestamp

  2. Security
    - Enable RLS on `admin_settings` table
    - Policy: Only authenticated users can read/write settings

  3. Notes
    - Used to persist Monte Carlo target values and other admin preferences
    - Key-value design allows flexible storage without schema changes
*/

CREATE TABLE IF NOT EXISTS admin_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE admin_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read admin settings"
  ON admin_settings FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert admin settings"
  ON admin_settings FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update admin settings"
  ON admin_settings FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- RPC to get/set Monte Carlo target (used by edge function with service role)
CREATE OR REPLACE FUNCTION get_monte_carlo_target()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  SELECT value INTO result
  FROM admin_settings
  WHERE key = 'monte_carlo_target';

  RETURN COALESCE(result, '{"target": null}'::json);
END;
$$;

CREATE OR REPLACE FUNCTION set_monte_carlo_target(p_target numeric)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO admin_settings (key, value, updated_at)
  VALUES ('monte_carlo_target', jsonb_build_object('target', p_target, 'set_at', now()::text), now())
  ON CONFLICT (key)
  DO UPDATE SET value = jsonb_build_object('target', p_target, 'set_at', now()::text), updated_at = now();

  RETURN json_build_object('target', p_target, 'set_at', now()::text);
END;
$$;