
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS intake_state text,
  ADD COLUMN IF NOT EXISTS intake_stage text,
  ADD COLUMN IF NOT EXISTS intake_required_fields text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS intake_completed_fields text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS intake_missing_fields text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS intake_last_question_key text,
  ADD COLUMN IF NOT EXISTS intake_last_question_at timestamptz,
  ADD COLUMN IF NOT EXISTS intake_last_captured_field text,
  ADD COLUMN IF NOT EXISTS intake_last_captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS intake_completion_score integer DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.intake_field_captures (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  value_text text,
  confidence integer,
  source text,
  runtime_execution_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.intake_field_captures TO authenticated;
GRANT ALL ON public.intake_field_captures TO service_role;

ALTER TABLE public.intake_field_captures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "intake_field_captures_select_authenticated"
  ON public.intake_field_captures FOR SELECT TO authenticated USING (true);

CREATE POLICY "intake_field_captures_insert_authenticated"
  ON public.intake_field_captures FOR INSERT TO authenticated WITH CHECK (true);

CREATE INDEX IF NOT EXISTS intake_field_captures_contact_id_idx
  ON public.intake_field_captures(contact_id, created_at DESC);
