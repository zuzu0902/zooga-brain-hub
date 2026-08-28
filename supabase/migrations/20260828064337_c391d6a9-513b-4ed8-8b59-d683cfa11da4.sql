-- 1. relationship_status intake field (canonical Zooga values)
INSERT INTO public.intake_field_definitions
  (intake_version, field_key, label, question_text, purpose_text, presentation, options, required, skippable, order_index, enabled)
VALUES (
  1,
  'relationship_status',
  'סטטוס זוגי',
  'מה הסטטוס הזוגי שלך כיום?',
  'כדי להתאים אירועים, טיולים ופעילויות קהילה שמתאימים לך',
  'menu',
  '[{"id":"single","value":"single","label":"רווק/ה"},
    {"id":"in_relationship","value":"in_relationship","label":"בזוגיות"},
    {"id":"married","value":"married","label":"נשוי/אה"},
    {"id":"separated","value":"separated","label":"פרוד/ה"},
    {"id":"divorced","value":"divorced","label":"גרוש/ה"},
    {"id":"widowed","value":"widowed","label":"אלמן/ה"}]'::jsonb,
  true,
  false,
  45,
  true
)
ON CONFLICT DO NOTHING;

-- keep the pilot free of any "arriving alone / with someone" question
DELETE FROM public.intake_field_definitions
WHERE field_key IN ('arriving_alone', 'coming_alone', 'arriving_with');

-- 2. pilot batches (approved pilot files)
CREATE TABLE IF NOT EXISTS public.pilot_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  imported_by uuid,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  paused boolean NOT NULL DEFAULT false,
  launched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pilot_batches TO authenticated;
GRANT ALL ON public.pilot_batches TO service_role;

ALTER TABLE public.pilot_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users manage pilot batches"
  ON public.pilot_batches FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE TRIGGER pilot_batches_touch_updated_at
  BEFORE UPDATE ON public.pilot_batches
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3. pilot tracking on contacts
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS pilot_batch_id uuid REFERENCES public.pilot_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pilot_file_name text,
  ADD COLUMN IF NOT EXISTS pilot_eligible_at timestamptz,
  ADD COLUMN IF NOT EXISTS pilot_opener_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS pilot_followup_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS pilot_no_response_at timestamptz;

CREATE INDEX IF NOT EXISTS contacts_pilot_batch_idx ON public.contacts (pilot_batch_id);

-- 4. manager outcome on handoffs (required before release)
ALTER TABLE public.manager_handoffs
  ADD COLUMN IF NOT EXISTS contacted_at timestamptz,
  ADD COLUMN IF NOT EXISTS outcome text,
  ADD COLUMN IF NOT EXISTS manager_summary text;