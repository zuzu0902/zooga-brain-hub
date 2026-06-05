
CREATE TABLE public.tamar_runtime_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  contact_id uuid,
  campaign_id uuid,
  offer_id uuid,
  channel text,
  source text,
  inbound_message text,
  outbound_reply text,
  runtime_mode text NOT NULL DEFAULT 'unknown',
  runtime_pack_fetch_ok boolean,
  fallback_reason text,
  deployment_sha text,
  composition_version text,
  tamar_settings_version_at timestamptz,
  prompt_blocks_injected jsonb NOT NULL DEFAULT '[]'::jsonb,
  offer_intelligence_injected boolean NOT NULL DEFAULT false,
  campaign_injected boolean NOT NULL DEFAULT false,
  latency_ms integer,
  error text,
  raw_payload jsonb
);

CREATE INDEX tamar_runtime_executions_created_idx ON public.tamar_runtime_executions (created_at DESC);
CREATE INDEX tamar_runtime_executions_contact_idx ON public.tamar_runtime_executions (contact_id, created_at DESC);
CREATE INDEX tamar_runtime_executions_mode_idx ON public.tamar_runtime_executions (runtime_mode, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tamar_runtime_executions TO authenticated;
GRANT ALL ON public.tamar_runtime_executions TO service_role;

ALTER TABLE public.tamar_runtime_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read tamar_runtime_executions"
  ON public.tamar_runtime_executions FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "admins write tamar_runtime_executions"
  ON public.tamar_runtime_executions FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
