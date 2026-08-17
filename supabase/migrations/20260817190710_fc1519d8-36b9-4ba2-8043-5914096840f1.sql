CREATE TABLE IF NOT EXISTS public.fact_extraction_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid,
  field_key text NOT NULL,
  proposed_value text,
  previous_value text,
  accepted boolean NOT NULL DEFAULT false,
  reason text NOT NULL DEFAULT 'unspecified',
  confidence integer NOT NULL DEFAULT 0,
  kind text NOT NULL DEFAULT 'inferred',
  source text NOT NULL DEFAULT 'unknown',
  source_message_id text,
  source_type text NOT NULL DEFAULT 'text',
  observed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.fact_extraction_audit TO authenticated;
GRANT ALL ON public.fact_extraction_audit TO service_role;

ALTER TABLE public.fact_extraction_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated can read fact audit" ON public.fact_extraction_audit;
CREATE POLICY "authenticated can read fact audit"
  ON public.fact_extraction_audit FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS fact_extraction_audit_contact_idx
  ON public.fact_extraction_audit (contact_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS fact_extraction_audit_msg_idx
  ON public.fact_extraction_audit (source_message_id);