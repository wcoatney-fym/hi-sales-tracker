/*
  # Create agent_sessions table

  1. New Tables
    - `agent_sessions`
      - `id` (uuid, primary key)
      - `agent_id` (uuid, references agents)
      - `token` (text, unique) - session token stored in browser
      - `expires_at` (timestamptz) - 90-day expiration
      - `created_at` (timestamptz)
  2. Indexes
    - Token lookup index for fast session validation
    - Agent ID index for session management
  3. Security
    - Enable RLS on `agent_sessions` table
    - No public policies - accessed only via service role in edge functions
*/

CREATE TABLE IF NOT EXISTS public.agent_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_token ON public.agent_sessions(token);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_agent_id ON public.agent_sessions(agent_id);

ALTER TABLE public.agent_sessions ENABLE ROW LEVEL SECURITY;
