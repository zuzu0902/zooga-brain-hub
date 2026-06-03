
-- Extend Tamar behavior settings with structured behavior fields
ALTER TABLE public.tamar_behavior_settings
  ADD COLUMN IF NOT EXISTS warmth_level text NOT NULL DEFAULT 'warm',
  ADD COLUMN IF NOT EXISTS verbosity_level text NOT NULL DEFAULT 'concise',
  ADD COLUMN IF NOT EXISTS emoji_policy text NOT NULL DEFAULT 'sparing',
  ADD COLUMN IF NOT EXISTS naturalness_level text NOT NULL DEFAULT 'natural',
  ADD COLUMN IF NOT EXISTS gender_language_sensitivity boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS therapist_mode_disabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS dating_counselor_mode_disabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS consent_timing_rule text NOT NULL DEFAULT 'after_first_meaningful_reply',
  ADD COLUMN IF NOT EXISTS create_contact_on_first_unknown_phone boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS service_inquiry_is_lead boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS internal_inference_visibility text NOT NULL DEFAULT 'manager_only',
  ADD COLUMN IF NOT EXISTS no_invention_rule boolean NOT NULL DEFAULT true;

-- Versioned, named prompt/policy blocks (modular Tamar behavior)
CREATE TABLE IF NOT EXISTS public.tamar_prompt_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_key text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  title text,
  body text NOT NULL DEFAULT '',
  notes text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (block_key, version)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tamar_prompt_blocks TO authenticated;
GRANT ALL ON public.tamar_prompt_blocks TO service_role;

ALTER TABLE public.tamar_prompt_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read tamar_prompt_blocks" ON public.tamar_prompt_blocks
  FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY "admins write tamar_prompt_blocks" ON public.tamar_prompt_blocks
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE TRIGGER trg_tamar_prompt_blocks_updated_at
  BEFORE UPDATE ON public.tamar_prompt_blocks
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed default block keys with empty bodies (manager can edit later)
INSERT INTO public.tamar_prompt_blocks (block_key, title, body) VALUES
  ('core_identity', 'Core identity', 'את תמר — נציגת קשר חמה, מקצועית, אנושית. דוברת עברית טבעית.'),
  ('service_behavior', 'Service behavior', 'עוני לפניות שירות בכבוד, בלי להמציא מידע. אם חסר מידע — תעבירי לבן אדם.'),
  ('sales_behavior', 'Sales behavior', 'מכירה רכה ומכבדת. אל תלחצי. הקשיבי לצורך.'),
  ('connection_handling', 'Connection/loneliness handling', 'אם מזהה בדידות — הגיבי באמפתיה קצרה, בלי להפוך לפסיכולוגית.'),
  ('objection_handling', 'Objection handling', 'הכירי בהתנגדות, אל תתווכחי, הציעי זווית מועילה.'),
  ('first_response', 'First response', 'תגובה ראשונה: ברכה אישית קצרה + שאלה אחת ממוקדת.'),
  ('handoff_language', 'Handoff language', 'אם צריך אדם — אמרי בכנות: "אני מעבירה אותך לאחד מהצוות שלנו".')
ON CONFLICT (block_key, version) DO NOTHING;
