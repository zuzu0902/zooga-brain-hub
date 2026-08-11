CREATE TABLE public.relationship_ai_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  source_hash text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  is_current boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'pending',
  summary_he text,
  sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  matching_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_info jsonb NOT NULL DEFAULT '[]'::jsonb,
  contradictions jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence integer,
  section_confidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  answered_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  model_id text,
  prompt_version text,
  error text,
  generated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.relationship_ai_insights TO authenticated;
GRANT ALL ON public.relationship_ai_insights TO service_role;

ALTER TABLE public.relationship_ai_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view relationship AI insights"
ON public.relationship_ai_insights
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE UNIQUE INDEX relationship_ai_insights_contact_hash_key
  ON public.relationship_ai_insights (contact_id, source_hash);

CREATE UNIQUE INDEX relationship_ai_insights_one_current
  ON public.relationship_ai_insights (contact_id)
  WHERE is_current;

CREATE INDEX relationship_ai_insights_contact_created_idx
  ON public.relationship_ai_insights (contact_id, created_at DESC);

CREATE TRIGGER relationship_ai_insights_touch
  BEFORE UPDATE ON public.relationship_ai_insights
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();