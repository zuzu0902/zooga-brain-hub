CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meta_template_id text,
  name text NOT NULL,
  language text NOT NULL,
  language_base text NOT NULL,
  waba_masked text,
  status text NOT NULL DEFAULT 'UNKNOWN',
  category text,
  body_text text,
  header jsonb,
  footer_text text,
  buttons jsonb NOT NULL DEFAULT '[]'::jsonb,
  components jsonb NOT NULL DEFAULT '[]'::jsonb,
  variable_count integer NOT NULL DEFAULT 0,
  variable_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
  purpose text,
  topics text[] NOT NULL DEFAULT '{}',
  is_default boolean NOT NULL DEFAULT false,
  requires_active_offer boolean NOT NULL DEFAULT false,
  allowed_offer_categories text[] NOT NULL DEFAULT '{}',
  variable_mappings jsonb NOT NULL DEFAULT '{}'::jsonb,
  variable_defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_available boolean NOT NULL DEFAULT true,
  removed_at timestamptz,
  last_checked_at timestamptz,
  last_synced_at timestamptz,
  sync_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, language)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_templates TO authenticated;
GRANT ALL ON public.whatsapp_templates TO service_role;

ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read whatsapp templates" ON public.whatsapp_templates
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "admins manage whatsapp templates" ON public.whatsapp_templates
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE TRIGGER whatsapp_templates_touch
  BEFORE UPDATE ON public.whatsapp_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX IF NOT EXISTS whatsapp_templates_lookup_idx
  ON public.whatsapp_templates (name, language_base);

ALTER TABLE public.tamar_activations
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.whatsapp_templates(id),
  ADD COLUMN IF NOT EXISTS template_name text,
  ADD COLUMN IF NOT EXISTS template_language text,
  ADD COLUMN IF NOT EXISTS template_category text,
  ADD COLUMN IF NOT EXISTS meta_template_id text,
  ADD COLUMN IF NOT EXISTS template_params jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS template_components jsonb,
  ADD COLUMN IF NOT EXISTS rendered_preview text;