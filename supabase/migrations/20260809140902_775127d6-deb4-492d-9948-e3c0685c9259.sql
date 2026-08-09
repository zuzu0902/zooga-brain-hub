-- 1. contacts: explicit onboarding state
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS consent_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS consent_version text,
  ADD COLUMN IF NOT EXISTS consent_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS baseline_intake_status text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS intake_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS intake_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS intake_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS intake_last_step_id text,
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_inbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_outbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS total_messages integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS has_prior_conversation boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS service_window_open_until timestamptz;

DO $$ BEGIN
  ALTER TABLE public.contacts ADD CONSTRAINT contacts_consent_status_chk
    CHECK (consent_status IN ('unknown','pending','granted','denied'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.contacts ADD CONSTRAINT contacts_baseline_intake_status_chk
    CHECK (baseline_intake_status IN ('not_started','in_progress','completed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS contacts_whatsapp_number_uidx
  ON public.contacts (whatsapp_number) WHERE whatsapp_number IS NOT NULL;

-- 2. profile facts / inferences
CREATE TABLE IF NOT EXISTS public.contact_profile_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  value_text text,
  value_json jsonb,
  explicit_or_inferred text NOT NULL DEFAULT 'inferred',
  confidence integer NOT NULL DEFAULT 50,
  source text NOT NULL DEFAULT 'tamar',
  source_message_id text,
  evidence text,
  is_current boolean NOT NULL DEFAULT true,
  superseded_by uuid,
  observed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_profile_facts_kind_chk CHECK (explicit_or_inferred IN ('explicit','inferred')),
  CONSTRAINT contact_profile_facts_conf_chk CHECK (confidence BETWEEN 0 AND 100)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_profile_facts TO authenticated;
GRANT ALL ON public.contact_profile_facts TO service_role;
ALTER TABLE public.contact_profile_facts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read profile facts" ON public.contact_profile_facts FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth manage profile facts" ON public.contact_profile_facts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE UNIQUE INDEX IF NOT EXISTS contact_profile_facts_current_uidx
  ON public.contact_profile_facts (contact_id, field_key) WHERE is_current;
CREATE INDEX IF NOT EXISTS contact_profile_facts_contact_idx ON public.contact_profile_facts (contact_id);
CREATE TRIGGER contact_profile_facts_touch BEFORE UPDATE ON public.contact_profile_facts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3. baseline intake question definitions (admin editable)
CREATE TABLE IF NOT EXISTS public.intake_field_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_version integer NOT NULL DEFAULT 1,
  field_key text NOT NULL,
  label text NOT NULL,
  question_text text NOT NULL,
  purpose_text text,
  presentation text NOT NULL DEFAULT 'text',
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  required boolean NOT NULL DEFAULT false,
  skippable boolean NOT NULL DEFAULT true,
  order_index integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intake_field_definitions_presentation_chk CHECK (presentation IN ('text','menu','multi')),
  CONSTRAINT intake_field_definitions_key_uq UNIQUE (intake_version, field_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intake_field_definitions TO authenticated;
GRANT ALL ON public.intake_field_definitions TO service_role;
ALTER TABLE public.intake_field_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read intake defs" ON public.intake_field_definitions FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth manage intake defs" ON public.intake_field_definitions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER intake_field_definitions_touch BEFORE UPDATE ON public.intake_field_definitions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.intake_field_definitions
  (intake_version, field_key, label, question_text, purpose_text, presentation, options, required, skippable, order_index)
VALUES
  (1,'first_name','שם','איך קוראים לך?',NULL,'text','[]'::jsonb,true,false,10),
  (1,'city','אזור מגורים','באיזה אזור בארץ את/ה גר/ה?','כדי להתאים אירועים וטיולים קרובים אלייך','text','[]'::jsonb,false,true,20),
  (1,'birth_date','תאריך לידה','נשמח לשמור את תאריך הלידה שלך כדי לפנק אותך בברכה ומתנה ביום ההולדת 🎂 (אפשר גם לדלג)','ברכה ומתנת יום הולדת','text','[]'::jsonb,false,true,30),
  (1,'interests','תחומי עניין','מה הכי מעניין אותך מהפעילות של זוגה?',NULL,'multi',
   '[{"id":"trips_il","label":"טיולים בארץ","value":"טיולים בארץ"},{"id":"trips_abroad","label":"טיולים בחו״ל","value":"טיולים בחו״ל"},{"id":"events","label":"אירועים","value":"אירועים"},{"id":"dating","label":"היכרויות/קהילה","value":"היכרויות/קהילה"},{"id":"culture","label":"תרבות","value":"תרבות"},{"id":"nature","label":"טבע","value":"טבע"},{"id":"food","label":"אוכל","value":"אוכל"},{"id":"other","label":"אחר","value":"אחר"}]'::jsonb,
   true,true,40),
  (1,'primary_goal','מטרת הקשר','מה הכי חשוב לך שנעזור לך בו עכשיו?',NULL,'text','[]'::jsonb,false,true,50)
ON CONFLICT (intake_version, field_key) DO NOTHING;

-- 4. opening template drafts (definition only, never sent to Meta from here)
CREATE TABLE IF NOT EXISTS public.opening_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_name text NOT NULL,
  language_code text NOT NULL DEFAULT 'he',
  body_text text NOT NULL,
  buttons jsonb NOT NULL DEFAULT '[]'::jsonb,
  variable_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  meta_status text,
  meta_checked_at timestamptz,
  notes text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opening_templates_status_chk CHECK (status IN ('draft','submitted','approved','rejected')),
  CONSTRAINT opening_templates_name_uq UNIQUE (template_name, language_code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.opening_templates TO authenticated;
GRANT ALL ON public.opening_templates TO service_role;
ALTER TABLE public.opening_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read opening templates" ON public.opening_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth manage opening templates" ON public.opening_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER opening_templates_touch BEFORE UPDATE ON public.opening_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.opening_templates
  (template_name, language_code, body_text, buttons, variable_count, status, is_default, notes)
VALUES (
  'zooga_opening_consent','he',
  'שלום {{1}}, אני תמר, העוזרת הדיגיטלית של קהילת זוגה. פנוי/ה לשיחה קצרה כדי שאכיר אותך ואוכל לשלוח לך מידע והצעות מתאימות?',
  '[{"id":"consent_yes","label":"כן, בשמחה"},{"id":"consent_no","label":"לא כרגע"}]'::jsonb,
  1,'draft',true,
  'טיוטה במערכת בלבד. יש להגיש ולאשר בממשק Meta לפני שליחה יזומה.'
) ON CONFLICT (template_name, language_code) DO NOTHING;

-- 5. conservative backfill
UPDATE public.contacts c SET
  consent_status = CASE
    WHEN c.opted_out_at IS NOT NULL THEN 'denied'
    WHEN c.consent_marketing IS TRUE AND c.consent_date IS NOT NULL THEN 'granted'
    ELSE 'unknown' END,
  consent_version = CASE WHEN c.consent_marketing IS TRUE AND c.consent_date IS NOT NULL
    THEN COALESCE(c.consent_wording_version, 'legacy') ELSE c.consent_version END,
  consent_evidence = CASE WHEN c.consent_marketing IS TRUE AND c.consent_date IS NOT NULL
    THEN jsonb_build_object('backfill', true, 'source', COALESCE(c.consent_source,'legacy'), 'at', c.consent_date)
    ELSE c.consent_evidence END,
  baseline_intake_status = CASE
    WHEN COALESCE(array_length(c.intake_completed_fields,1),0) > 0 THEN 'in_progress'
    ELSE 'not_started' END,
  first_seen_at = COALESCE(c.first_seen_at, c.created_at);

WITH agg AS (
  SELECT contact_id,
         count(*) AS n,
         min(timestamp) AS first_at,
         max(timestamp) AS last_at
  FROM public.interactions GROUP BY contact_id
)
UPDATE public.contacts c SET
  has_prior_conversation = true,
  total_messages = agg.n,
  first_inbound_at = COALESCE(c.first_inbound_at, agg.first_at),
  last_inbound_at = COALESCE(c.last_inbound_at, agg.last_at)
FROM agg WHERE agg.contact_id = c.id;

WITH m AS (
  SELECT contact_id, max(sent_at) AS last_out FROM public.messages
  WHERE sent_at IS NOT NULL GROUP BY contact_id
)
UPDATE public.contacts c SET last_outbound_at = COALESCE(c.last_outbound_at, m.last_out),
  has_prior_conversation = true
FROM m WHERE m.contact_id = c.id;