
CREATE TABLE IF NOT EXISTS public.extracted_attributes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL,
  attribute_name text NOT NULL,
  attribute_value jsonb NOT NULL,
  value_text text,
  confidence_score integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'conversation_intelligence',
  source_message text,
  source_interaction_id uuid,
  reasoning text,
  applied boolean NOT NULL DEFAULT false,
  applied_at timestamptz,
  superseded_at timestamptz,
  superseded_by uuid,
  is_current boolean NOT NULL DEFAULT true,
  extracted_by text NOT NULL DEFAULT 'ai_extraction',
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_extracted_attributes_contact ON public.extracted_attributes(contact_id);
CREATE INDEX IF NOT EXISTS idx_extracted_attributes_contact_attr_current
  ON public.extracted_attributes(contact_id, attribute_name) WHERE is_current = true;
CREATE INDEX IF NOT EXISTS idx_extracted_attributes_created_at ON public.extracted_attributes(created_at DESC);

ALTER TABLE public.extracted_attributes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read extracted_attributes" ON public.extracted_attributes
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public write extracted_attributes" ON public.extracted_attributes
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admins read extracted_attributes" ON public.extracted_attributes
  FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY "admins write extracted_attributes" ON public.extracted_attributes
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
