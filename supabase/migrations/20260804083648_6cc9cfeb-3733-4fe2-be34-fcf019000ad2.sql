-- ============ 1. conversation state machine on contacts ============
DO $$ BEGIN
  CREATE TYPE public.tamar_conversation_state AS ENUM (
    'consent_pending','consented','opted_out','intake_active','value_delivery',
    'offer_recommended','human_handoff_queued','human_owned','paused','closed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS conversation_state public.tamar_conversation_state,
  ADD COLUMN IF NOT EXISTS conversation_state_at timestamptz,
  ADD COLUMN IF NOT EXISTS human_owned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS human_owned_at timestamptz,
  ADD COLUMN IF NOT EXISTS human_owned_by text,
  ADD COLUMN IF NOT EXISTS consent_wording_version text,
  ADD COLUMN IF NOT EXISTS consent_message_id text,
  ADD COLUMN IF NOT EXISTS consent_asked_at timestamptz,
  ADD COLUMN IF NOT EXISTS consent_responded_at timestamptz;

-- Safe backfill: unknown consent stays unknown (NULL state).
UPDATE public.contacts SET conversation_state = 'opted_out'
  WHERE conversation_state IS NULL AND opted_out_at IS NOT NULL;
UPDATE public.contacts SET conversation_state = 'consented'
  WHERE conversation_state IS NULL AND consent_marketing = true;

CREATE INDEX IF NOT EXISTS contacts_conversation_state_idx ON public.contacts(conversation_state);
CREATE INDEX IF NOT EXISTS contacts_human_owned_idx ON public.contacts(human_owned) WHERE human_owned;

-- ============ 2. state transition log ============
CREATE TABLE IF NOT EXISTS public.tamar_state_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  from_state text,
  to_state text NOT NULL,
  trigger text NOT NULL,
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  actor text NOT NULL DEFAULT 'system',
  runtime_execution_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tamar_state_transitions TO authenticated;
GRANT ALL ON public.tamar_state_transitions TO service_role;
ALTER TABLE public.tamar_state_transitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read state transitions" ON public.tamar_state_transitions
  FOR SELECT TO authenticated USING (true);
CREATE INDEX IF NOT EXISTS tamar_state_transitions_contact_idx
  ON public.tamar_state_transitions(contact_id, created_at DESC);

-- ============ 3. versioned copy (persona + consent) ============
CREATE TABLE IF NOT EXISTS public.tamar_copy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  copy_key text NOT NULL,
  variant text NOT NULL DEFAULT 'A',
  version integer NOT NULL DEFAULT 1,
  body text NOT NULL,
  template_name text,
  language_code text NOT NULL DEFAULT 'he',
  is_active boolean NOT NULL DEFAULT false,
  ab_weight integer NOT NULL DEFAULT 100,
  kill_switch boolean NOT NULL DEFAULT false,
  notes text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (copy_key, variant, version)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tamar_copy_versions TO authenticated;
GRANT ALL ON public.tamar_copy_versions TO service_role;
ALTER TABLE public.tamar_copy_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read copy" ON public.tamar_copy_versions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write copy" ON public.tamar_copy_versions
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE TRIGGER tamar_copy_versions_touch BEFORE UPDATE ON public.tamar_copy_versions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.tamar_copy_versions (copy_key, variant, version, body, template_name, is_active, notes)
VALUES
 ('consent_optin_template','A',1,
  'היי {{1}}, נעים מאוד 😊 אני תמר, העוזרת הדיגיטלית של זוגה. זוגה מחברת בין אנשים דרך טיולים, אירועים והיכרויות בקהילה נעימה ואיכותית. אשמח להכיר אותך קצת, כדי לשלוח לך רק הצעות, הטבות וחיבורים שבאמת יכולים להתאים לך. אפשר להמשיך לדבר איתך כאן ב-WhatsApp? בכל שלב אפשר לבקש ממני לדבר עם אדם.',
  'zooga_consent_optin', true, 'Approved-template body proposal. Quick replies: כן, בשמחה / לא, תודה'),
 ('consent_clarify','A',1,
  'רק כדי לוודא שהבנתי נכון 🙂 — אפשר להמשיך לשלוח לך כאן עדכונים והצעות מזוגה?',
  NULL, true, 'Single clarification question for ambiguous consent'),
 ('consent_yes_ack','A',1,
  'תודה רבה 🙏 אשמח להכיר אותך קצת כדי להתאים לך דברים שבאמת מתאימים. בכל שלב אפשר לבקש ממני לדבר עם אדם.',
  NULL, true, NULL),
 ('consent_no_close','A',1,
  'תודה ולהתראות. לא נשלח לך הודעות נוספות. אם תרצה בעתיד, אפשר לבקר באתר זוגה: https://www.zooga.co.il או לבקש לדבר עם אדם.',
  NULL, true, 'Single closing message, then automation stops'),
 ('handoff_ack','A',1,
  'בשמחה — אני מעבירה אותך לאדם מהצוות של זוגה שיחזור אליך. מכאן אני עוצרת ולא אמשיך לשאול שאלות 🙏',
  NULL, true, NULL),
 ('manager_alert_template','A',1,
  'התראת זוגה: {{1}} — {{2}}. דחיפות: {{3}}. פרטים מלאים ב-CRM.',
  'zooga_manager_handoff', true, 'Manager alert outside the 24h window'),
 ('persona_core','A',1,
  'אני תמר, העוזרת הדיגיטלית של זוגה. אני אף פעם לא מתחזה לאדם. הקול שלי: עברית טבעית, נעימה, רכה, חמה ומחבקת, קצרה ולא לוחצת. אני מגיבה קודם למה שנאמר, ורק אז שואלת — שאלה אחת לכל היותר.',
  NULL, true, NULL)
ON CONFLICT DO NOTHING;

-- ============ 4. community knowledge ============
CREATE TABLE IF NOT EXISTS public.community_knowledge_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  source_url text,
  source_type text NOT NULL DEFAULT 'manual',
  public_or_authorized text NOT NULL DEFAULT 'public',
  status text NOT NULL DEFAULT 'pending',
  version integer NOT NULL DEFAULT 1,
  fetched_at timestamptz,
  verified_at timestamptz,
  verified_by text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_knowledge_sources TO authenticated;
GRANT ALL ON public.community_knowledge_sources TO service_role;
ALTER TABLE public.community_knowledge_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read knowledge sources" ON public.community_knowledge_sources
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write knowledge sources" ON public.community_knowledge_sources
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE TRIGGER community_knowledge_sources_touch BEFORE UPDATE ON public.community_knowledge_sources
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.community_knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.community_knowledge_sources(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL DEFAULT 0,
  content text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'approved',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_knowledge_chunks TO authenticated;
GRANT ALL ON public.community_knowledge_chunks TO service_role;
ALTER TABLE public.community_knowledge_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read knowledge chunks" ON public.community_knowledge_chunks
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write knowledge chunks" ON public.community_knowledge_chunks
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE INDEX IF NOT EXISTS community_knowledge_chunks_source_idx
  ON public.community_knowledge_chunks(source_id);

INSERT INTO public.community_knowledge_sources (id, title, source_url, source_type, public_or_authorized, status, verified_at, notes)
VALUES ('11111111-1111-4111-8111-111111111111','עקרונות קהילה של זוגה (curated)','https://www.zooga.co.il','curated','authorized','approved', now(),
        'Curated non-medical community principles seeded with Tamar Brain v1')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.community_knowledge_chunks (source_id, chunk_index, content, tags)
VALUES
 ('11111111-1111-4111-8111-111111111111',0,'זוגה היא קהילה שמחברת בין אנשים דרך טיולים, אירועים ומפגשים. אפשר להצטרף לבד — רוב המשתתפים מגיעים לבד, ואנחנו עוזרים בהתאמת שותף/ה לחדר ובשילוב בקבוצה.',ARRAY['community','solo','matching']),
 ('11111111-1111-4111-8111-111111111111',1,'קשרים חברתיים משמעותיים ותחושת שייכות משפרים את איכות החיים. מפגש בקבוצה קטנה ונעימה מקל על היכרות טבעית, בלי לחץ ובלי מלאכותיות.',ARRAY['community','belonging']),
 ('11111111-1111-4111-8111-111111111111',2,'חלק מהאנשים מגיעים לזוגה כדי להכיר בן/בת זוג, וחלק כדי להרחיב מעגל חברתי. שתי המטרות לגיטימיות ומקבלות מקום שווה, בלי שיפוטיות.',ARRAY['dating','social']),
 ('11111111-1111-4111-8111-111111111111',3,'תמר היא עוזרת דיגיטלית. היא לא נותנת ייעוץ רפואי או טיפולי, ולא מבטיחה תוצאות זוגיות. בכל שלב אפשר לבקש לדבר עם אדם מהצוות.',ARRAY['boundaries','handoff'])
ON CONFLICT DO NOTHING;

-- ============ 5. decision traces ============
CREATE TABLE IF NOT EXISTS public.tamar_decision_traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid,
  runtime_execution_id uuid,
  state text NOT NULL,
  considered_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  selected_action text NOT NULL,
  confidence integer,
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  fields_used jsonb NOT NULL DEFAULT '[]'::jsonb,
  offer_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  knowledge_source_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  prompt_version text,
  model text,
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tamar_decision_traces TO authenticated;
GRANT ALL ON public.tamar_decision_traces TO service_role;
ALTER TABLE public.tamar_decision_traces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read decision traces" ON public.tamar_decision_traces
  FOR SELECT TO authenticated USING (true);
CREATE INDEX IF NOT EXISTS tamar_decision_traces_created_idx
  ON public.tamar_decision_traces(created_at DESC);

-- ============ 6. brain policy (singleton) ============
CREATE TABLE IF NOT EXISTS public.tamar_brain_policy (
  id integer PRIMARY KEY DEFAULT 1,
  consent_gate_enabled boolean NOT NULL DEFAULT true,
  max_questions_per_message integer NOT NULL DEFAULT 1,
  value_before_question_after_answers integer NOT NULL DEFAULT 2,
  handoff_confidence_threshold integer NOT NULL DEFAULT 60,
  manager_alert_enabled boolean NOT NULL DEFAULT true,
  manager_alert_template text NOT NULL DEFAULT 'zooga_manager_handoff',
  attach_transcript_to_alert boolean NOT NULL DEFAULT false,
  recommendation_max_offers integer NOT NULL DEFAULT 3,
  knowledge_grounding_required boolean NOT NULL DEFAULT true,
  ab_testing_enabled boolean NOT NULL DEFAULT false,
  kill_switch_ab boolean NOT NULL DEFAULT false,
  prompt_version text NOT NULL DEFAULT 'tamar-brain-v1',
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tamar_brain_policy_singleton CHECK (id = 1)
);
GRANT SELECT, INSERT, UPDATE ON public.tamar_brain_policy TO authenticated;
GRANT ALL ON public.tamar_brain_policy TO service_role;
ALTER TABLE public.tamar_brain_policy ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read brain policy" ON public.tamar_brain_policy
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write brain policy" ON public.tamar_brain_policy
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE TRIGGER tamar_brain_policy_touch BEFORE UPDATE ON public.tamar_brain_policy
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
INSERT INTO public.tamar_brain_policy (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ============ 7. admin audit log ============
CREATE TABLE IF NOT EXISTS public.tamar_admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor text,
  area text NOT NULL,
  action text NOT NULL,
  target_id text,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.tamar_admin_audit_log TO authenticated;
GRANT ALL ON public.tamar_admin_audit_log TO service_role;
ALTER TABLE public.tamar_admin_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read audit log" ON public.tamar_admin_audit_log
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert audit log" ON public.tamar_admin_audit_log
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE INDEX IF NOT EXISTS tamar_admin_audit_log_created_idx
  ON public.tamar_admin_audit_log(created_at DESC);

-- ============ 8. handoff upgrades ============
ALTER TABLE public.manager_handoffs
  ADD COLUMN IF NOT EXISTS urgency text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS suggested_response text,
  ADD COLUMN IF NOT EXISTS alert_state text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS transcript_included boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS crm_link text;